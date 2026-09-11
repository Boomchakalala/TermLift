import { NextResponse } from 'next/server'
import { resolveRequestLocale } from '@/lib/request-locale'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { textForPersistence, transcribeForPersistence } from '@/lib/extract'
import { CreateDealSchema } from '@/lib/schemas'
import { type ExtractedFacts } from '@/lib/claude'
import { prepareExtract, buildSnapshotOutput } from '@/lib/claude/index'
import { toStructuredExtraction } from '@/lib/structured-extraction'
import type { QuoteClassificationType } from '@/lib/schemas'
import { checkRateLimit } from '@/lib/rate-limit'
import { checkFreeQuota } from '@/lib/pricing'
import { getPlaybookAccess, consumeCredit } from '@/lib/billing'
import { resolveVendorForDeal } from '@/lib/vendor-resolve'
import { inferDealTypeForPersistence, applyChosenDealType } from '@/lib/deal-type-inference'
import { runWithAiContext } from '@/lib/ai-telemetry'
import { createTimer, logTimings, serverTimingHeader } from '@/lib/timings'

// Phase 1 of the analysis (2026-09-11 perf split): read the document ONCE
// (extract, reused from /api/deal/extract-preview when the client ran it),
// persist the extract + snapshot on the deal, return the deal id. The flags/
// score pass runs in a second request, POST /api/deal/[id]/analyze, from the
// stored extract and text — the file is never sent to the model again.
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
      const isTransient = msg.includes('overloaded') || msg.includes('529')
        || msg.includes('rate') || msg.includes('timeout')
        || msg.includes('econnreset') || msg.includes('socket')
        || msg.includes('503') || msg.includes('500')
        || msg.includes('ai_overloaded') || msg.includes('ai_analysis_error')
        || msg.includes('ai_parse_error') || msg.includes('ai_validation_error')
      if (!isTransient || attempt === maxAttempts) throw lastError
      const delay = baseDelayMs * Math.pow(2, attempt - 1)
      console.warn(`[TermLift] Create attempt ${attempt}/${maxAttempts} failed (${lastError.message}), retrying in ${delay}ms...`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastError
}

export async function POST(request: Request) {
  const timer = createTimer()
  try {
    const supabase = await createClient()

    // Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile and check usage limit
    let useCredit = false
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
      const quota = checkFreeQuota(profile.usage_count || 0)
      if (!quota.allowed) {
        // Past the free quick analyses a new deal is a Playbook deal: first one free, else a paid credit.
        const access = await getPlaybookAccess(user.id, null, false)
        if (!access.granted) return NextResponse.json({ error: quota.message, paymentRequired: true }, { status: 402 })
        if (access.kind === 'credit') useCredit = true
      }
    }

    // Parse request body
    const body = await request.json()
    const validated = CreateDealSchema.parse(body)

    // Determine locale from cookie or request body
    const locale = await resolveRequestLocale((body as any).locale)

    // Validate PDF data if provided
    const validPdfData = validated.pdfData?.base64 && validated.pdfData?.mimeType === 'application/pdf'
      ? { base64: validated.pdfData.base64, mimeType: validated.pdfData.mimeType }
      : undefined

    // If the client already ran /api/deal/extract-preview for this quote,
    // reuse that result instead of re-deriving it (avoids doubling the
    // classify+extract LLM calls). Trust boundary is the same as
    // extractedText/goal/notes below — it only affects the requesting
    // user's own deal, and a malformed value just fails the same way a
    // bad AI response already does (caught below, 500 with a retry hint).
    const precomputed = validated.precomputedClassification && validated.precomputedFacts
      ? {
          classification: validated.precomputedClassification as QuoteClassificationType,
          rawFacts: validated.precomputedFacts as ExtractedFacts,
        }
      : undefined

    // Text to keep on the round: pasted text, else extracted from the uploaded
    // PDF/image now (best-effort). The file itself is never stored. The flags
    // pass and the Playbook read this text + the extract, never the file.
    const docInput = { pdfData: validated.pdfData ?? null, imageData: validated.imageData ?? null, allPages: (body as any).allPages ?? null }
    let persistText = await timer.time('parse_ms', () => textForPersistence({ extractedText: validated.extractedText, ...docInput }))
    // Parsers gave nothing (image-only PDF, or no native parser on this host): have the model
    // transcribe the document, in parallel with the extraction. Without this the deal
    // was born without text and the Playbook could never run on it.
    const transcription = persistText ? null : transcribeForPersistence(docInput)

    // Pre-generate the deal's id so the extraction call below — which runs
    // before the deal row exists — can still be tagged with the real
    // deal_id in ai_usage_events, instead of leaving it null.
    const dealId = crypto.randomUUID()
    const prepared = await runWithAiContext({ userId: user.id, dealId }, () => withRetry(() => prepareExtract({
      extractedText: validated.extractedText || '',
      dealType: validated.dealType,
      imageData: validated.imageData,
      allPages: (body as any).allPages || undefined,
      pdfData: validPdfData,
      precomputed,
      textForClassification: persistText || undefined,
      timer,
    })))
    if (!persistText && transcription) persistText = await timer.time('parse_ms', () => transcription)

    // Phase-1 output: the snapshot the page can render now; flags/score follow.
    const output = buildSnapshotOutput(prepared, { dealType: validated.dealType })

    // Deal-type inference, persisted on the round BEFORE the raw text can be
    // purged (Playbook completion, close, retention). Nothing downstream may
    // re-run inference on a purged text.
    const inferredDealType = inferDealTypeForPersistence({
      snapshotDealType: (output as any)?.snapshot?.deal_type,
      recurring: (output as any)?.classification?.recurring,
      extractedText: persistText,
      evidence: (output as any)?.deal_type_evidence,
      currentSubEnd: (output as any)?.snapshot?.current_sub_end,
    })
    ;(output as any).inferred_deal_type = inferredDealType
    // The snapshot's deal type is the deal's CHOSEN type. What the document said is
    // kept as evidence (`deal_type_stated`) and was already fed to the inference above.
    applyChosenDealType(output as any, validated.dealType)

    // Auto-detect vendor
    const vendor = validated.vendor || (output.vendor as string)

    const dbStart = Date.now()

    // Create deal — using the id pre-generated above so it matches what
    // was already recorded against the extraction call's ai_usage_events rows.
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .insert({
        id: dealId,
        user_id: user.id,
        vendor,
        title: `${vendor} · ${validated.dealType === 'New' ? 'New Purchase' : 'Renewal'} · ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
        deal_type: validated.dealType,
        goal: validated.goal,
      })
      .select()
      .single()

    if (dealError || !deal) {
      throw new Error('Failed to create deal')
    }

    // Link to a vendor entity (best-effort — never blocks deal creation).
    try {
      const vendorId = await resolveVendorForDeal(supabase, user.id, vendor)
      if (vendorId) await supabase.from('deals').update({ vendor_id: vendorId }).eq('id', deal.id)
    } catch (e) {
      console.error('[TermLift] vendor link failed (non-fatal):', e)
    }

    // Create Round 1 with the snapshot-phase output (analysis_status: 'pending').
    const { data: round, error: roundError } = await supabase
      .from('rounds')
      .insert({
        deal_id: deal.id,
        user_id: user.id,
        round_number: 1,
        note: validated.notes,
        // Always persisted: the flags pass (next request) and the Playbook
        // (on demand) read this text — never the file. Extracted text only.
        extracted_text: persistText,
        output_json: { ...output, generated_locale: locale },
        // Structured facts from this extract, kept so an outcome can be compared later without the quote text.
        extracted_data: toStructuredExtraction(output),
        output_markdown: '', // V1 doesn't need markdown
        status: 'done',
        model_version: 'claude-sonnet-4',
        schema_version: 'v1',
      })
      .select()
      .single()

    if (roundError || !round) {
      throw new Error('Failed to create round')
    }

    // A credit bought from the new-deal gate is spent on this deal (its Playbook is then included).
    if (useCredit) await consumeCredit(user.id, deal.id)

    // Increment usage count (skip for admins and demo text)
    if (!profile.is_admin && !validated.isDemoText) {
      // usage_count is a server-owned column (users cannot update it); the service role writes it.
      await createAdminClient()
        .from('profiles')
        .update({ usage_count: profile.usage_count + 1 })
        .eq('id', user.id)
    }
    timer.mark('db_ms', Date.now() - dbStart)

    const timings = timer.done()
    logTimings('create', timings)

    return NextResponse.json({
      dealId: deal.id,
      roundId: round.id,
      output,
      // The flags/score pass has not run yet: the client lands on the deal page,
      // which triggers POST /api/deal/[id]/analyze and fills the rest in.
      analysisStatus: 'pending',
      timings,
    }, { headers: { 'Server-Timing': serverTimingHeader(timings) } })
  } catch (error) {
    console.error('Create deal error:', error)
    const msg = error instanceof Error ? error.message : ''
    const hint = msg.includes('AI_OVERLOADED') ? 'The AI service is temporarily busy. Please try again in a moment.'
      : msg.includes('AI_PARSE_ERROR') ? 'The AI returned an unexpected format. Please try again.'
      : msg.includes('AI_VALIDATION_ERROR') ? 'The AI response was incomplete. Please try again.'
      : msg.includes('AI_ANALYSIS_ERROR') ? 'The analysis failed. Please try again or use a shorter quote.'
      : (msg.includes('timeout') || msg.includes('aborted')) ? 'The analysis took too long. Please try again with a shorter quote.'
      : 'Failed to create deal. Please try again or contact support.'
    return NextResponse.json({ error: hint }, { status: 500 })
  }
}
