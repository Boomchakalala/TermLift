import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { outputLocale } from '@/lib/output-language'
import { analyzeFromExtract, preparedFromOutput } from '@/lib/claude/index'
import { applyChosenDealType } from '@/lib/deal-type-inference'
import { toStructuredExtraction } from '@/lib/structured-extraction'
import { stripAdvancedOutput, SHOW_FULL_NEGOTIATION_PLAYBOOK } from '@/lib/negotiation-gating'
import { runWithAiContext } from '@/lib/ai-telemetry'
import { createTimer, logTimings, serverTimingHeader } from '@/lib/timings'
import type { DealOutput, DealOutputV2 } from '@/types'

// Phase 2 of the analysis (2026-09-11 perf split): verdict, flags, asks,
// savings and the deterministic score, computed from the extract persisted by
// /api/deal/create and the stored quote text. No document is attached to the
// model call. Idempotent per round: pending → running → done; a failed run
// goes back to pending so the page can retry (bounded, see MAX_ATTEMPTS).
export const maxDuration = 120

const MAX_ATTEMPTS = 4
/** A `running` older than this is a function that died mid-run; let the next request take over. */
const STALE_RUNNING_MS = 3 * 60 * 1000

type Status = 'pending' | 'running' | 'done' | 'failed'

function statusOf(output: unknown): Status {
  const s = (output as { analysis_status?: unknown } | null)?.analysis_status
  // Rounds analysed before the split have no field: they are complete.
  return s === 'pending' || s === 'running' || s === 'failed' ? s : 'done'
}

/** Retry a function with exponential backoff on transient failures */
async function withRetry<T>(fn: () => Promise<T>, { maxAttempts = 3, baseDelayMs = 1000 } = {}): Promise<T> {
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
      console.warn(`[TermLift] Analyze attempt ${attempt}/${maxAttempts} failed (${lastError.message}), retrying in ${delay}ms...`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastError
}

/** Status of the latest round's flags pass — lets the page recover a run whose response it lost. */
export async function GET(_request: Request, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: round } = await supabase
    .from('rounds').select('output_json').eq('deal_id', dealId).eq('user_id', user.id)
    .order('round_number', { ascending: false }).limit(1).single()
  if (!round) return NextResponse.json({ error: 'No analysis found for this deal' }, { status: 404 })
  return NextResponse.json({ status: statusOf(round.output_json) })
}

export async function POST(_request: Request, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params
  const timer = createTimer()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: profile }, { data: deal }, { data: round }] = await Promise.all([
    supabase.from('profiles').select('is_admin, negotiation_preferences').eq('id', user.id).single(),
    supabase.from('deals').select('id, deal_type, goal').eq('id', dealId).eq('user_id', user.id).single(),
    supabase.from('rounds').select('id, round_number, note, output_json, extracted_text').eq('deal_id', dealId).eq('user_id', user.id)
      .order('round_number', { ascending: false }).limit(1).single(),
  ])
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
  if (!round) return NextResponse.json({ error: 'No analysis found for this deal' }, { status: 404 })

  type StoredOutput = Record<string, unknown> & { snapshot?: { deal_type_stated?: string }; analysis_started_at?: string; analysis_attempts?: number; analysis_error?: string; inferred_deal_type?: unknown }
  const stored = (round.output_json || {}) as StoredOutput
  const isAdmin = !!profile?.is_admin
  const respond = (output: Record<string, unknown>, status: Status, extra: Record<string, unknown> = {}) => {
    const responseOutput = isAdmin || SHOW_FULL_NEGOTIATION_PLAYBOOK ? output : stripAdvancedOutput(output as DealOutput | DealOutputV2)
    return NextResponse.json({ status, output: responseOutput, ...extra })
  }

  const status = statusOf(stored)
  if (status === 'done') return respond(stored, 'done')
  if (status === 'failed') return NextResponse.json({ status: 'failed', error: stored.analysis_error || 'The analysis could not be completed for this quote.' }, { status: 422 })
  if (status === 'running') {
    const startedAt = Date.parse(String(stored.analysis_started_at || '')) || 0
    if (Date.now() - startedAt < STALE_RUNNING_MS) {
      return NextResponse.json({ status: 'running', error: 'The analysis is already running for this deal.' }, { status: 409 })
    }
    console.warn(`[TermLift] analyze: stale running flag on round ${round.id}; taking over`)
  }

  const prepared = preparedFromOutput(stored, deal.deal_type as 'New' | 'Renewal')
  if (!prepared) {
    return NextResponse.json({ status: 'failed', error: 'This deal has no stored extract to analyse from. Start a new analysis with the same quote.' }, { status: 422 })
  }

  const attempts = Number(stored.analysis_attempts || 0) + 1
  // Best-effort duplicate-request guard, same pattern as the Playbook route.
  await supabase.from('rounds')
    .update({ output_json: { ...stored, analysis_status: 'running', analysis_started_at: new Date().toISOString(), analysis_attempts: attempts } })
    .eq('id', round.id).eq('user_id', user.id)

  try {
    // The deal speaks Round 1's language; the flags pass generates in it.
    const locale = outputLocale(stored)
    const output = await runWithAiContext({ userId: user.id, dealId, roundId: round.id }, () => withRetry(() => analyzeFromExtract(prepared, round.extracted_text || '', {
      dealType: deal.deal_type as 'New' | 'Renewal',
      goal: deal.goal || undefined,
      notes: round.note || undefined,
      userLocale: locale,
      userPreferences: (profile as { negotiation_preferences?: Record<string, string> } | null)?.negotiation_preferences || undefined,
      timer,
    })))

    // Phase-1 decisions stay: the chosen deal type (form, inference, or a switch
    // made while this ran), the inference record, the language.
    applyChosenDealType(output, deal.deal_type as 'New' | 'Renewal')
    const merged: Record<string, unknown> = {
      ...stored,
      ...(output as Record<string, unknown>),
      snapshot: { ...output.snapshot, deal_type_stated: stored.snapshot?.deal_type_stated ?? output.snapshot?.deal_type_stated },
      inferred_deal_type: stored.inferred_deal_type,
      generated_locale: locale,
      analysis_status: 'done',
      analysis_attempts: attempts,
      analysis_completed_at: new Date().toISOString(),
    }
    delete merged.analysis_started_at
    delete merged.analysis_error

    const dbStart = Date.now()
    const { error: updateError } = await supabase.from('rounds')
      .update({ output_json: merged, extracted_data: toStructuredExtraction(merged) })
      .eq('id', round.id).eq('user_id', user.id)
    if (updateError) throw new Error('Failed to save analysis')
    timer.mark('db_ms', Date.now() - dbStart)

    const timings = timer.done()
    logTimings(`analyze deal=${dealId}`, timings)
    const res = respond(merged, 'done', { timings })
    res.headers.set('Server-Timing', serverTimingHeader(timings))
    return res
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[TermLift] analyze error:', msg)
    const exhausted = attempts >= MAX_ATTEMPTS
    const hint = msg.includes('AI_OVERLOADED') ? 'The AI service is temporarily busy. Please try again in a moment.'
      : msg.includes('AI_PARSE_ERROR') || msg.includes('AI_VALIDATION_ERROR') ? 'The AI response was incomplete. Please try again.'
      : 'The analysis failed. Please try again.'
    await supabase.from('rounds')
      .update({ output_json: { ...stored, analysis_status: exhausted ? 'failed' : 'pending', analysis_attempts: attempts, analysis_error: hint } })
      .eq('id', round.id).eq('user_id', user.id)
    return NextResponse.json({ status: exhausted ? 'failed' : 'pending', error: hint }, { status: exhausted ? 422 : 500 })
  }
}
