'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useI18n } from '@/i18n/context'
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
  const [error, setError] = useState<string | null>(null)
  const [exhausted, setExhausted] = useState(false)
  const started = useRef(false)

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

        {/* ── The flags / score pass, in flight: one line, no restarted progress story ── */}
        {error ? (
          <div className="rounded-[14px] border border-line bg-surface px-4 py-4 sm:px-5 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[16rem]">
              <p className="font-display font-bold text-[15px] text-ink leading-snug">{t('dealPage.pendingFailedTitle')}</p>
              <p className="text-[13px] text-ink-2 leading-relaxed mt-1">{error}</p>
            </div>
            {exhausted
              ? <Btn href="/app/new" variant="primary">{t('dealPage.pendingStartOver')}</Btn>
              : <Btn variant="primary" onClick={retry}>{t('dealPage.pendingRetry')}</Btn>}
          </div>
        ) : (
          <div role="status" className="rounded-[14px] border border-green-line bg-green-soft px-4 py-3.5 sm:px-5 flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-green-deep animate-spin shrink-0" />
            <p className="text-[13.5px] text-ink leading-snug"><span className="font-semibold">{t('dealPage.pendingTitle')}</span> <span className="text-ink-3">{t('dealPage.pendingBody')}</span></p>
          </div>
        )}
      </PageBody>
    </AppPage>
  )
}
