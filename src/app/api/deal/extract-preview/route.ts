import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { CreateDealSchema } from '@/lib/schemas'
import { classifyQuote, extractFinancialFacts, validateTotalCommitment } from '@/lib/claude'
import { normalizeAmount, parseMoney } from '@/lib/currency'
import { checkRateLimit } from '@/lib/rate-limit'
import { runWithAiContext } from '@/lib/ai-telemetry'
import { textForPersistence } from '@/lib/extract'
import { resolveClassification } from '@/lib/claude/classification-guard'
import { inferDealTypeForPersistence } from '@/lib/deal-type-inference'
import { createTimer, logTimings, serverTimingHeader } from '@/lib/timings'

// Lightweight preview step ahead of /api/deal/create: runs the SAME
// classify+extract calls analyzeDeal() runs internally as its Steps 0+1,
// just exposed a beat earlier (~5-17s) so the UI can show real findings
// while the slower deep analysis is still in flight. The client hands the
// result back to /api/deal/create as precomputedClassification/
// precomputedFacts, which reuses it instead of re-deriving — no LLM calls
// beyond what analyzeDeal() already makes for a single analysis.
//
// Does not write a `rounds` row or increment usage_count — it's a preview
// of an analysis the user is about to run, not a billable analysis itself.
// checkRateLimit() is a read-only guard here (it counts existing `rounds`
// rows, so calling it doesn't consume anything) that stops a user who has
// already hit their real analysis limit from generating unlimited free
// preview calls.
export const maxDuration = 30

export async function POST(request: Request) {
  const timer = createTimer()
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin) {
      const rateLimit = await checkRateLimit(user.id)
      if (!rateLimit.allowed) {
        return NextResponse.json({ error: rateLimit.message || 'Rate limit exceeded' }, { status: 429 })
      }
    }

    const body = await request.json()
    const validated = CreateDealSchema.parse(body)

    const validPdfData = validated.pdfData?.base64 && validated.pdfData?.mimeType === 'application/pdf'
      ? { base64: validated.pdfData.base64, mimeType: validated.pdfData.mimeType }
      : undefined
    const allPages = (body as { allPages?: Array<{ base64: string; mimeType: string }> }).allPages || undefined

    // The classifier reads TEXT. For a file upload the browser sends no text,
    // so extract it server-side first (pdf-parse / OCR, best effort) — the
    // same text the create route persists for the Playbook.
    const pastedText = (validated.extractedText || '').trim()
    const classifyText = pastedText.length >= 10 && !/^\[.{0,80}\]$/.test(pastedText)
      ? pastedText
      : (await timer.time('parse_ms', () => textForPersistence({ extractedText: null, pdfData: validPdfData ?? null, imageData: validated.imageData ?? null, allPages: allPages ?? null }))) || ''

    // The ONE model read of the document (extract, cheap/fast model) — classify reads the text.
    const [classifiedRaw, facts] = await runWithAiContext({ userId: user.id }, () => timer.time('extract_ms', () => Promise.all([
      classifyQuote(classifyText, validated.dealType, validated.imageData, allPages, validPdfData),
      extractFinancialFacts(validated.extractedText || '', validated.dealType, validated.imageData, allPages, validPdfData),
    ])))

    facts.total_commitment = normalizeAmount(facts.total_commitment)
    const validation = validateTotalCommitment(facts.total_commitment, validated.extractedText || classifyText)
    if (validation.wasOverridden) {
      facts.total_commitment = validation.total
    }

    // Guard: a classification that could not read the document is rebuilt from the facts.
    const resolved = resolveClassification(classifiedRaw, facts, validated.dealType, parseMoney(facts.total_commitment).amount)
    const classification = resolved.classification

    // Deal-type suggestion for the form's selector: the extraction's own read,
    // the classifier's `recurring`, the text and the evidence spans.
    const inferredDealType = inferDealTypeForPersistence({
      snapshotDealType: facts.deal_type,
      recurring: classification.recurring,
      extractedText: classifyText,
      evidence: facts.deal_type_evidence,
      currentSubEnd: facts.current_sub_end,
    })

    const timings = timer.done()
    logTimings('extract-preview', timings)
    return NextResponse.json({ classification, facts, inferredDealType, classificationSource: resolved.replaced ? 'facts_fallback' : 'model', timings }, { headers: { 'Server-Timing': serverTimingHeader(timings) } })
  } catch (error) {
    console.error('Extract preview error:', error)
    return NextResponse.json({ error: 'Failed to preview quote' }, { status: 500 })
  }
}
