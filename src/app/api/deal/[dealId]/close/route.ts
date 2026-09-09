import { createClient } from '@/lib/supabase/server'
import { getClaudeResponse, getLanguageInstruction } from '@/lib/claude'
import { NextResponse } from 'next/server'
import { outputLocale } from '@/lib/output-language'
import { checkRateLimit } from '@/lib/rate-limit'
import { runWithAiContext } from '@/lib/ai-telemetry'
import { deriveCloseOutcome } from '@/lib/close-outcome'
import { buildVerificationRecord } from '@/lib/verification'

/**
 * Close a deal. The financial outcome is DERIVED here from two totals — the
 * quoted total on Round 1 and the final negotiated total the user confirmed —
 * never taken from a client-computed or AI-estimated savings figure. The
 * AI "close summary" below is narrative for the outcome page; it is written
 * after the numbers are fixed and never feeds back into them.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await context.params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: closeProfile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
    if (!closeProfile?.is_admin) {
      const rateLimit = await checkRateLimit(user.id)
      if (!rateLimit.allowed) {
        return NextResponse.json({ error: rateLimit.message || 'Rate limit exceeded' }, { status: 429 })
      }
    }

    const body = await request.json()
    const { outcome, finalTotal, finalTotalConfirmed, finalTotalEvidence, whatChanged, notes, verification: evidence } = body
    const validOutcomes = ['won', 'lost', 'paused', 'closed_won', 'closed_lost', 'closed_paused']
    if (!validOutcomes.includes(outcome)) {
      return NextResponse.json({ error: 'Invalid outcome' }, { status: 400 })
    }
    const plainOutcome = String(outcome).replace(/^closed_/, '') as 'won' | 'lost' | 'paused'

    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select(`*, rounds (*)`)
      .eq('id', dealId)
      .eq('user_id', user.id)
      .single()

    if (dealError || !deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const sortedRounds = deal.rounds?.sort((a: any, b: any) => a.round_number - b.round_number) || []
    const firstRound = sortedRounds[0]
    const latestRound = sortedRounds[sortedRounds.length - 1]
    const firstOutput = firstRound?.output_json
    const latestOutput = latestRound?.output_json

    // The quoted total is the Round 1 snapshot — what the negotiation started from.
    const originalSnapshot = firstOutput?.snapshot || latestOutput?.snapshot || {}
    const originalTotal = firstOutput?.snapshot?.total_commitment || latestOutput?.snapshot?.total_commitment

    const derived = deriveCloseOutcome({
      outcome: plainOutcome,
      initialTotalRaw: originalTotal ?? null,
      finalTotalRaw: finalTotal ?? null,
      finalTotalConfirmed: finalTotalConfirmed === true,
      finalTotalEvidence: finalTotalEvidence === 'document' ? 'document' : 'manual',
    })
    if (!derived.ok) {
      return NextResponse.json({ error: derived.error }, { status: 400 })
    }
    const o = derived.value

    const locale = outputLocale(firstOutput || latestOutput)
    const langInstruction = getLanguageInstruction(locale)

    // Narrative close summary for the outcome page (won deals only). Uses the
    // derived numbers as given facts; nothing it returns is stored as a number.
    let closeSummary: string | null = null
    if (firstOutput && o.status === 'closed_won') {
      try {
        const redFlags = firstOutput.red_flags?.map((f: any) => `- ${f.issue}: ${f.why_it_matters || ''}`).join('\n') || 'None'
        const mustHaves = firstOutput.what_to_ask_for?.must_have?.map((a: string) => `- ${a}`).join('\n') || 'None'
        const niceToHaves = firstOutput.what_to_ask_for?.nice_to_have?.map((a: string) => `- ${a}`).join('\n') || 'None'
        const verdict = firstOutput.verdict || ''
        const snapshot = originalSnapshot
        const summaryPrompt = `Analyze this closed procurement deal and return ONLY valid JSON (no markdown, no code fences).

DEAL CONTEXT:
- Vendor: ${deal.vendor || 'Unknown'}
- Product/Service: ${snapshot.vendor_product || 'Unknown'}
- Term: ${snapshot.term || 'Unknown'}
- Pricing model: ${snapshot.pricing_model || 'Unknown'}
- Original total (Round 1): ${originalTotal || 'Unknown'}
- Final total (confirmed by the buyer): ${o.finalTotal != null ? o.finalTotal.toLocaleString() : 'Not specified'}
- Cash savings (computed, do not change): ${o.savingsAmount != null ? o.savingsAmount.toLocaleString() : 'None'}${o.savingsPercent != null ? ` (${o.savingsPercent.toFixed(1)}%)` : ''}
- What user says changed: ${Array.isArray(whatChanged) && whatChanged.length ? whatChanged.join(', ') : 'Not specified'}
- User notes: ${notes || 'None'}
- Original verdict: ${verdict}

RED FLAGS FROM ANALYSIS:
${redFlags}

MUST-HAVE ASKS:
${mustHaves}

NICE-TO-HAVE ASKS:
${niceToHaves}

Return this exact JSON structure:
{
  "starting_position": "One factual sentence describing the original contract situation before negotiation, with key numbers.",
  "original_amount": "€111,600",
  "final_amount": "€94,800",
  "currency": "EUR",
  "cash_savings_amount": 16800,
  "cash_savings_percent": 15.1,
  "what_changed": ["Price", "Ad Fee", "Cancellation Policy"],
  "wins": [
    { "category": "PRICE", "description": "Reduced monthly retainer from €7,500 to €7,000", "financial_impact": "€6,000/year saved" },
    { "category": "LEGAL", "description": "Cancellation notice reduced from 60 to 30 days", "financial_impact": null }
  ],
  "next_action": "Set a calendar reminder 10 months from now to review renewal terms."
}

RULES:
1. starting_position: One factual sentence describing the original deal terms BEFORE negotiation. Include key numbers.
2. what_changed: Array of short tag labels describing EVERY area that changed. Auto-detect from the wins.
3. wins: 3-6 wins covering ALL improvements — both cash and non-cash. Each win needs:
   - category: exactly one of PRICE, CASH FLOW, LEGAL, RISK, TERMS, SCOPE, SLA, OTHER
   - description: one clear specific sentence with actual before/after numbers where applicable
   - financial_impact: a string describing the financial impact, or null for non-financial wins
4. next_action: one specific, actionable next step with a timeframe.
5. Use the given numbers as facts. Never recompute the savings. Never use generic placeholder text.
6. Return ONLY the JSON object. No markdown. No code fences. No explanation.`

        const rawResponse = await runWithAiContext({ userId: user.id, dealId }, () => getClaudeResponse({
          action: 'close_summary',
          system: 'You are a procurement analyst. Return ONLY valid JSON. No markdown. No code fences.' + langInstruction,
          userContent: summaryPrompt,
          temperature: 0.3,
          max_tokens: 700,
        }))
        try {
          const cleaned = rawResponse.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
          closeSummary = JSON.stringify(JSON.parse(cleaned))
        } catch {
          closeSummary = rawResponse
        }
      } catch (err) {
        console.error('Failed to generate close summary:', err)
      }
    }

    // Structured evidence behind the provenance tier. The final document itself
    // was never stored; what survives is its fingerprint, type and the figure
    // the model read from it — enough to show how the number was established.
    const verification = buildVerificationRecord({
      tier: o.provenance,
      method: o.provenance === 'document_verified' ? 'final_document_extract' : 'user_entry',
      confirmedTotal: o.finalTotal,
      currency: originalSnapshot.currency || null,
      evidence: evidence && typeof evidence === 'object' ? evidence : null,
    })

    const closedAt = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('deals')
      .update({
        status: o.status,
        closed_at: closedAt,
        initial_total: o.initialTotal,
        final_total: o.finalTotal,
        final_total_provenance: o.provenance,
        verification,
        savings_amount: o.savingsAmount,
        savings_percent: o.savingsPercent,
        what_changed: Array.isArray(whatChanged) ? whatChanged : null,
        close_notes: typeof notes === 'string' && notes.trim() ? notes : null,
        close_summary: closeSummary,
        updated_at: closedAt,
      })
      .eq('id', dealId)
      .eq('user_id', user.id)

    if (updateError) {
      console.error('Update error:', updateError)
      return NextResponse.json({ error: 'Failed to update deal' }, { status: 500 })
    }

    // The negotiation is over: the raw quote text has no reader left. Structured
    // facts on the rounds stay. Best-effort — the retention job repeats this daily.
    const { error: purgeError } = await supabase
      .from('rounds')
      .update({ extracted_text: null, extracted_text_purged_at: closedAt })
      .eq('deal_id', dealId)
      .eq('user_id', user.id)
      .not('extracted_text', 'is', null)
    if (purgeError) console.error('[close] raw text purge failed (non-fatal):', purgeError.message)

    return NextResponse.json({
      success: true,
      status: o.status,
      initialTotal: o.initialTotal,
      finalTotal: o.finalTotal,
      savingsAmount: o.savingsAmount,
      savingsPercent: o.savingsPercent,
      provenance: o.provenance,
    })
  } catch (error) {
    console.error('Close deal error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
