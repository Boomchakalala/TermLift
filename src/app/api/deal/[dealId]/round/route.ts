import { NextResponse } from 'next/server'
import { resolveRequestLocale } from '@/lib/request-locale'
import { outputLocale } from '@/lib/output-language'
import { createClient } from '@/lib/supabase/server'
import { AddRoundSchema } from '@/lib/schemas'
import { analyzeDeal } from '@/lib/claude'
import { compareRounds } from '@/lib/claude/round-delta'
import { toStructuredExtraction } from '@/lib/structured-extraction'
import { extractVendorOffer, type VendorOffer } from '@/lib/vendor-offer'
import { applyChosenDealType } from '@/lib/deal-type-inference'
import { checkRateLimit } from '@/lib/rate-limit'
import { stripAdvancedOutput, SHOW_FULL_NEGOTIATION_PLAYBOOK } from '@/lib/negotiation-gating'
import { MAX_ROUNDS_PER_DEAL } from '@/lib/ai-limits'
import { runWithAiContext } from '@/lib/ai-telemetry'
import { dealHasFullAnalysis } from '@/lib/deep-analysis-status'
import type { DealOutput, DealOutputV2 } from '@/types'

// Allow up to 120s for classification + analysis with retries (Vercel Pro plan)
export const maxDuration = 120

/** Retry a function with exponential backoff on transient failures */
async function withRetry<T>(
  fn: () => Promise<T>,
  { maxAttempts = 3, baseDelayMs = 1000 } = {}
): Promise<T> {
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      const msg = lastError.message.toLowerCase()
      // Only retry on transient errors (overloaded, rate limit, network, timeout)
      const isTransient = msg.includes('overloaded') || msg.includes('529')
        || msg.includes('rate') || msg.includes('timeout')
        || msg.includes('econnreset') || msg.includes('socket')
        || msg.includes('503') || msg.includes('500')
        || msg.includes('ai_overloaded') || msg.includes('ai_analysis_error')
        || msg.includes('ai_parse_error') || msg.includes('ai_validation_error')
      if (!isTransient || attempt === maxAttempts) throw lastError
      const delay = baseDelayMs * Math.pow(2, attempt - 1)
      console.warn(`[TermLift] Attempt ${attempt}/${maxAttempts} failed (${lastError.message}), retrying in ${delay}ms...`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastError
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await params
    const supabase = await createClient()

    // Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile and check usage limit
    const { data: profile } = await supabase
      .from('profiles')
      .select('usage_count, is_admin, negotiation_preferences')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Rate limiting and free-quota enforcement (admins bypass)
    if (!profile.is_admin) {
      const rateLimit = await checkRateLimit(user.id)
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: rateLimit.message || 'Rate limit exceeded', remaining: rateLimit.remaining, resetAt: rateLimit.resetAt },
          { status: 429 }
        )
      }
      // No free-quota check here: rounds on an existing deal are covered by that deal's Playbook (pricing.ts).
    }

    // Parse request body
    const body = await request.json()
    const validated = AddRoundSchema.parse({ ...body, dealId })

    // Get deal
    const { data: deal } = await supabase
      .from('deals')
      .select('*')
      .eq('id', dealId)
      .eq('user_id', user.id)
      .single()

    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    // Get every previous round: the latest carries the context for this analysis,
    // and the whole set decides the deal's Full Analysis entitlement.
    const { data: previousRounds } = await supabase
      .from('rounds')
      .select('*')
      .eq('deal_id', dealId)
      .order('round_number', { ascending: false })

    const lastRound = previousRounds?.[0]
    const nextRoundNumber = lastRound ? lastRound.round_number + 1 : 1

    // Round 2+ belongs to the deal's unlocked negotiation workspace \u2014 the
    // UI already hides this action until Full Analysis is unlocked, but
    // "frontend hiding does NOT count as protection": enforce it here too,
    // since this endpoint is directly callable regardless of what the UI
    // shows. Entitlement is per deal (Full Analysis ran on one of its rounds;
    // a vendor reply analysed at quick depth inherits it). Round 1
    // (nextRoundNumber === 1) is always allowed \u2014 it IS the first analysis.
    if (nextRoundNumber > 1 && !profile.is_admin && !dealHasFullAnalysis(previousRounds)) {
      return NextResponse.json(
        { error: 'Build the Negotiation Playbook for this deal before adding another round.' },
        { status: 403 }
      )
    }

    // Hard safety ceiling on rounds per deal \u2014 a fair-use safeguard against
    // runaway model-call cost on one deal, not a marketed limit. Applies
    // regardless of plan, admin included; see lib/ai-limits.ts.
    if (nextRoundNumber > MAX_ROUNDS_PER_DEAL) {
      return NextResponse.json(
        { error: `This deal has reached the maximum of ${MAX_ROUNDS_PER_DEAL} negotiation rounds.` },
        { status: 429 }
      )
    }
    const previousOutput = lastRound?.output_json

    // The deal's language (Round 1), not the vendor reply's and not the UI cookie's.
    const locale = previousOutput ? outputLocale(previousOutput) : await resolveRequestLocale()

    // Analyze with context from previous round (auto-retry on transient failures)
    const output = await runWithAiContext({ userId: user.id, dealId }, () => withRetry(() => analyzeDeal(
      validated.extractedText,
      deal.deal_type,
      deal.goal || undefined,
      validated.note || undefined,
      previousOutput,
      undefined,
      undefined,
      locale,
      undefined,
      (profile as any)?.negotiation_preferences || undefined
    )))

    // The snapshot's deal type is the deal's stored type; the reply's own wording stays as evidence.
    applyChosenDealType(output as any, deal.deal_type as 'New' | 'Renewal')

    // Round 2+: what did the vendor's reply actually change? Optional — a
    // failure here never costs the user the round they just paid a call for.
    if (nextRoundNumber > 1 && previousOutput) {
      const delta = await runWithAiContext({ userId: user.id, dealId }, () => compareRounds(previousOutput, output, validated.extractedText, locale))
      if (delta) (output as Record<string, unknown>).round_delta = delta
    }

    // Round 2+: the vendor's current total, read from the analysis this round
    // already ran (no extra model call), checked deterministically and stored
    // as `inferred` until the user confirms it. Null when no reliable figure.
    let vendorOffer: VendorOffer | null = null
    if (nextRoundNumber > 1) {
      const prevOffer = lastRound?.vendor_offer as VendorOffer | null | undefined
      const prevExtraction = lastRound?.extracted_data as { total_commitment?: { amount?: number | null; currency?: string | null } } | null | undefined
      const previous = prevOffer?.amount != null
        ? { amount: prevOffer.amount, currency: prevOffer.currency }
        : { amount: prevExtraction?.total_commitment?.amount ?? null, currency: prevExtraction?.total_commitment?.currency ?? (previousOutput as { snapshot?: { currency?: string } } | undefined)?.snapshot?.currency ?? null }
      vendorOffer = extractVendorOffer({ output, replyText: validated.extractedText, previous, dealCurrency: previous.currency, source: validated.source ?? null })
    }

    // Create new round
    const { data: round, error: roundError } = await supabase
      .from('rounds')
      .insert({
        deal_id: dealId,
        user_id: user.id,
        round_number: nextRoundNumber,
        note: validated.note,
        extracted_text: validated.saveExtractedText ? validated.extractedText : null,
        output_json: { ...output, generated_locale: locale },
        extracted_data: toStructuredExtraction(output),
        vendor_offer: vendorOffer,
        output_markdown: renderMarkdown(output),
        status: 'done',
        model_version: 'claude-sonnet-4',
      })
      .select()
      .single()

    if (roundError || !round) {
      throw new Error('Failed to create round')
    }

    // Follow-up rounds are covered by the deal's Playbook and never consume a free quick analysis (pricing.ts).

    // Update deal's updated_at timestamp
    await supabase
      .from('deals')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', dealId)

    const responseOutput = profile.is_admin || SHOW_FULL_NEGOTIATION_PLAYBOOK
      ? output
      : stripAdvancedOutput(output as DealOutput | DealOutputV2)

    return NextResponse.json({
      roundId: round.id,
      output: responseOutput,
      vendorOffer,
    })
  } catch (error) {
    console.error('Add round error:', error)
    return NextResponse.json({
      error: 'Failed to add round. Please try again or contact support.'
    }, { status: 500 })
  }
}

// Helper to render markdown from output JSON. email_drafts and disclaimer
// are legacy fields the current fast pipeline (see lib/claude/index.ts)
// deliberately no longer produces — email generation moved to the on-demand
// /api/deal/regenerate-emails endpoint. Both sections are omitted cleanly
// when absent rather than assumed present.
function renderMarkdown(output: any): string {
  const emailDraftsSection = output.email_drafts ? `
## Email Drafts

### Neutral
**Subject:** ${output.email_drafts.neutral.subject}

${output.email_drafts.neutral.body}

### Firm
**Subject:** ${output.email_drafts.firm.subject}

${output.email_drafts.firm.body}

### Final Push
**Subject:** ${output.email_drafts.final_push.subject}

${output.email_drafts.final_push.body}
` : ''

  const disclaimerSection = output.disclaimer ? `
## Disclaimer
${output.disclaimer}
` : ''

  return `# ${output.title}

## Snapshot

**Vendor / Product:** ${output.snapshot?.vendor_product || output.vendor}

**Term:** ${output.snapshot?.term || 'N/A'}

**Total Commitment:** ${output.snapshot?.total_commitment || 'N/A'}

**Billing / Payment:** ${output.snapshot?.billing_payment || 'N/A'}

**Pricing Model:** ${output.snapshot?.pricing_model || 'N/A'}

**Deal Type:** ${output.snapshot?.deal_type || 'N/A'}

## Quick Read

**What's Solid:**
${(output.quick_read?.whats_solid || []).map((s: string) => `- ${s}`).join('\n')}

**What's Concerning:**
${(output.quick_read?.whats_concerning || []).map((s: string) => `- ${s}`).join('\n')}

**Conclusion:** ${output.quick_read?.conclusion || 'N/A'}

## Red Flags

${(output.red_flags || []).map((flag: any) => `
### ${flag.type}: ${flag.issue}

**Why it matters:** ${flag.why_it_matters}

**What to ask for:** ${flag.what_to_ask_for}

**If they push back:** ${flag.if_they_push_back}
`).join('\n')}

## Negotiation Plan

**Leverage You Have:**
${(output.negotiation_plan?.leverage_you_have || []).map((l: string) => `- ${l}`).join('\n')}

**Trades You Can Offer:**
${(output.negotiation_plan?.trades_you_can_offer || []).map((t: string) => `- ${t}`).join('\n')}

## What to Ask For

### Must-Have
${(output.what_to_ask_for?.must_have || []).map((ask: string) => `- ${ask}`).join('\n')}

### Nice-to-Have
${(output.what_to_ask_for?.nice_to_have || []).map((ask: string) => `- ${ask}`).join('\n')}
${emailDraftsSection}
## Assumptions
${(output.assumptions || []).map((a: string) => `- ${a}`).join('\n')}
${disclaimerSection}`
}
