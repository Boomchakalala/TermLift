'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, Building2 } from 'lucide-react'
import { useI18n } from '@/i18n/context'
import { formatTotals, type VendorRow } from '@/lib/vendor-aggregate'
import { fmtCompact } from '@/lib/deal-metrics'
import type { Currency } from '@/lib/currency'
import { AppPage, PageHeader, PageBody, StatRow, StatTile, ScoreRing } from '@/components/system'

function sumTotals(rows: VendorRow[], key: 'totalsByCurrency' | 'savingsByCurrency'): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) for (const [cur, n] of Object.entries(r[key])) out[cur] = (out[cur] || 0) + n
  return out
}

/**
 * Vendors as cards, biggest spend first. A vendor is a relationship, not a
 * row: name, what you spend with them, what you've clawed back, how their
 * quotes score. The header strip totals the lot.
 */
export function VendorsListClient({ rows, baseCurrency = 'EUR' }: { rows: VendorRow[]; baseCurrency?: Currency }) {
  // One figure per tile in the base currency; the per-currency split stays as the sub line when a vendor bills in more than one.
  const base = (r: VendorRow, key: 'totalBase' | 'savingsBase', map: 'totalsByCurrency' | 'savingsByCurrency') => r[key] ?? Object.values(r[map]).reduce((s, n) => s + n, 0)
  const money = (n: number) => (n > 0 ? fmtCompact(n, baseCurrency) : '—')
  const split = (map: Record<string, number>) => (Object.keys(map).filter((k) => map[k] > 0).length > 1 ? formatTotals(map) : undefined)
  const { t, locale } = useI18n()
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = term ? rows.filter((r) => r.name.toLowerCase().includes(term) || r.aliases.some((a) => a.toLowerCase().includes(term))) : rows
    return [...list].sort((a, b) => base(b, 'totalBase', 'totalsByCurrency') - base(a, 'totalBase', 'totalsByCurrency'))
  }, [rows, q])
  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')

  const spendMap = sumTotals(rows, 'totalsByCurrency')
  const savedMap = sumTotals(rows, 'savingsByCurrency')
  const totalSpend = money(rows.reduce((s, r) => s + base(r, 'totalBase', 'totalsByCurrency'), 0))
  const totalSaved = money(rows.reduce((s, r) => s + base(r, 'savingsBase', 'savingsByCurrency'), 0))
  const dealCount = rows.reduce((s, r) => s + r.dealCount, 0)

  return (
    <AppPage>
      <PageHeader
        title={t('vendorsPage.title')}
        sub={t('vendorsPage.sub', { n: rows.length })}
        actions={rows.length > 0 ? (
          <label className="relative block w-full sm:w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('vendorsPage.search')} className="w-full h-9 pl-9 pr-3 rounded-lg border border-line bg-surface text-[13px] placeholder:text-ink-3 focus:outline-none focus:border-green focus:ring-[3px] focus:ring-green/15" />
          </label>
        ) : undefined}
      >
        {rows.length > 0 && (
          <StatRow flat className="mt-4 pt-4 border-t border-line-2">
            <StatTile flat label={t('vendorsPage.statVendors')} value={rows.length} sub={t('vendorsPage.cardDeals', { n: dealCount })} />
            <StatTile flat label={t('vendorsPage.statSpend')} value={totalSpend} sub={split(spendMap)} />
            <StatTile flat tone="money" label={t('vendorsPage.statSavedAll')} value={totalSaved} sub={split(savedMap)} />
            <StatTile flat label={t('vendorsPage.statScore')} value={(() => { const s = rows.filter((r) => r.avgScore != null); return s.length ? Math.round(s.reduce((a, r) => a + (r.avgScore as number), 0) / s.length) : '—' })()} />
          </StatRow>
        )}
      </PageHeader>
      <PageBody>
        {rows.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-line rounded-[14px] bg-surface">
            <span className="w-11 h-11 rounded-[10px] bg-ground grid place-items-center mx-auto mb-3"><Building2 className="w-5 h-5 text-ink-3" /></span>
            <p className="text-[15px] font-semibold text-ink">{t('vendorsPage.emptyTitle')}</p>
            <p className="text-[13px] text-ink-2 mt-1 max-w-[46ch] mx-auto">{t('vendorsPage.emptyBody')}</p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-[13px] text-ink-3 py-10 border border-dashed border-line rounded-[14px] bg-surface">{t('vendorsPage.noMatch', { q })}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map((v) => {
              const saved = base(v, 'savingsBase', 'savingsByCurrency')
              return (
                <Link key={v.id} href={`/app/vendors/${v.id}`} className="group no-underline bg-surface border border-line rounded-[14px] p-4 flex flex-col gap-3 transition-colors hover:border-[#C9D3CE]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display font-bold text-[16px] text-ink leading-tight truncate group-hover:text-green-deep transition-colors">{v.name}</p>
                      <p className="text-[12px] text-ink-3 mt-0.5 truncate">{v.aliases.length > 0 ? t('vendorsPage.alsoKnown', { names: v.aliases.join(', ') }) : t('vendorsPage.cardDeals', { n: v.dealCount })}</p>
                    </div>
                    {v.avgScore != null ? <ScoreRing score={v.avgScore} size={36} stroke={3.5} /> : <span className="tl-label text-ink-3 text-[10px] mt-1">{t('vendorsPage.noScore')}</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-3 border-t border-line-2">
                    <div className="min-w-0">
                      <p className="tl-label text-ink-3 text-[10px]">{t('vendorsPage.colTotal')}</p>
                      <p className="font-display font-bold text-[15px] text-ink tl-num mt-0.5 truncate">{money(base(v, 'totalBase', 'totalsByCurrency'))}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="tl-label text-ink-3 text-[10px]">{t('vendorsPage.colSaved')}</p>
                      <p className={`font-display font-bold text-[15px] tl-num mt-0.5 truncate ${saved > 0 ? 'text-green-deep' : 'text-ink-3'}`}>{money(saved)}</p>
                    </div>
                  </div>
                  <p className="text-[11.5px] text-ink-3">{t('vendorsPage.cardDeals', { n: v.dealCount })} · {t('vendorsPage.lastActivity', { d: fmtDate(v.lastActivity) })}</p>
                </Link>
              )
            })}
          </div>
        )}
      </PageBody>
    </AppPage>
  )
}
