import { NextResponse } from 'next/server'
import { resolveRequestLocale } from '@/lib/request-locale'
import { analyzeDeal } from '@/lib/claude'
import { inferDealTypeForPersistence, applyChosenDealType } from '@/lib/deal-type-inference'
import { stripAdvancedOutput, stripFlagDetailForQuick, SHOW_FULL_NEGOTIATION_PLAYBOOK } from '@/lib/negotiation-gating'
import { runWithAiContext } from '@/lib/ai-telemetry'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { textForPersistence, transcribeForPersistence } from '@/lib/extract'
import { TRIAL_MAX_PER_IP_PER_DAY } from '@/lib/ai-limits'
import { FREE_ANALYSIS_LIMIT } from '@/lib/pricing'
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
      console.warn(`[TermLift] Trial attempt ${attempt}/${maxAttempts} failed (${lastError.message}), retrying in ${delay}ms...`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastError
}

// Guest trial - no auth required, uses V1 schema (full text analysis)
// 1 free analysis per IP without signup — then prompt to create account

function getClientIP(request: Request): string {
  // x-real-ip / x-vercel-forwarded-for are set by the platform proxy and can't be
  // spoofed by the client. x-forwarded-for CAN be: a client-sent value ends up as
  // the FIRST entry with the real IP appended after it — so take the LAST entry.
  const real = request.headers.get('x-real-ip') || request.headers.get('x-vercel-forwarded-for')
  if (real) return real.trim()
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded.split(',')
    return parts[parts.length - 1].trim()
  }
  return 'unknown'
}

// Backed by ai_usage_events (the same table cost telemetry writes to)
// instead of an in-memory Map — a serverless function's memory doesn't
// survive a cold start or span multiple instances, so the old in-memory
// version reset far more often than "once per IP per day" in production.
// Checking for a prior 'classify' event (always the first step of any
// analysis) is a reliable proxy for "this IP already ran a trial analysis,"
// whether or not that attempt ultimately succeeded.
async function checkTrialRateLimit(ip: string): Promise<{ allowed: boolean }> {
  if (ip === 'unknown') return { allowed: true } // can't track it; don't block genuine users over it
  try {
    const supabase = createAdminClient()
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count } = await supabase
      .from('ai_usage_events')
      .select('id', { count: 'exact', head: true })
      .eq('ip_address', ip)
      .eq('action', 'classify')
      .is('user_id', null)
      .gte('created_at', since)
    return { allowed: (count || 0) < TRIAL_MAX_PER_IP_PER_DAY }
  } catch (err) {
    // Fail closed, not open — a DB hiccup should never turn into unlimited
    // free anonymous AI calls, which is exactly what this check exists to
    // prevent. A user hitting this gets a normal retry-able error instead.
    console.error('[trial] Rate limit check failed, rejecting request:', err)
    return { allowed: false }
  }
}

async function isSignedInAdmin(): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const { data } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
    return !!data?.is_admin
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('Trial route: ANTHROPIC_API_KEY is not set')
      return NextResponse.json(
        { error: 'Analysis failed. Please try again or contact support.' },
        { status: 503 }
      )
    }

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const { extractedText, dealType, goal, notes, imageData, allPages, pdfData, structuredQuote, locale } = body

    // Validate BEFORE consuming the rate limit — a rejected paste shouldn't
    // burn the visitor's one free analysis.
    // Allow empty text when images or PDFs are provided
    const hasVisualInput = imageData?.base64 || (allPages && allPages.length > 0) || pdfData?.base64
    if (!hasVisualInput && (!extractedText || extractedText.length < 10)) {
      return NextResponse.json(
        { error: 'Please provide text to analyze' },
        { status: 400 }
      )
    }

    // IP-based rate limiting for trial route. A signed-in admin testing /try skips it.
    const clientIP = getClientIP(request)
    const rateLimit = (await isSignedInAdmin()) ? { allowed: true } : await checkTrialRateLimit(clientIP)

    if (!rateLimit.allowed) {
      const fr = (await resolveRequestLocale(locale)) === 'fr'
      return NextResponse.json(
        { error: fr
          ? `Vous avez utilisé votre analyse gratuite du jour. Créez un compte gratuit pour jusqu’à ${FREE_ANALYSIS_LIMIT} analyses rapides.`
          : `You’ve used today’s free analysis. Create a free account for up to ${FREE_ANALYSIS_LIMIT} Quick Analyses.` },
        { status: 429 }
      )
    }

    // Only pass imageData if it has required fields and a supported type (Anthropic accepts jpeg/png/gif/webp only)
    const supportedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    const validImageData =
      imageData?.base64 && imageData?.mimeType && supportedImageTypes.includes(imageData.mimeType)
        ? { base64: imageData.base64, mimeType: imageData.mimeType }
        : undefined

    // Validate all page images
    const validAllPages = allPages?.filter((p: any) =>
      p.base64 && p.mimeType && supportedImageTypes.includes(p.mimeType)
    ) || undefined

    // Validate PDF data
    const validPdfData = pdfData?.base64 && pdfData?.mimeType === 'application/pdf'
      ? { base64: pdfData.base64, mimeType: pdfData.mimeType }
      : undefined

    // Determine locale from cookie or request body
    const resolvedLocale = await resolveRequestLocale(locale)

    // Text the browser stashes with the trial so import-trial can persist it —
    // otherwise an uploaded trial imports with "[Document received]" as its text
    // and can never run Deep Analysis. Computed first so the classifier reads it.
    const docInput = { pdfData: validPdfData ?? null, imageData: validImageData ?? null, allPages: validAllPages ?? null }
    let persistText = await textForPersistence({ extractedText, ...docInput })
    // Parsers gave nothing: model transcription, in parallel with the analysis (see create/route.ts).
    const transcription = persistText ? null : transcribeForPersistence(docInput)

    // Analyze with V1 (full text analysis — auto-retry on transient failures)
    const output = await runWithAiContext({ ipAddress: clientIP }, () => withRetry(() => analyzeDeal(
      extractedText || '',
      dealType || 'New',
      goal,
      notes,
      undefined,
      validImageData,
      validAllPages && validAllPages.length > 0 ? validAllPages : undefined,
      resolvedLocale,
      validPdfData,
      undefined,
      undefined,
      persistText || undefined,
    )))
    if (!persistText && transcription) persistText = await transcription
    ;(output as any).inferred_deal_type = inferDealTypeForPersistence({
      snapshotDealType: (output as any)?.snapshot?.deal_type,
      recurring: (output as any)?.classification?.recurring,
      extractedText: persistText,
      evidence: (output as any)?.deal_type_evidence,
      currentSubEnd: (output as any)?.snapshot?.current_sub_end,
    })
    applyChosenDealType(output as any, dealType === 'Renewal' ? 'Renewal' : 'New')

    const playbookOutput = SHOW_FULL_NEGOTIATION_PLAYBOOK
      ? output
      : stripAdvancedOutput(output as DealOutput | DealOutputV2)
    // Trial = quick stage: per-flag asks/fallbacks stay server-side, same rule as /app/deal.
    const responseOutput = { ...stripFlagDetailForQuick(playbookOutput as DealOutput | DealOutputV2), generated_locale: resolvedLocale }

    return NextResponse.json({
      success: true,
      output: responseOutput,
      extractedText: persistText,
      message: 'Sign up to save your analysis and track negotiation rounds!'
    })
  } catch (error) {
    console.error('Trial analysis error:', error)
    return NextResponse.json({
      error: 'Analysis failed. Please try again or contact support.'
    }, { status: 500 })
  }
}
