import { createClient } from '@/lib/supabase/server'
import { getClaudeResponse, getLanguageInstruction, CLAUDE_MODEL_ID } from '@/lib/claude'
import { NextResponse } from 'next/server'
import { outputLocale } from '@/lib/output-language'
import { checkRateLimit } from '@/lib/rate-limit'
import { runWithAiContext } from '@/lib/ai-telemetry'

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

    // Parse optional body (finalDocumentText from uploaded doc, originalTotal override)
    let finalDocumentText: string | undefined
    let originalTotalOverride: string | undefined
    try {
      const body = await request.json()
      finalDocumentText = body?.finalDocumentText
      originalTotalOverride = body?.originalTotal
    } catch {
      // No body is fine — we'll compare rounds instead
    }

    // Get deal with all rounds
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select(`*, rounds (*)`)
      .eq('id', dealId)
      .eq('user_id', user.id)
      .single()

    if (dealError || !deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const rounds = deal.rounds || []
    if (rounds.length === 0) {
      return NextResponse.json({ error: 'No rounds to analyze' }, { status: 400 })
    }

    // Sort rounds by round_number ascending
    const sortedRounds = rounds.sort((a: any, b: any) => a.round_number - b.round_number)
    const firstRound = sortedRounds[0]
    const latestRound = sortedRounds[sortedRounds.length - 1]

    const firstOutput = firstRound.output_json

    if (!firstOutput) {
      return NextResponse.json({ error: 'Missing round data' }, { status: 400 })
    }

    // Build comparison prompt — either comparing rounds or comparing Round 1 vs uploaded final doc
    let prompt: string

    // Use the override total if provided (latest round's total from UI), otherwise fall back to Round 1
    const baselineTotal = originalTotalOverride || firstOutput.snapshot?.total_commitment || 'Unknown'

    if (finalDocumentText) {
      // Compare original quote against the uploaded final document
      prompt = `You are a procurement analyst. Compare the ORIGINAL quote analysis against the FINAL signed document to determine what was won in the negotiation.

ORIGINAL QUOTE (before negotiation):
- Total Commitment: ${baselineTotal}
- Term: ${firstOutput.snapshot?.term || 'Unknown'}
- Pricing Model: ${firstOutput.snapshot?.pricing_model || 'Unknown'}
- Billing/Payment: ${firstOutput.snapshot?.billing_payment || 'Unknown'}
- Red Flags Found: ${JSON.stringify(firstOutput.red_flags?.map((f: any) => f.issue) || [])}
- Must-Have Asks: ${JSON.stringify(firstOutput.what_to_ask_for?.must_have || [])}
- Nice-to-Have Asks: ${JSON.stringify(firstOutput.what_to_ask_for?.nice_to_have || [])}

FINAL SIGNED DOCUMENT:
${finalDocumentText}

Instructions:
- Read the final document carefully. Extract the final total, payment terms, and any terms that differ from the original analysis.
- Compare against the original total_commitment. Calculate savings_amount and savings_percent if both values are available.
- Identify which original red flags were addressed in the final document.
- Identify which must-have and nice-to-have asks were achieved.
- Look for any additional wins not in the original asks (e.g., complimentary items, extended terms, extras).
- For final_total, return the final contract value as a clean currency string (e.g., "$100,000" or "€100,000").
- For what_changed, pick from these options: Price, Term length, Payment terms, Auto-renewal, Cancellation policy, Scope, SLA/Support, Liability, Security, Other
- Write a 3-5 sentence summary of the negotiation outcome. Be specific about what was won.

Return ONLY valid JSON (no markdown, no code fences):
{
  "final_total": "<currency string>",
  "savings_amount": <number or null>,
  "savings_percent": <number or null>,
  "what_changed": [<strings from the options above>],
  "summary": "<3-5 sentence summary of wins>"
}`
    } else {
      // Compare rounds against each other
      const latestOutput = latestRound.output_json
      if (!latestOutput) {
        return NextResponse.json({ error: 'Missing round data' }, { status: 400 })
      }

      prompt = `You are a procurement analyst. Compare the first and latest rounds of a negotiation to estimate what was won.

FIRST ROUND (Round ${firstRound.round_number}):
- Total Commitment: ${baselineTotal}
- Term: ${firstOutput.snapshot?.term || 'Unknown'}
- Pricing Model: ${firstOutput.snapshot?.pricing_model || 'Unknown'}
- Billing/Payment: ${firstOutput.snapshot?.billing_payment || 'Unknown'}
- Red Flags: ${JSON.stringify(firstOutput.red_flags?.map((f: any) => f.issue) || [])}
- Must-Have Asks: ${JSON.stringify(firstOutput.what_to_ask_for?.must_have || [])}
- Nice-to-Have Asks: ${JSON.stringify(firstOutput.what_to_ask_for?.nice_to_have || [])}

LATEST ROUND (Round ${latestRound.round_number}):
- Total Commitment: ${latestOutput.snapshot?.total_commitment || 'Unknown'}
- Term: ${latestOutput.snapshot?.term || 'Unknown'}
- Pricing Model: ${latestOutput.snapshot?.pricing_model || 'Unknown'}
- Billing/Payment: ${latestOutput.snapshot?.billing_payment || 'Unknown'}
- Red Flags: ${JSON.stringify(latestOutput.red_flags?.map((f: any) => f.issue) || [])}
- Must-Have Asks: ${JSON.stringify(latestOutput.what_to_ask_for?.must_have || [])}
- Nice-to-Have Asks: ${JSON.stringify(latestOutput.what_to_ask_for?.nice_to_have || [])}
${latestOutput.quick_read?.conclusion ? `- Verdict: ${latestOutput.quick_read.conclusion}` : ''}

NUMBER OF ROUNDS: ${sortedRounds.length}

Instructions:
- Compare total_commitment values. If both are numeric, calculate savings_amount and savings_percent. Extract numbers from strings like "$50,000" or "50000/year".
- Identify which red flags from round 1 were resolved in later rounds.
- Identify which must-have asks were achieved.
- For what_changed, only pick from these options: Price, Term length, Payment terms, Auto-renewal, Scope, SLA/Support
- Write a 2-3 sentence summary of what was won in the negotiation.
- If you cannot determine savings (values not numeric or unclear), return null for savings_amount and savings_percent.

Return ONLY valid JSON (no markdown, no code fences):
{
  "savings_amount": <number or null>,
  "savings_percent": <number or null>,
  "what_changed": [<strings from the options above>],
  "summary": "<2-3 sentence summary>"
}`
    }

    const locale = outputLocale(firstOutput)
    const langInstruction = getLanguageInstruction(locale)

    const raw = (await runWithAiContext({ userId: user.id, dealId }, () => getClaudeResponse({
      action: 'close_estimate',
      system: 'You are a procurement analyst. Return only valid JSON, no markdown formatting or code fences.' + langInstruction,
      userContent: prompt,
      temperature: 0.3,
      max_tokens: 500,
    }))).trim() || '{}'

    let result
    try {
      // Strip code fences if present
      const cleaned = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
      result = JSON.parse(cleaned)
    } catch {
      console.error('Failed to parse AI response:', raw)
      return NextResponse.json({ error: 'Failed to parse AI estimation' }, { status: 500 })
    }

    return NextResponse.json({
      final_total: result.final_total ?? null,
      savings_amount: result.savings_amount ?? null,
      savings_percent: result.savings_percent ?? null,
      what_changed: result.what_changed || [],
      summary: result.summary || '',
      // Which model read the document — recorded on the verification record at close.
      model: finalDocumentText ? CLAUDE_MODEL_ID : null,
    })
  } catch (error) {
    console.error('Estimate close error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
