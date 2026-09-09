'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'
import type { DealOutput } from '@/types'
import { useRouter } from 'next/navigation'
import { Loader2, Microscope } from 'lucide-react'
import { DealScrollView } from '@/components/DealScrollView'
import { DealHeaderClient } from '@/components/DealHeaderClient'
import { HeroVerdict } from '@/components/HeroVerdict'
import { NegotiationProgress } from '@/components/deal/NegotiationProgress'
import { NextActionCard } from '@/components/deal/NextActionCard'
import { TranslateControl, type LanguageView } from '@/components/deal/TranslateControl'
import { AppPage, BackLink, Btn, Chip, GateCard, PageBody, ScoreRing, StatRow, StatTile } from '@/components/system'
import { deriveDealStage, deriveNegotiationMode, stageChipKey, stageTone, type DealStage } from '@/lib/deal-stage'
import { deriveNegotiationFlow } from '@/lib/negotiation-flow'
import { hasDeepContent, deepAnalysisIsRunning, dealHasFullAnalysis } from '@/lib/deep-analysis-status'
import { benchmarkRanButUnavailable } from '@/lib/benchmark/visibility'
import { shortenVendorDisplayName } from '@/lib/vendor-normalize'
import {
  type DealLike, getCategory, getDealCurrency, getDealType, getFlagSeverity, getLatestRound, getPotentialSavings, getRedFlagCount,
  getRenewalDate, getSavingsRange, getScore, getTotalCommitment, getVendorName, isClosed as dealIsClosed, isWon as dealIsWon, fmtMoney, scoreHeadline,
} from '@/lib/deal-metrics'
import { normalizeAmount, parseMoney } from '@/lib/currency'
import { latestConfirmedVendorOffer } from '@/lib/vendor-offer'

export interface DealWorkspaceDeal extends DealLike {
  close_summary?: string | null
  what_changed?: string[] | null
}

export interface NegotiationRequestLite {
  id: string
  status: string
  negotiation_objective?: string | null
  walk_away_notes?: string | null
  competitor_context?: string | null
}

interface DealWorkspaceProps {
  deal: DealWorkspaceDeal
  /** app = signed-in real deal · demo = sample deal in the demo shell · trial = anonymous /try result (no shell) */
  mode: 'app' | 'demo' | 'trial'
  /** Flat message dictionaries DealScrollView still reads from (src/i18n/*.json). */
  messages: Record<string, Record<string, string>>
  isAdmin: boolean
  showFullPlaybook: boolean
  negotiationRequest?: NegotiationRequestLite | null
  addRoundForm?: ReactNode
  inferredDealType?: 'renewal' | 'new_purchase' | 'expansion' | 'unknown'
  /** Already-redacted output when the playbook is hidden (server decides). */
  latestOutputOverride?: unknown
  /** Generated-content language vs UI language (app mode only); drives the translate control. */
  languageView?: LanguageView
}

/**
 * The stage-based deal workspace: sticky header (one primary action that
 * changes with the stage), stage rail, verdict, stat tiles, then the existing
 * analysis sections, then the hand-off gate. Shared by /app, /demo and /try.
 */
export function DealWorkspace({ deal, mode, messages, isAdmin, showFullPlaybook, negotiationRequest, addRoundForm, inferredDealType, latestOutputOverride, languageView }: DealWorkspaceProps) {
  const { t, locale } = useI18n()
  const router = useRouter()
  // Captured once per mount so render stays pure (react-compiler rule).
  const [now] = useState(() => Date.now())
  const isTrial = mode === 'trial'
  const isDemo = mode === 'demo'
  const linkBase = isDemo ? '/demo' : '/app'

  const sortedRounds = [...(deal.rounds || [])].sort((a, b) => b.round_number - a.round_number)
  const latestRound = getLatestRound(deal)
  const latestOutput = (latestOutputOverride ?? latestRound?.output_json) as DealOutput | undefined
  const firstOutput = sortedRounds[sortedRounds.length - 1]?.output_json as DealOutput | undefined

  // ── Full Analysis run — owned here so the header, the next-step card and the
  // bottom gate all trigger the same request. Seeded from server truth so a
  // reload mid-run shows the in-progress state.
  const [deepLoading, setDeepLoading] = useState(deepAnalysisIsRunning(latestOutput))
  const [deepError, setDeepError] = useState<string | null>(null)
  const [closeOpen, setCloseOpen] = useState(false)
  if (!latestRound || !latestOutput) return null

  const openRequest = negotiationRequest && !negotiationRequest.status.startsWith('closed_') ? negotiationRequest : null
  const stage: DealStage = isTrial ? 'quick' : deriveDealStage({ status: deal.status, rounds: deal.rounds, negotiationRequestStatus: openRequest?.status })
  const negMode = isTrial ? null : deriveNegotiationMode({ status: deal.status, rounds: deal.rounds, negotiationRequestStatus: openRequest?.status })
  const termliftRuns = negMode === 'termlift' && !!openRequest
  const closed = dealIsClosed(deal)
  const won = dealIsWon(deal)
  const waitingOnClient = openRequest?.status === 'waiting_for_client_info'
  // Deal-level: Full Analysis unlocks once; later (quick-depth) rounds inherit it.
  const deepDone = hasDeepContent(latestOutput) || dealHasFullAnalysis(deal.rounds)
  const deepRunning = deepAnalysisIsRunning(latestOutput) || deepLoading

  const runFullAnalysis = async () => {
    if (isTrial || isDemo || deepLoading || deepDone) return
    setDeepLoading(true); setDeepError(null)
    try {
      const res = await fetch(`/api/deal/${deal.id}/deep-analysis`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Building the Playbook failed')
      router.refresh()
    } catch (err) {
      setDeepError(err instanceof Error ? err.message : 'Building the Playbook failed')
    } finally {
      setDeepLoading(false)
    }
  }

  const vendor = shortenVendorDisplayName(getVendorName(deal))
  const category = getCategory(deal)
  const dealType = getDealType(deal)
  const currency = getDealCurrency(deal)
  const totalCommitment = getTotalCommitment(deal)
  const originalTotal = firstOutput?.snapshot?.total_commitment
  const term = latestOutput.snapshot?.term
  const flags = getRedFlagCount(deal)
  const watchCount = latestOutput.watchItems?.length || 0
  const potential = getPotentialSavings(deal)
  const range = getSavingsRange(deal)
  const score = getScore(deal)
  // Headline from the score band, localised — not the stored score_label ("Low risk, minor improvements possible").
  const scoreLabel = score != null ? scoreHeadline(score, locale) : latestOutput.score_label
  const scoreRationale = latestOutput.score_rationale
  const verdict = latestOutput.verdict
  const targetRange = (latestOutput as unknown as { target_price_range?: { low: number; high: number } | null }).target_price_range || null
  // Market Benchmark (Deep Analysis): when the engine published a range, the tile shows the
  // model's clamped target (or the fair-market band) with the market position. Numbers come
  // from the engine result / clamped interpretation only.
  const bench = (latestOutput as DealOutput | undefined)?.market_benchmark
  const benchInterp = (latestOutput as DealOutput | undefined)?.benchmark_interpretation
  const benchTile = bench && bench.benchmark_available
    ? {
        value: benchInterp?.target_price != null ? fmtMoney(benchInterp.target_price, currency) : `${fmtMoney(bench.fair_market_low, currency)}–${fmtMoney(bench.fair_market_high, currency)}`,
        sub: bench.quote_vs_market_percent !== 0
          ? t('dealPage.statTargetBenchSub', { pct: `${bench.quote_vs_market_percent > 0 ? '+' : ''}${bench.quote_vs_market_percent}%` })
          : t('dealPage.statTargetBenchAt'),
      }
    : null
  const renewal = getRenewalDate(deal)
  const daysToRenewal = renewal ? Math.floor((renewal.getTime() - now) / 86400000) : null
  const sevCounts = (latestOutput.red_flags || []).reduce(
    (acc, f) => { acc[getFlagSeverity(f)]++; return acc },
    { high: 0, medium: 0, low: 0 } as Record<'high' | 'medium' | 'low', number>,
  )
  const achieved = deal.savings_amount && deal.savings_amount > 0 ? deal.savings_amount : 0
  const finalTotalRecorded = (deal as { final_total?: number | string | null }).final_total != null ? Number((deal as { final_total?: number | string | null }).final_total) : null
  const initialTotalRecorded = (deal as { initial_total?: number | string | null }).initial_total != null ? Number((deal as { initial_total?: number | string | null }).initial_total) : null
  const savingsPct = deal.savings_percent ?? (achieved && totalCommitment ? (achieved / parseMoney(totalCommitment).amount) * 100 : null)

  const dLocale = locale === 'fr' ? 'fr-FR' : 'en-US'
  const dateShort = (d: string | Date) => new Date(d).toLocaleDateString(dLocale, { month: 'short', day: 'numeric' })
  const dateFull = (d: string | Date) => new Date(d).toLocaleDateString(dLocale, { month: 'short', day: 'numeric', year: 'numeric' })

  const negotiateHref = isTrial ? '/negotiate' : isDemo ? '/negotiate' : `/app/deal/${deal.id}/negotiate`
  const negotiationPageHref = openRequest && !isDemo ? `/app/negotiations/${openRequest.id}` : negotiateHref

  // ── the guided flow: where the deal is, and the one thing to do next ──────
  const flow = deriveNegotiationFlow({
    dealId: deal.id,
    status: isTrial ? 'in_progress' : deal.status,
    rounds: (deal.rounds || []).map((r) => ({ round_number: r.round_number, output_json: r.round_number === latestRound.round_number ? latestOutput : r.output_json })),
    negotiationRequestStatus: isTrial ? null : openRequest?.status,
    negotiationPageHref,
  })
  const next = flow.next
  const nextLabel = next.cta[locale]
  // One dominant action, built once and shown in the header, the phone bar and the next-step card.
  let primary: ReactNode = null
  if (isTrial) primary = <Btn href="/login?from=trial" variant="primary">{t('dealPage.trialCta')}</Btn>
  else if (next.key === 'unlock_full' || next.key === 'full_running') {
    primary = isDemo
      ? <Btn href="/login?from=demo" variant="primary">{nextLabel}</Btn>
      : <Btn variant="primary" onClick={runFullAnalysis} disabled={deepRunning}>{deepRunning ? <><Loader2 className="w-4 h-4 animate-spin" />{t('dealPage.primaryRunning')}</> : <><Microscope className="w-4 h-4" />{deepError ? (locale === 'fr' ? 'Réessayer' : 'Try again') : nextLabel}</>}</Btn>
  }
  else if (next.key === 'open_negotiation') primary = <Btn href={next.href} variant={waitingOnClient ? 'primary' : 'ink'}>{nextLabel}</Btn>
  else if (next.key === 'view_outcome') primary = won ? <Btn href={next.href} variant="ghost">{nextLabel}</Btn> : null
  else primary = <Btn href={next.href} variant="primary">{nextLabel}</Btn>
  // Header/phone bar: the closed state has no forward action (the ⋯ menu carries reopen).
  const headerPrimary = closed ? null : primary
  const closeAside = next.offerClose && mode === 'app'
    ? <span className="text-ink-3">{t('dealPage.closeAside')} <button type="button" onClick={() => setCloseOpen(true)} className="font-semibold text-green-deep hover:underline">{t('dealPage.closeAsideCta')}</button></span>
    : null

  // ── verdict copy ─────────────────────────────────────────────
  let eyebrow: ReactNode
  let title: ReactNode
  let body: ReactNode
  if (won) {
    eyebrow = t('dealPage.verdictWonEyebrow', { date: deal.closed_at ? dateShort(deal.closed_at) : '' })
    title = achieved > 0 ? t('dealPage.verdictWonTitle', { v: fmtMoney(achieved, currency), pct: (savingsPct ?? 0).toFixed(1) }) : t('dealPage.verdictWonTitleNoAmount')
    // close_summary is stored as JSON (see the close route); show its narrative, never the raw object.
    body = (() => {
      const raw = deal.close_summary
      if (!raw) return scoreRationale || ''
      try {
        const p = JSON.parse(raw) as { starting_position?: string; next_action?: string }
        return [p.starting_position, p.next_action].filter(Boolean).join(' ') || scoreRationale || ''
      } catch { return raw }
    })()
  } else if (closed) {
    eyebrow = t('dealPage.verdictClosedEyebrow')
    title = scoreLabel || ''
    body = scoreRationale || ''
  } else if (termliftRuns) {
    eyebrow = t('dealPage.verdictTermliftEyebrow')
    title = waitingOnClient ? t('dealPage.verdictTermliftWaiting') : scoreLabel || ''
    body = waitingOnClient ? t('dealPage.verdictTermliftBody') : verdict || scoreRationale || ''
  } else {
    eyebrow = score != null ? t(stageChipKey(stage, negMode)) : ''
    title = scoreLabel || ''
    body = verdict || scoreRationale || ''
  }

  const stageChipLabel = won ? t('dealList.won') : closed ? t('dealList.noChange') : t(stageChipKey(stage, negMode))

  return (
    <AppPage className={isTrial ? '!mx-0 !my-0 min-h-0 rounded-[14px] border border-line overflow-hidden' : undefined}>
      {/* ── Sticky header ─────────────────────────────────────── */}
      {/* Sticky from tablet up only — on a phone the breadcrumb + title + rail would pin 40% of the screen. */}
      <div className={cn('bg-surface border-b border-line z-30', !isTrial && 'md:sticky', isDemo ? 'top-[44px]' : 'top-0')}>
        <div className="px-4 sm:px-6 pt-2.5 flex items-center gap-3 min-h-[30px]">
          {isTrial ? (
            <span className="text-[12.5px] text-ink-3">{t('dealPage.trialNotSaved')}</span>
          ) : (
            <>
              {/* Phone: one tappable back control; the trail is desktop-only. */}
              <BackLink href={linkBase} label={t('dealPage.crumbDeals')} className="md:hidden -my-1" />
              <nav className="hidden md:flex items-center gap-1.5 text-[12.5px] text-ink-3 min-w-0" aria-label="Breadcrumb">
                <Link href={linkBase} className="hover:text-ink-2 no-underline">{t('dealPage.crumbDeals')}</Link>
                <span aria-hidden>›</span>
                <span className="text-ink font-semibold truncate">{vendor}</span>
              </nav>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            {isDemo && <Chip>{t('dealPage.demoSample')}</Chip>}
            {mode === 'app' && languageView && <TranslateControl dealId={deal.id} view={languageView} />}
          </div>
        </div>
        <div className="px-4 sm:px-6 pt-1.5 pb-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-display font-bold text-[20px] tracking-[-0.02em] text-ink leading-tight truncate max-w-full">{vendor}</h1>
          <div className="flex flex-wrap gap-1.5">
            {category && category !== 'Other' && <Chip>{category}</Chip>}
            {dealType && <Chip>{dealType}</Chip>}
            <Chip tone={stageTone(stage, { won, waitingOnClient, mode: negMode })}>{stageChipLabel}</Chip>
            {sortedRounds.length > 1 && <Chip>{t('dealPage.rounds', { n: sortedRounds.length })}</Chip>}
          </div>
          {/* One action cluster: the next step · ⋯ (export / close / reopen). The hand-off lives at the bottom of the page. */}
          <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto [&>a]:flex-1 sm:[&>a]:flex-none [&>button]:flex-1 sm:[&>button]:flex-none">
            {headerPrimary}
            {mode === 'app' && (
              <DealHeaderClient
                dealId={deal.id}
                dealStatus={deal.status || 'in_progress'}
                closeSummary={deal.close_summary}
                savingsAmount={deal.savings_amount}
                savingsPercent={deal.savings_percent}
                closedAt={deal.closed_at}
                currentTotal={totalCommitment}
                originalTotal={originalTotal}
                roundCount={sortedRounds.length}
                whatChanged={deal.what_changed ?? null}
                isAdmin={isAdmin}
                confirmedOffer={latestConfirmedVendorOffer(deal.rounds)}
                closeModalOpen={closeOpen}
                onCloseModalOpenChange={setCloseOpen}
              />
            )}
          </div>
        </div>
        {/* Progress: Analysis → Strategy → Round 1 → Round 2 … → Outcome. Every step links to its section. */}
        <div className="px-4 sm:px-6 pb-2.5"><NegotiationProgress steps={flow.steps} locale={locale} /></div>
      </div>

      {/* Phone: the header scrolls away, so the one next-step action rides above the bottom nav. */}
      {!isTrial && !isDemo && headerPrimary && (
        <div className="md:hidden fixed left-0 right-0 z-30 px-4 py-2.5 bg-surface/95 backdrop-blur-sm border-t border-line flex gap-2 [&>a]:flex-1 [&>button]:flex-1" style={{ bottom: 'calc(58px + env(safe-area-inset-bottom))' }}>
          {headerPrimary}
        </div>
      )}

      <PageBody className={cn(isTrial && 'pb-4')}>
        {isDemo && <p className="text-[12.5px] text-ink-3 -mt-2">{t('dealPage.demoNote')}</p>}
        {/* ── Verdict ─────────────────────────────────────────── */}
        <div className={cn('rounded-[14px] border px-4 py-4 sm:px-5 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 sm:gap-5 items-start', won ? 'bg-green-soft border-green-line' : waitingOnClient ? 'bg-warn-soft border-warn-line' : 'bg-surface border-line')}>
          {/* Top-aligned with the verdict text (not centred on the whole card, which left it floating between the verdict and the reasons list). */}
          {score != null && <ScoreRing score={score} size={76} muted={closed && !won} className="mx-auto sm:mx-0 sm:mt-0.5" />}
          <div className="min-w-0 text-center sm:text-left">
            {eyebrow && <p className={cn('tl-label', waitingOnClient ? 'text-warn' : 'text-green-deep')}>{eyebrow}</p>}
            {title && <p className="font-display font-bold text-[16px] text-ink mt-1 leading-snug">{title}</p>}
            {body && <HeroVerdict text={String(body)} className="text-[13px] text-ink-2 mt-1 leading-relaxed max-w-[72ch] sm:mx-0 mx-auto" />}
            {/* No "top reasons" list here any more — it duplicated the first three red flags one screen below. The tile carries the count. */}
          </div>
        </div>

        {/* ── Stats — one story, left to right: what it costs → what you can win → why → when ── */}
        <StatRow>
          {/* 1. Savings — for a quick analysis this is a target ("up to €X"), not a promise */}
          <StatTile
            tone="money" hi={won && achieved > 0}
            label={won ? t('dealPage.statSaved') : t('dealPage.statSavings')}
            value={
              won && achieved > 0 ? fmtMoney(achieved, currency)
              : range && range.high > 0 ? t('dealPage.statUpTo', { v: fmtMoney(range.high, currency) })
              : potential > 0 ? fmtMoney(potential, currency)
              : '—'
            }
            sub={
              won && achieved > 0 && savingsPct != null ? t('dealPage.statAchieved', { pct: savingsPct.toFixed(1) })
              : range ? t('dealPage.statSavingsRange', { low: fmtMoney(range.low, currency), high: fmtMoney(range.high, currency) })
              : potential > 0 && latestOutput.potential_savings?.must_have?.length ? t('dealPage.statAsks', { n: latestOutput.potential_savings.must_have.length })
              : potential > 0 ? t('dealPage.statPotential')
              : t('dealPage.statSavingsNone')
            }
          />
          {/* 2. Target price (what to aim for) — falls back to Total / Final price */}
          {won ? (
            /* The recorded final total wins; the arithmetic fallback only serves deals closed before final_total existed. */
            <StatTile label={t('dealPage.statFinal')} tone="money" value={finalTotalRecorded != null ? fmtMoney(finalTotalRecorded, currency) : achieved > 0 && originalTotal ? fmtMoney(parseMoney(originalTotal).amount - achieved, currency) : totalCommitment ? normalizeAmount(totalCommitment) : '—'} sub={initialTotalRecorded != null ? t('dealPage.statWas', { v: fmtMoney(initialTotalRecorded, currency) }) : achieved > 0 && originalTotal ? t('dealPage.statWas', { v: normalizeAmount(originalTotal) }) : term || undefined} />
          ) : benchTile ? (
            <StatTile label={t('dealPage.statTargetLabel')} value={benchTile.value} sub={benchTile.sub} />
          ) : targetRange ? (
            <StatTile label={t('dealPage.statEstimatedTargetLabel')} value={`${fmtMoney(targetRange.low, currency)}–${fmtMoney(targetRange.high, currency)}`} sub={t('dealPage.statEstimatedTargetSub')} />
          ) : (
            <StatTile label={t('dealPage.statTotal')} value={totalCommitment ? normalizeAmount(totalCommitment) : '—'} sub={[term, latestOutput.snapshot?.billing_payment].filter(Boolean).join(' · ') || undefined} />
          )}
          {/* 3. Red flags, by severity */}
          <StatTile
            tone={won ? 'neutral' : flags > 0 ? 'risk' : 'neutral'}
            label={t('dealPage.statFlags')}
            value={flags}
            sub={
              flags === 0 ? t('dealPage.statNoFlags')
              : [sevCounts.high && t('dealPage.statHigh', { n: sevCounts.high }), sevCounts.medium && t('dealPage.statMed', { n: sevCounts.medium }), sevCounts.low && t('dealPage.statLow', { n: sevCounts.low })].filter(Boolean).join(' · ')
                || `${t('dealPage.statFlagsSub', { n: flags })}${watchCount > 0 ? ` · ${t('dealPage.statFlagsMinor', { n: watchCount })}` : ''}`
            }
          />
          {/* 4. The date that matters */}
          {won && deal.closed_at ? (
            <StatTile label={t('dealPage.statClosed')} value={dateShort(deal.closed_at)} sub={dateFull(deal.closed_at)} />
          ) : renewal ? (
            <StatTile label={t('dealPage.statRenewal')} tone={daysToRenewal != null && daysToRenewal >= 0 && daysToRenewal <= 90 ? 'warn' : 'neutral'} value={dateShort(renewal)} sub={daysToRenewal != null && daysToRenewal >= 0 ? t('dealPage.statInDays', { n: daysToRenewal }) : dateFull(renewal)} />
          ) : (
            <StatTile label={t('dealPage.statStarted')} value={dateShort(deal.created_at)} sub={dateFull(deal.created_at)} />
          )}
        </StatRow>

        {/* Full Analysis ran the benchmark engine and it had no comparable observations: say so, once, next to the target. */}
        {deepDone && benchmarkRanButUnavailable(bench) && (
          <p className="text-[12.5px] text-ink-3 leading-snug mt-2.5">{t('dealPage.benchNoDataNote')}</p>
        )}

        {/* "What should I do next?" — answered once, right under the numbers. Same action as the header.
            The trial shows the same card as a real quick-stage deal; only the button differs (sign up). */}
        {(primary || closed) && !waitingOnClient && (
          <NextActionCard next={next} locale={locale} action={primary} aside={isTrial ? undefined : closeAside} error={!isTrial && next.key === 'unlock_full' ? deepError : null} />
        )}

        {/* ── Analysis sections — each section is its own object on the ground ── */}
        <DealScrollView
            latestOutput={latestOutput}
            latestRoundId={latestRound.id as string}
            inferredDealType={inferredDealType}
            hasNegotiationRequest={!!openRequest}
            savedNegotiationContext={openRequest ? { objective: openRequest.negotiation_objective || undefined, walkAwayNotes: openRequest.walk_away_notes || undefined, competitorContext: openRequest.competitor_context || undefined } : undefined}
            isV2={(latestRound as { schema_version?: string }).schema_version === 'v2'}
            schemaVersion={(latestRound as { schema_version?: string }).schema_version || 'v1'}
            score={score}
            scoreLabel={scoreLabel}
            scoreRationale={scoreRationale}
            totalCommitment={totalCommitment || undefined}
            term={term}
            redFlagCount={flags}
            potentialSavings={potential}
            formatSavingsStr={potential > 0 ? fmtMoney(potential, currency) : undefined}
            dealCurrency={currency}
            sortedRounds={sortedRounds}
            dealId={isTrial ? 'trial' : deal.id}
            trialMode={isTrial}
            dealStatus={deal.status || 'in_progress'}
            locale={locale}
            closeSummary={deal.close_summary ?? null}
            savingsAmount={deal.savings_amount ?? null}
            savingsPercent={deal.savings_percent ?? null}
            closedAt={deal.closed_at ?? null}
            whatChanged={deal.what_changed ?? null}
            originalTotal={originalTotal}
            isAdmin={isAdmin}
            showFullPlaybook={showFullPlaybook}
            negotiateHref={negotiateHref}
            addRoundForm={addRoundForm ?? null}
            messages={messages}
            demoMode={isDemo}
            hideNextStep
            fullAnalysis={{ loading: deepLoading, error: deepError, run: runFullAnalysis }}
            flowPhase={flow.phase}
          />

        {/* ── Bottom service CTA: the other way to run the negotiation. Once, at the end of the flow, never a competing primary. ── */}
        {/* The trial shows it too: it is the visitor's only view of step 4 before they sign up. */}
        {((!isTrial && !closed && !openRequest && deepDone && showFullPlaybook) || isTrial) && (
          <GateCard
            tone="neutral"
            eyebrow={t('dealPage.serviceEyebrow')}
            title={t('dealPage.serviceTitle')}
            body={t('dealPage.serviceBody', { vendor })}
            action={<Btn href={negotiateHref} variant="ink">{t('dealPage.serviceCta')}</Btn>}
          />
        )}

        {/* ── TermLift negotiation status (only when a request exists; the offer itself lives inside step 3) ── */}
        {/* The active-handoff state is already the NextActionCard at the top; only "waiting on you" earns a second card. */}
        {!isTrial && !closed && openRequest && waitingOnClient && (
          <GateCard tone="warn" eyebrow={t('dealPage.handoffWaitingEyebrow')} title={t('dealPage.handoffWaitingTitle')} body={t('dealPage.handoffWaitingBody')} action={<Btn href={negotiationPageHref} variant="ink">{t('dealPage.handoffOpen')}</Btn>} />
        )}
      </PageBody>
    </AppPage>
  )
}
