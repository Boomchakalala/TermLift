import { createClient } from '@/lib/supabase/server'
import { getClaudeResponse, getLanguageInstruction, KEVIN_SYSTEM_PROMPT, EMAIL_RULES, analysisDate } from '@/lib/claude'
import { NextResponse } from 'next/server'
import { outputLocale } from '@/lib/output-language'

import { SHOW_FULL_NEGOTIATION_PLAYBOOK } from '@/lib/negotiation-gating'
import { FULL_ANALYSIS_EMAIL_REGEN_LIMIT } from '@/lib/pricing'
import { dealHasFullAnalysis, hasDeepContent } from '@/lib/deep-analysis-status'
import { runWithAiContext } from '@/lib/ai-telemetry'
import { recommendTone, type EmailTone } from '@/lib/tone-recommend'
import { selectEmailAsks } from '@/lib/email-asks'
import { computeDealTarget } from '@/lib/deal-target'
import { isExpired, toIsoDate } from '@/lib/scoring'
import { fmtMoney } from '@/lib/deal-metrics'
import { detectCurrency, type Currency } from '@/lib/currency'
import { sanitizeEmailBody } from '@/lib/email-guard'
import { UPLIFT_ASK_PCT, upliftCapCeiling } from '@/lib/ask-policy'

// Email generation regularly takes 15-25s (single Claude call producing 3
// variants) — matches the explicit maxDuration set on every other AI-calling
// route in this app (round, deep-analysis, trial, etc.); without it this
// route falls back to the platform default, which is too short and would
// time out under real generation latency.
export const maxDuration = 120

// ─────────────────────────────────────────────────────────────────────────────
// 2026-09-11: the asks, the target, the deal-type framing and the wording
// guards are decided HERE, in code, from the stored round — not by the model
// from a dump of every ask the client happened to send. The client still
// supplies the optional negotiation context a person typed (objective, budget,
// competing quote, walk-away, deadline, extra instructions).
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // NB: profiles has no first_name/last_name (verified against information_schema).
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('plan, is_admin, contact_name')
      .eq('id', user.id)
      .single()
    if (profileError) console.error('[TermLift] regenerate-emails: profile lookup failed:', profileError.message)

    const senderName = profile?.contact_name?.trim() || undefined
    // A flat abuse safeguard, not a paywall. Per-deal entitlement is checked below.
    const maxRegens = profile?.is_admin ? 99 : FULL_ANALYSIS_EMAIL_REGEN_LIMIT

    if (!profile?.is_admin && !SHOW_FULL_NEGOTIATION_PLAYBOOK) {
      return NextResponse.json({ error: 'Email drafting is now handled by TermLift as part of the negotiation service.' }, { status: 403 })
    }

    const body = await request.json()
    const {
      roundId,
      customPrompt,
      // Optional user-supplied context — only what the quote/analysis can't
      // reliably know. Every field is optional and omitted from the prompt
      // entirely when not provided.
      negotiationObjective,
      budgetCeiling,
      competingQuote,
      walkAwayFlexibility,
      internalDeadline,
      additionalInstructions,
    } = body

    // Check if round exists and belongs to user
    const { data: round, error: roundError } = await supabase
      .from('rounds')
      .select('email_regeneration_count, schema_version, output_json, deal_id, round_number')
      .eq('id', roundId)
      .eq('user_id', user.id)
      .single()

    if (roundError || !round) {
      return NextResponse.json({ error: 'Round not found' }, { status: 404 })
    }

    // V2 rounds use on-demand email generation
    if (round.schema_version === 'v2') {
      return NextResponse.json({
        error: 'Email regeneration is not available for V2 analysis. Use the on-demand email generator instead.'
      }, { status: 400 })
    }

    // Email generation is part of the Playbook — require it for this DEAL.
    const [{ data: dealRounds }, { data: deal }] = await Promise.all([
      supabase.from('rounds').select('id, round_number, output_json').eq('deal_id', round.deal_id).eq('user_id', user.id).order('round_number', { ascending: false }),
      supabase.from('deals').select('id, deal_type, vendor').eq('id', round.deal_id).eq('user_id', user.id).single(),
    ])
    if (!profile?.is_admin && !dealHasFullAnalysis(dealRounds)) {
      return NextResponse.json({ error: 'Build the Negotiation Playbook for this deal before generating a negotiation email.' }, { status: 403 })
    }

    // Regeneration cap — a flat abuse safeguard, not a plan limit
    if (round.email_regeneration_count >= maxRegens) {
      return NextResponse.json({
        error: `You've reached the limit of ${maxRegens} email regeneration${maxRegens > 1 ? 's' : ''} for this round.`
      }, { status: 429 })
    }

    // ── Everything below is read from the stored round, never from the client ──
    const o = (round.output_json || {}) as any
    // The strategy (asks, leverage, savings, benchmark) lives on the round the Playbook ran on;
    // a vendor-reply round analysed at quick depth inherits it.
    const pb = (hasDeepContent(o) ? o : (dealRounds || []).find((r) => hasDeepContent(r.output_json))?.output_json ?? o) as any
    const snapshot = o.snapshot || {}
    const currency = (snapshot.currency ? detectCurrency(String(snapshot.currency)) : detectCurrency(String(snapshot.total_commitment || ''))) as Currency
    const fmt = (n: number) => fmtMoney(n, currency)

    const today = analysisDate()
    const expiresRaw = o.extraction?.quoteDates?.expires ?? snapshot.quote_expires ?? snapshot.signing_deadline ?? null
    const quoteExpired = o.quote_expired === true || isExpired(expiresRaw, today)
    const expiredOn = quoteExpired ? (toIsoDate(expiresRaw) || String(expiresRaw || '')) : null

    // Asks: code-selected (refreshed quote first when expired, then every HIGH flag ask, then the largest quantified must-have; cap 3).
    const selection = selectEmailAsks({ ...pb, red_flags: o.red_flags?.length ? o.red_flags : pb.red_flags }, { quoteExpired, expiredOn, cap: 3 })

    // One target, the same number the hero tile shows.
    const target = computeDealTarget(pb)
    const targetAnchor = target ? fmt(target.anchor) : null

    // Deal-type framing: "new customer / new logo" only when the stored type is New, the
    // inference is high-confidence, and the document never names a running subscription.
    const inferred = (o.inferred_deal_type || pb.inferred_deal_type || null) as { type?: string; confidence?: string; currentSubLanguage?: boolean; user_confirmed_type?: string } | null
    const storedType = (inferred?.user_confirmed_type as string | undefined) || deal?.deal_type || 'New'
    const isRenewal = storedType === 'Renewal' || inferred?.type === 'renewal'
    const allowNewLogo = storedType === 'New' && inferred?.confidence === 'high' && !inferred?.currentSubLanguage && inferred?.type !== 'renewal' && inferred?.type !== 'expansion'
    const allowAlternatives = typeof competingQuote === 'string' && competingQuote.trim().length > 0

    const contactName: string | undefined = (o.contact_name || snapshot.contact_name || undefined) as string | undefined
    const quoteNumber: string | undefined = snapshot.quote_number || undefined
    const vendorName: string = deal?.vendor || o.vendor || snapshot.vendor_product || 'the vendor'
    const leverage: string[] = pb.negotiation_plan?.leverage_you_have || []
    const offers: string[] = pb.negotiation_plan?.trades_you_can_offer || []
    const highSeverityFlagCount = (o.red_flags || []).filter((f: any) => String(f?.severity || '').toLowerCase() === 'high').length

    const dealTypeContext = isRenewal
      ? 'This is a RENEWAL — the buyer is already a customer. Frame asks around retention leverage (the vendor does not want to lose an existing account). Never describe the buyer as new.'
      : inferred?.type === 'expansion'
        ? 'This is an EXPANSION of an existing agreement — frame asks around volume/loyalty leverage from the existing relationship. Never describe the buyer as new.'
        : allowNewLogo
          ? 'This is a NEW PURCHASE — the buyer is not yet a customer. Frame asks around competitive pressure and fast-signature leverage.'
          : 'Treat the relationship as neutral: do NOT describe the buyer as a new customer, a new logo or a first-time buyer, and do not describe them as an existing customer either.'

    const walkAwayContext: Record<string, string> = {
      flexible: 'The buyer is genuinely flexible on this deal — no urgency to force a compromise, but open to pushing.',
      prefer_stay: 'The buyer would prefer to stay with this vendor if reasonably possible — push for the asks, but do not frame the email as a threat to leave.',
      can_walk: 'The buyer has real alternatives and is willing to walk away from this deal if the asks are not met — this is genuine leverage, but stay professional, do not bluff or exaggerate it.',
    }

    const bench = pb.market_benchmark
    const benchInterp = pb.benchmark_interpretation
    const benchLine = bench?.benchmark_available && (benchInterp?.target_price != null || bench.fair_market_low != null)
      ? `INTERNAL PRICE EVIDENCE (from TermLift's market benchmark — ${bench.confidence || 'medium'} confidence${typeof bench.quote_vs_market_percent === 'number' ? `, quote sits ${bench.quote_vs_market_percent > 0 ? '+' : ''}${bench.quote_vs_market_percent}% vs observed market` : ''}). NEVER write "TermLift", "benchmark", "our data" or "the market price is X" — if it genuinely helps, phrase it as the buyer's expectation ("we'd expect to be closer to X") and only when confidence is medium or high.`
      : ''

    const asksBlock = selection.asks.length
      ? selection.asks.map((a, i) => `${i + 1}. ${a.label}${a.savings ? ` (worth about ${fmt(a.savings)})` : ''}${a.reason === 'refreshed_quote' ? ' — THIS MUST BE THE FIRST ASK IN EVERY VARIANT' : ''}`).join('\n')
      : '- (none — write a short, friendly note that the buyer is happy with the quote and ready to proceed)'
    const stretchBlock = selection.stretch.length
      ? `\nSTRETCH (optional, mention at most one, only where it fits naturally, NEVER as a condition of signing):\n${selection.stretch.map((s) => `- ${s}`).join('\n')}`
      : ''

    const basePrompt = `Write 3 supplier-facing email variations in Kevin's style.

${EMAIL_RULES}

DEAL CONTEXT (already known from the analysis — do not ask the user for any of this):
Vendor: ${vendorName}
Contact Name: ${contactName || 'NOT AVAILABLE — use "Hi," as greeting'}
${quoteNumber ? `Quote reference: ${quoteNumber} — include it in the subject line and once in the body.` : ''}
Total Commitment: ${snapshot.total_commitment || 'not specified'}
Term: ${snapshot.term || 'not specified'}
Currency: ${currency}
Payment terms: ${snapshot.billing_payment || 'not specified'}
Pricing model: ${snapshot.pricing_model || 'not specified'}
${quoteExpired ? `QUOTE STATUS: the quote expired on ${expiredOn}. Its prices are historical. Every variant opens by asking for a refreshed quote that keeps the printed pricing and discounts as the starting point; nothing else is agreed until that arrives. Do not mention the old deadline as pressure.` : ''}
${targetAnchor ? `TARGET TOTAL: ${targetAnchor}. This is the ONE number to anchor on when you state a target (already rounded — use it exactly as written). Do not state any other total.` : ''}
${benchLine}
Situation: ${o.quick_read?.conclusion || o.verdict || 'Negotiation in progress'}
${dealTypeContext}

${contactName ? `The contact's first name is "${contactName}". Use "Hi ${contactName}," as the greeting in every email.` : ''}
SENDER NAME: ${senderName || '[Your Name]'}

THE ASKS TO RAISE — raise ALL of these, in THIS order, and no others. The first ask gets the most space:
${asksBlock}
${stretchBlock}

WHAT THE BUYER CAN OFFER IN RETURN (trade these against the asks where they fit naturally):
${offers.map((c: string) => `- ${c}`).join('\n') || '- fast signature once the points above are settled'}

LEVERAGE THE BUYER HAS (use the strongest one or two naturally — never state them as a list to the vendor):
${leverage.map((l: string) => `- ${l}`).join('\n') || '- (none specific — keep the tone collaborative rather than pushing hard on leverage)'}

WORDING GUARDS:
- RENEWAL UPLIFT POLICY: when an ask concerns renewal price increases, ask for CPI or ${UPLIFT_ASK_PCT}% whichever is lower; the only acceptable fallback is a hard cap of ${upliftCapCeiling(o.extraction?.renewalTerms)}%. Never write a cap higher than ${upliftCapCeiling(o.extraction?.renewalTerms)}%.
${allowNewLogo ? '- You may refer to the buyer as a new customer.' : '- NEVER write "new customer", "new logo", "first-time buyer" or any equivalent.'}
${allowAlternatives ? '- The competing quote / alternative below is real; you may reference it factually.' : '- NEVER claim the buyer is looking at alternatives, other vendors or competing quotes. None were provided.'}
- Never invent a budget figure, a deadline or a competing offer that is not in this context.

${negotiationObjective ? `BUYER'S STATED OBJECTIVE FOR THIS NEGOTIATION: ${negotiationObjective}\n` : ''}${budgetCeiling ? `BUYER'S BUDGET CEILING: ${budgetCeiling} — negotiate toward this, but do not reveal the exact ceiling number to the supplier unless it naturally helps close (e.g. "we have budget approved up to X" only if that serves the ask).\n` : ''}${allowAlternatives ? `COMPETING QUOTE / ALTERNATIVE THE BUYER HAS: ${competingQuote} — this is real leverage; reference it naturally and factually, do not exaggerate or invent details beyond what's given.\n` : ''}${walkAwayFlexibility && walkAwayContext[walkAwayFlexibility] ? `WALK-AWAY POSITION: ${walkAwayContext[walkAwayFlexibility]}\n` : ''}${internalDeadline ? `INTERNAL DEADLINE: ${internalDeadline} — use this to create realistic urgency where it fits.\n` : ''}${additionalInstructions ? `ADDITIONAL INSTRUCTIONS FROM THE BUYER (honor these):\n${additionalInstructions}\n` : ''}
${customPrompt ? `USER'S CUSTOM REQUEST (honor this above all else):\n${customPrompt}\n` : ''}
Return ONLY valid JSON (no markdown, no code fences):
{
  "emails": [
    { "label": "neutral", "subject": "email subject", "body": "email body" },
    { "label": "firm", "subject": "email subject", "body": "email body" },
    { "label": "final_push", "subject": "email subject", "body": "email body" }
  ]
}`

    const recommendedTone: EmailTone = recommendTone({
      leverageLevel: (pb.classification?.leverage_level as 'high' | 'medium' | 'low' | 'unclear' | undefined) || null,
      highSeverityFlagCount,
      walkAwayFlexibility: walkAwayFlexibility || null,
      isRenewal,
      hasInternalDeadline: !!internalDeadline,
    })

    // Emails stay in the language the round was generated in; switching the UI never flips a draft.
    const locale = outputLocale(round.output_json)
    const langInstruction = getLanguageInstruction(locale)

    const raw = (await runWithAiContext({ userId: user.id, dealId: round.deal_id, roundId }, () => getClaudeResponse({
      action: 'email_regenerate',
      system: KEVIN_SYSTEM_PROMPT + '\n' + langInstruction,
      userContent: basePrompt,
      temperature: 0.3,
      max_tokens: 2000,
    }))).trim() || '{}'

    let result
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
      result = JSON.parse(cleaned)
    } catch {
      console.error('Failed to parse regenerated emails:', raw)
      return NextResponse.json({ error: 'Failed to parse generated emails' }, { status: 500 })
    }

    if (!result.emails || !Array.isArray(result.emails) || result.emails.length < 3) {
      return NextResponse.json({ error: 'Invalid response format' }, { status: 500 })
    }

    // ── Persist ───────────────────────────────────────────────────────────
    const byLabel = (label: string) => result.emails.find((e: { label?: string }) => e?.label === label)
    const pick = (label: string, idx: number) => byLabel(label) ?? result.emails[idx]
    const removed: string[] = []
    const clean = (label: string, idx: number) => {
      const e = pick(label, idx)
      const s = sanitizeEmailBody(String(e?.body ?? ''), { newLogo: allowNewLogo, alternatives: allowAlternatives })
      removed.push(...s.removed)
      return { subject: String(e?.subject ?? ''), body: s.body }
    }
    const emailDrafts = { neutral: clean('neutral', 0), firm: clean('firm', 1), final_push: clean('final_push', 2) }
    if (removed.length) console.warn('[TermLift] email guard removed sentences:', removed.join(' | '))
    const emailContext = {
      negotiationObjective: negotiationObjective || null,
      budgetCeiling: budgetCeiling || null,
      competingQuote: competingQuote || null,
      walkAwayFlexibility: walkAwayFlexibility || null,
      internalDeadline: internalDeadline || null,
      additionalInstructions: additionalInstructions || customPrompt || null,
      benchmarkUsed: !!benchLine,
      // 2026-09-11: what the code decided, so the draft can be audited.
      selectedAsks: selection.asks,
      stretchAsks: selection.stretch,
      targetAnchor: target ? target.anchor : null,
      targetSource: target?.source ?? null,
      quoteExpired,
      allowNewLogo,
      allowAlternatives,
      guardRemoved: removed.length,
      generatedAt: new Date().toISOString(),
    }
    const { error: persistError } = await supabase
      .from('rounds')
      .update({
        email_regeneration_count: round.email_regeneration_count + 1,
        output_json: { ...(round.output_json as Record<string, unknown>), email_drafts: emailDrafts, email_context: emailContext, email_recommended_tone: recommendedTone },
      })
      .eq('id', roundId)
      .eq('user_id', user.id)
    if (persistError) {
      console.error('[TermLift] Failed to persist generated emails:', persistError.message)
      return NextResponse.json({ error: 'Emails were generated but could not be saved. Please try again.' }, { status: 500 })
    }

    return NextResponse.json({
      emails: [
        { label: 'neutral', ...emailDrafts.neutral },
        { label: 'firm', ...emailDrafts.firm },
        { label: 'final_push', ...emailDrafts.final_push },
      ],
      recommendedTone,
      selectedAsks: selection.asks.map((a) => a.label),
      targetAnchor: target?.anchor ?? null,
      remainingRegenerations: maxRegens - round.email_regeneration_count - 1
    })
  } catch (error) {
    console.error('Regenerate emails error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
