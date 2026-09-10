export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { AddRoundForm } from './AddRoundForm'
import { DealWorkspace } from '@/components/deal/DealWorkspace'
import type { DealOutput, DealOutputV2 } from '@/types'
import { stripAdvancedOutput, stripFlagDetailForQuick, SHOW_FULL_NEGOTIATION_PLAYBOOK } from '@/lib/negotiation-gating'
import { hasDeepContent, dealHasFullAnalysis } from '@/lib/deep-analysis-status'
import { inferDealType } from '@/lib/deal-type-inference'
import { getLocale } from 'next-intl/server'
import { dealLocale, normalizeLocale } from '@/lib/output-language'
import type { LanguageView } from '@/components/deal/TranslateControl'
import { getPlaybookAccess } from '@/lib/billing'
import enMessages from '@/i18n/en.json'
import frMessages from '@/i18n/fr.json'

// One dictionary for the client instead of both languages: FR merged over EN so the
// fallback lookup in DealScrollView still resolves, at roughly half the payload.
function clientMessages(locale: string): Record<string, Record<string, string>> {
  const en = enMessages as unknown as Record<string, string>
  const dict = locale === 'fr' ? { ...en, ...(frMessages as unknown as Record<string, string>) } : en
  return { en: dict, [locale]: dict }
}

export default async function DealPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<{ original?: string; checkout?: string; session_id?: string }> }) {
  const { dealId } = await params
  const { original } = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, { data: deal }, { data: negotiationRequest }] = await Promise.all([
    supabase.from('profiles').select('is_admin').eq('id', user.id).single(),
    supabase.from('deals').select('*, rounds (*)').eq('id', dealId).eq('user_id', user.id).single(),
    supabase.from('negotiation_requests').select('id, status, negotiation_objective, walk_away_notes, competitor_context').eq('deal_id', dealId).eq('user_id', user.id).maybeSingle(),
  ])
  if (!deal) notFound()

  const isAdmin = !!profile?.is_admin
  const showFullPlaybook = isAdmin || SHOW_FULL_NEGOTIATION_PLAYBOOK
  // What the Playbook costs on this deal right now (free / included / due) — the client shows the right button.
  const playbookAccess = await getPlaybookAccess(user.id, dealId, isAdmin)

  // ── Generated-content language ──
  // The deal speaks Round 1's language. When the UI is in the other language and the
  // user asked for a translation, serve the cached copies (rounds.output_json is never changed).
  const uiLocale = normalizeLocale(await getLocale())
  const contentLocale = dealLocale(deal.rounds || [])
  let rounds = deal.rounds || []
  let languageView: LanguageView = { dealLocale: contentLocale, uiLocale, state: 'original', available: false }
  if (uiLocale !== contentLocale && rounds.length > 0) {
    const { data: translations } = await supabase
      .from('round_translations')
      .select('round_id, output_json')
      .eq('locale', uiLocale)
      .in('round_id', rounds.map((r: { id: string }) => r.id))
    const byRound = new Map((translations || []).map((t) => [t.round_id, t.output_json]))
    const available = rounds.every((r: { id: string }) => byRound.has(r.id))
    if (available && original !== '1') {
      rounds = rounds.map((r: { id: string; output_json: unknown }) => ({ ...r, output_json: byRound.get(r.id) ?? r.output_json }))
      languageView = { dealLocale: contentLocale, uiLocale, state: 'translated', available: true }
    } else {
      languageView = { dealLocale: contentLocale, uiLocale, state: available ? 'original' : 'untranslated', available }
    }
  }

  const sortedRounds = [...rounds].sort((a: { round_number: number }, b: { round_number: number }) => b.round_number - a.round_number)
  const latestRound = sortedRounds[0]
  const rawLatestOutput = latestRound?.output_json as DealOutput | DealOutputV2 | undefined
  // Redaction happens at the render boundary only — never at persistence.
  // Entitlement is per deal: a vendor reply analysed at quick depth (Round 2+) inherits Round 1's Full Analysis.
  const deepComplete = dealHasFullAnalysis(sortedRounds) || hasDeepContent(rawLatestOutput)
  const playbookOutput = rawLatestOutput && !showFullPlaybook ? stripAdvancedOutput(rawLatestOutput) : rawLatestOutput
  // Quick stage: per-flag asks/fallbacks stay server-side until Deep Analysis has run (admins included, so the gated view is what we QA).
  const latestOutput = playbookOutput && !deepComplete ? stripFlagDetailForQuick(playbookOutput) : playbookOutput

  // Deal-type inference: the value persisted at analysis time (before any purge) wins.
  // Inference on text is only run for deals analysed before it was persisted, and
  // only while their text still exists — never on a purged round.
  const persistedInference = (rawLatestOutput as { inferred_deal_type?: { type?: string; confidence?: string; currentSubLanguage?: boolean; user_confirmed_type?: string } } | undefined)?.inferred_deal_type
  const inferred = persistedInference?.type
    ? { type: persistedInference.type as ReturnType<typeof inferDealType>['type'], confidence: (persistedInference.confidence === 'high' ? 'high' : 'low') as 'high' | 'low' }
    : latestRound?.extracted_text
      ? inferDealType(((latestOutput as DealOutput | undefined)?.snapshot as { deal_type_stated?: string } | undefined)?.deal_type_stated ?? (latestOutput as DealOutput | undefined)?.snapshot?.deal_type, (rawLatestOutput as { classification?: { recurring?: boolean } } | undefined)?.classification?.recurring, latestRound.extracted_text)
      : { type: 'unknown' as const, confidence: 'low' as const }
  const currentSubLanguage = !!persistedInference?.currentSubLanguage || !!(rawLatestOutput as { snapshot?: { current_sub_end?: string } } | undefined)?.snapshot?.current_sub_end
  // "Looks like a renewal": stored type is New, nobody confirmed it, and the document reads like a renewal.
  const renewalSuggestion = deal.deal_type === 'New' && !persistedInference?.user_confirmed_type && (inferred.type === 'renewal' || inferred.type === 'expansion' || currentSubLanguage)

  // Strip extracted_text from what goes to the client.
  const clientDeal = {
    ...deal,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rounds: sortedRounds.map(({ extracted_text, ...r }: { extracted_text?: string | null } & Record<string, unknown>) => r),
  }

  return (
    <DealWorkspace
      mode="app"
      deal={clientDeal}
      latestOutputOverride={latestOutput}
      messages={clientMessages(uiLocale)}
      isAdmin={isAdmin}
      showFullPlaybook={showFullPlaybook}
      negotiationRequest={negotiationRequest ?? null}
      inferredDealType={inferred.type}
      renewalSuggestion={renewalSuggestion}
      languageView={languageView}
      playbookAccess={playbookAccess}
      addRoundForm={deepComplete ? <AddRoundForm dealId={dealId} roundNumber={sortedRounds.length + 1} /> : null}
    />
  )
}
