import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { runWithAiContext } from '@/lib/ai-telemetry'
import { translateOutput } from '@/lib/claude/translate-output'
import { CLAUDE_CLASSIFY_MODEL } from '@/lib/claude/client'
import { outputLocale, type OutputLocale } from '@/lib/output-language'

export const maxDuration = 120

/**
 * POST /api/deal/[dealId]/translate  { locale: 'en' | 'fr' }
 *
 * Translates the prose of every round's stored output into `locale` and caches
 * the copies in round_translations. Never re-runs analysis, never touches the
 * original output_json. Rounds already cached (or already in that language)
 * are skipped, so switching back and forth costs nothing after the first time.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const to = body?.locale as OutputLocale
  if (to !== 'en' && to !== 'fr') return NextResponse.json({ error: 'locale must be en or fr' }, { status: 400 })

  const { data: rounds } = await supabase
    .from('rounds')
    .select('id, round_number, output_json')
    .eq('deal_id', dealId)
    .eq('user_id', user.id)
    .order('round_number', { ascending: true })
  if (!rounds || rounds.length === 0) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  const { data: cached } = await supabase
    .from('round_translations')
    .select('round_id')
    .eq('locale', to)
    .in('round_id', rounds.map((r) => r.id))
  const done = new Set((cached || []).map((c) => c.round_id))

  const admin = createAdminClient()
  let translated = 0
  try {
    for (const round of rounds) {
      if (done.has(round.id) || !round.output_json) continue
      const from = outputLocale(round.output_json)
      if (from === to) continue
      const copy = await runWithAiContext({ userId: user.id, dealId, roundId: round.id }, () => translateOutput(round.output_json, from, to))
      const { error } = await admin
        .from('round_translations')
        .upsert({ round_id: round.id, user_id: user.id, locale: to, source_locale: from, output_json: copy, model: CLAUDE_CLASSIFY_MODEL }, { onConflict: 'round_id,locale' })
      if (error) throw new Error(error.message)
      translated++
    }
  } catch (err) {
    console.error('[TermLift] translate error:', err instanceof Error ? err.message : err)
    // Whatever was cached before the failure stays; the page keeps showing the original.
    return NextResponse.json({ error: 'Translation failed. The original analysis is unchanged; please try again.', detail: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }

  return NextResponse.json({ ok: true, translated, locale: to })
}
