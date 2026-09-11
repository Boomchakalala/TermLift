'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'
import type { DealOutput } from '@/types'
import { AppPage, BackLink, Btn, Chip, PageBody, StatRow, StatTile } from '@/components/system'
import { shortenVendorDisplayName } from '@/lib/vendor-normalize'
import { type DealLike, getCategory, getDealType, getRenewalDate, getTotalCommitment, getVendorName } from '@/lib/deal-metrics'
import { normalizeAmount } from '@/lib/currency'
import { isExpired, toIsoDate } from '@/lib/scoring'

/**
 * Phase 1 of the deal page (2026-09-11 two-phase analysis): the extract exists,
 * so the snapshot (vendor, total, term, billing, deal type, expiry) renders at
 * once; flags, score and asks arrive when POST /api/deal/[id]/analyze completes.
 * This component owns that request: it fires it once on mount, follows a run
 * another request started (409 → poll), and refreshes the page when it is done.
 */
export function AnalysisPending({ deal, output }: { deal: DealLike; output: DealOutput }) {
  const { t, locale } = useI18n()
  const router = useRouter()
  const [now] = useState(() => Date.now())
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [exhausted, setExhausted] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.round((Date.now() - now) / 1000)), 1000)
    return () => clearInterval(id)
  }, [now])

  useEffect(() => {
    if (started.current) return
    started.current = true
    let retried = false

    const poll = async () => {
      // Another request (a double navigation, another tab) is running the pass, or ours dropped: follow it.
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 5000))
        const st = await fetch(`/api/deal/${deal.id}/analyze`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { status?: string } | null
        if (st?.status === 'done') { router.refresh(); return }
        if (st?.status === 'failed') { setExhausted(true); setError(t('dealPage.pendingFailedBody')); return }
        if (st?.status === 'pending') { await run(); return }
      }
    }
    const run = async () => {
      try {
        const res = await fetch(`/api/deal/${deal.id}/analyze`, { method: 'POST' })
        if (res.status === 409) return poll()
        const data = await res.json().catch(() => ({})) as { status?: string; error?: string }
        if (res.ok) { router.refresh(); return }
        if (data.status === 'pending' && !retried) { retried = true; return run() }
        setExhausted(data.status === 'failed')
        setError(data.error || t('dealPage.pendingFailedBody'))
      } catch {
        return poll()
      }
    }
    void run()
  }, [deal.id, router, t])

  // Manual retry after a failed pass (the server caps total attempts; a 409 means a run is already going).
  const retry = async () => {
    setError(null); setExhausted(false)
    const res = await fetch(`/api/deal/${deal.id}/analyze`, { method: 'POST' }).catch(() => null)
    if (res?.ok || res?.status === 409) { router.refresh(); return }
    const data = await res?.json().catch(() => ({})) as { status?: string; error?: string } | undefined
    setExhausted(data?.status === 'failed')
    setError(data?.error || t('dealPage.pendingFailedBody'))
  }

  const vendor = shortenVendorDisplayName(getVendorName(deal))
  const category = getCategory(deal)
  const dealType = getDealType(deal)
  const totalCommitment = getTotalCommitment(deal)
  const snap = output.snapshot || ({} as DealOutput['snapshot'])
  const term = snap.term
  const billing = snap.billing_payment
  const renewal = getRenewalDate(deal)
  const lo = output as unknown as { quote_expired?: boolean; extraction?: { quoteDates?: { expires?: string | null } }; snapshot?: { quote_expires?: string; signing_deadline?: string; quote_number?: string } }
  const quoteExpiresRaw = lo.extraction?.quoteDates?.expires ?? lo.snapshot?.quote_expires ?? lo.snapshot?.signing_deadline ?? null
  const quoteExpiresIso = toIsoDate(quoteExpiresRaw)
  const quoteExpired = lo.quote_expired === true || isExpired(quoteExpiresIso, new Date(now).toISOString().slice(0, 10))
  const dLocale = locale === 'fr' ? 'fr-FR' : 'en-US'
  const dateLong = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(dLocale, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  const dateShort = (d: string | Date) => new Date(d).toLocaleDateString(dLocale, { month: 'short', day: 'numeric' })
  const dateFull = (d: string | Date) => new Date(d).toLocaleDateString(dLocale, { month: 'short', day: 'numeric', year: 'numeric' })
  const quoteExpiredLabel = quoteExpiresIso ? dateLong(quoteExpiresIso) : String(quoteExpiresRaw || '')

  const stages = [
    { label: t('dealPage.pendingStage1'), at: 0 },
    { label: t('dealPage.pendingStage2'), at: 2 },
    { label: t('dealPage.pendingStage3'), at: 18 },
  ]
  const currentIdx = error ? -1 : stages.reduce((acc, s, i) => (elapsed >= s.at ? i : acc), 0)

  return (
    <AppPage>
      <div className="bg-surface border-b border-line z-30 md:sticky top-0">
        <div className="px-4 sm:px-6 pt-2.5 flex items-center gap-3 min-h-[30px]">
          <BackLink href="/app" label={t('dealPage.crumbDeals')} className="md:hidden -my-1" />
          <nav className="hidden md:flex items-center gap-1.5 text-[12.5px] text-ink-3 min-w-0" aria-label="Breadcrumb">
            <Link href="/app" className="hover:text-ink-2 no-underline">{t('dealPage.crumbDeals')}</Link>
            <span aria-hidden>›</span>
            <span className="text-ink font-semibold truncate">{vendor}</span>
          </nav>
        </div>
        <div className="px-4 sm:px-6 pt-1.5 pb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-display font-bold text-[20px] tracking-[-0.02em] text-ink leading-tight truncate max-w-full">{vendor}</h1>
          <div className="flex flex-wrap gap-1.5">
            {category && category !== 'Other' && <Chip>{category}</Chip>}
            {dealType && <Chip>{dealType}</Chip>}
            <Chip tone="warn" mono>{t('dealPage.pendingChip')}</Chip>
          </div>
        </div>
      </div>

      <PageBody>
        {quoteExpired && (
          <div role="status" className="rounded-[14px] border border-warn-line bg-warn-soft px-4 py-3 sm:px-5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Chip tone="warn" mono>{t('dealPage.historicalChip')}</Chip>
            <p className="text-[13px] text-ink leading-snug flex-1 min-w-[16rem]">{t('dealPage.quoteExpiredBanner', { date: quoteExpiredLabel })}</p>
          </div>
        )}

        {/* ── Snapshot: every value here comes from the persisted extract ── */}
        <StatRow>
          <StatTile tone="money" label={t('dealPage.statTotal')} value={totalCommitment ? normalizeAmount(totalCommitment) : '—'} sub={lo.snapshot?.quote_number ? `#${lo.snapshot.quote_number}` : undefined} />
          <StatTile label={t('dealPage.pendingStatTerm')} value={term || '—'} sub={billing || undefined} />
          <StatTile label={t('dealPage.pendingStatDealType')} value={snap.deal_type || dealType || '—'} sub={snap.pricing_model || undefined} />
          {renewal ? (
            <StatTile label={t('dealPage.statRenewal')} value={dateShort(renewal)} sub={dateFull(renewal)} />
          ) : quoteExpiresIso ? (
            <StatTile label={t('dealPage.pendingStatValidUntil')} tone={quoteExpired ? 'warn' : 'neutral'} value={dateShort(`${quoteExpiresIso}T00:00:00Z`)} sub={dateFull(`${quoteExpiresIso}T00:00:00Z`)} />
          ) : (
            <StatTile label={t('dealPage.statStarted')} value={dateShort(deal.created_at)} sub={dateFull(deal.created_at)} />
          )}
        </StatRow>

        {/* ── The flags / score pass, in flight ── */}
        <div className={cn('rounded-[14px] border px-4 py-4 sm:px-5', error ? 'bg-surface border-line' : 'bg-green-soft border-green-line')}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="font-display font-bold text-[16px] text-ink leading-snug">{error ? t('dealPage.pendingFailedTitle') : t('dealPage.pendingTitle')}</p>
            {!error && <span className="text-[12px] font-medium text-green-deep tabular-nums" style={{ fontFamily: 'var(--font-jetbrains), monospace' }}>{elapsed}s</span>}
          </div>
          {error ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[13px] text-ink-2 leading-relaxed flex-1 min-w-[16rem]">{error}</p>
              {exhausted
                ? <Btn href="/app/new" variant="primary">{t('dealPage.pendingStartOver')}</Btn>
                : <Btn variant="primary" onClick={retry}>{t('dealPage.pendingRetry')}</Btn>}
            </div>
          ) : (
            <>
              <div className="space-y-2.5">
                {stages.map((s, i) => {
                  const done = i < currentIdx
                  const active = i === currentIdx
                  return (
                    <div key={s.label} className="flex items-center gap-3">
                      {done ? <CheckCircle2 className="w-5 h-5 text-green-deep shrink-0" /> : active ? <Loader2 className="w-5 h-5 text-green-deep animate-spin shrink-0" /> : <div className="w-5 h-5 rounded-full border-2 border-line shrink-0" />}
                      <p className={cn('text-[13.5px] font-semibold', done ? 'text-ink-3' : active ? 'text-ink' : 'text-ink-3 opacity-60')}>{s.label}</p>
                    </div>
                  )
                })}
              </div>
              <p className="text-[12.5px] text-ink-3 mt-4 leading-relaxed">{t('dealPage.pendingBody')}</p>
            </>
          )}
        </div>
      </PageBody>
    </AppPage>
  )
}
