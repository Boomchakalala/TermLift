import { NextResponse } from 'next/server'
import { resolveRequestLocale } from '@/lib/request-locale'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { textForPersistence } from '@/lib/extract'
import { CreateDealSchema } from '@/lib/schemas'
import { analyzeDeal, type ExtractedFacts } from '@/lib/claude'
import { toStructuredExtraction } from '@/lib/structured-extraction'
import type { QuoteClassificationType } from '@/lib/schemas'
import { checkRateLimit } from '@/lib/rate-limit'
import { checkFreeQuota } from '@/lib/pricing'
import { getPlaybookAccess, consumeCredit } from '@/lib/billing'
import { resolveVendorForDeal } from '@/lib/vendor-resolve'
import { inferDealTypeForPersistence, applyChosenDealType } from '@/lib/deal-type-inference'
import { stripAdvancedOutput, SHOW_FULL_NEGOTIATION_PLAYBOOK } from '@/lib/negotiation-gating'
import { runWithAiContext } from '@/lib/ai-telemetry'
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
  const requestStart = Date.now()
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

    // Text to keep for Deep Analysis later: pasted text, else extracted from the
    // uploaded PDF/image now (best-effort). The file itself is never stored.
    // Computed BEFORE the analysis so the classifier reads it too (Haiku cannot
    // take a PDF) and deal-type inference can run while the text still exists.
    const persistText = await textForPersistence({
      extractedText: validated.extractedText,
      pdfData: validated.pdfData ?? null,
      imageData: validated.imageData ?? null,
      allPages: (body as any).allPages ?? null,
    })

    // Analyze with V1 (full text analysis — auto-retry on transient failures)
    const analysisStart = Date.now()
    // Pre-generate the deal's id so the analysis call below — which runs
    // before the deal row exists — can still be tagged with the real
    // deal_id in ai_usage_events, instead of leaving it null.
    const dealId = crypto.randomUUID()
    const output = await runWithAiContext({ userId: user.id, dealId }, () => withRetry(() => analyzeDeal(
      validated.extractedText || '',
      validated.dealType,
      validated.goal || undefined,
      validated.notes || undefined,
      undefined,
      validated.imageData,
      (body as any).allPages || undefined,
      locale,
      validPdfData,
      (profile as any)?.negotiation_preferences || undefined,
      precomputed,
      persistText || undefined,
    )))

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
    console.log(`[TermLift timing] analyzeDeal() total: ${Date.now() - analysisStart}ms`)

    // Auto-detect vendor
    const vendor = validated.vendor || output.vendor

    const dbStart = Date.now()

    // Create deal — using the id pre-generated above so it matches what
    // was already recorded against the analysis call's ai_usage_events rows.
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .insert({
        id: dealId,
        user_id: user.id,
        vendor,
        title: `${vendor} Â· ${validated.dealType === 'New' ? 'New Purchase' : 'Renewal'} Â· ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
        deal_type: validated.dealType,
        goal: validated.goal,
      })
      .select()
      .single()

    if (dealError || !deal) {
      throw new Error('Failed to create deal')
    }

    // Link to a vendor entity (best-effort â€” never blocks deal creation).
    try {
      const vendorId = await resolveVendorForDeal(supabase, user.id, vendor)
      if (vendorId) await supabase.from('deals').update({ vendor_id: vendorId }).eq('id', deal.id)
    } catch (e) {
      console.error('[TermLift] vendor link failed (non-fatal):', e)
    }

    // Create Round 1 (persistText was computed above, before the analysis)
    const { data: round, error: roundError } = await supabase
      .from('rounds')
      .insert({
        deal_id: deal.id,
        user_id: user.id,
        round_number: 1,
        note: validated.notes,
        // Always persisted now (previously gated on saveExtractedText) — deep
        // analysis (on-demand, triggered later from the deal page) needs the
        // original quote text and can't rely on it still being in the
        // browser's memory. Extracted text only, never the original file.
        extracted_text: persistText,
        output_json: { ...output, generated_locale: locale },
        // Structured facts from this analysis, kept so an outcome can be compared later without the quote text.
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

    const responseOutput = profile.is_admin || SHOW_FULL_NEGOTIATION_PLAYBOOK
      ? output
      : stripAdvancedOutput(output as DealOutput | DealOutputV2)

    console.log(`[TermLift timing] DB writes (deal+vendor+round+usage): ${Date.now() - dbStart}ms`)
    console.log(`[TermLift timing] TOTAL request (auth+limits+analysis+DB): ${Date.now() - requestStart}ms`)

    return NextResponse.json({
      dealId: deal.id,
      roundId: round.id,
      output: responseOutput,
    })
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

