import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { Insights } from '@/lib/deal-insights'
import { fmtCompact, fmtMoney } from '@/lib/deal-metrics'
import { Card, Chip, SectionHeading, Table, TableHead, TableRow, HideM, NameCell } from '@/components/system'

/**
 * Insights tab. Server-rendered, pure — every number comes from computeInsights().
 * Order: the savings story first (numbers + chart), then the money still on
 * the table and the flags that keep recurring, then where the money goes and
 * how the quotes score, then what's coming (renewals), then the record.
 */
export async function HomeInsights({ insights: I, linkBase = '/app', locale = 'en' }: { insights: Insights; linkBase?: string; locale?: string }) {
  const t = await getTranslations('insights')
  const cur = I.baseCurrency
  const maxCat = I.categories[0]?.spend || 1
  const dLocale = locale === 'fr' ? 'fr-FR' : 'en-US'
  const dateFmt = (d: Date | string) => new Date(d).toLocaleDateString(dLocale, { month: 'short', day: 'numeric', year: 'numeric' })
  const avgSaving = I.wonCount ? Math.round(I.savingsAchieved / I.wonCount) : 0

  const Bar = ({ pct, cls = 'bg-green' }: { pct: number; cls?: string }) => (
    <div className="h-1.5 rounded-full bg-line-2 overflow-hidden"><div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></div>
  )

  // ── Savings chart geometry (SVG, no library) ─────────────────────────────
  const S = I.savingsMonthly
  const W = 560, H = 190, padL = 44, padR = 12, padT = 26, padB = 26
  const innerW = W - padL - padR, innerH = H - padT - padB
  const maxBar = Math.max(...S.map((m) => Math.max(m.saved, m.potential)), 1)
  const maxCum = Math.max(...S.map((m) => m.cumulative), 1)
  const yBar = (v: number) => padT + innerH - (v / maxBar) * innerH
  const yCum = (v: number) => padT + innerH - (v / maxCum) * innerH
  const slot = innerW / Math.max(S.length, 1)
  const barW = Math.min(26, slot * 0.36)
  const cx = (i: number) => padL + i * slot + slot / 2
  const linePts = S.map((m, i) => `${cx(i)},${yCum(m.cumulative)}`).join(' ')
  const hasSavings = S.some((m) => m.saved > 0 || m.potential > 0)

  return (
    <>
      {/* 1. The savings story */}
      <Card>
        <SectionHeading title={t('overview')} sub={t('overviewSub')} />
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-5 items-start">
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
            <div>
              <p className="tl-label text-ink-3">{t('savedToDate')}</p>
              <p className="font-display font-extrabold text-[28px] leading-none tracking-[-0.03em] text-green-deep tl-num mt-1">{fmtMoney(I.savingsAchieved, cur)}</p>
              <p className="text-[12px] text-ink-2 mt-1">{t('perfWinRateSub', { won: I.wonCount, closed: I.closedCount })}{I.closedCount ? ` · ${I.winRate}% ${t('perfWinRate').toLowerCase()}` : ''}</p>
            </div>
            <div>
              <p className="tl-label text-ink-3">{t('inPipeline')}</p>
              <p className="font-display font-bold text-[22px] leading-none tracking-[-0.02em] text-ink tl-num mt-1">{fmtMoney(I.savingsIdentified, cur)}</p>
              <p className="text-[12px] text-ink-2 mt-1">{t('inPipelineSub', { n: I.activeCount })}</p>
            </div>
            <div className="hidden lg:block">
              <p className="tl-label text-ink-3">{t('avgSaving')}</p>
              <p className="font-display font-bold text-[18px] leading-none tracking-[-0.02em] text-ink tl-num mt-1">{avgSaving ? fmtMoney(avgSaving, cur) : '—'}</p>
              <p className="text-[12px] text-ink-2 mt-1">{I.captureRate == null ? t('perfCaptureSub') : I.captureRate > 100 ? t('perfCaptureOver', { pct: I.captureRate - 100 }) : `${I.captureRate}% ${t('perfCapture').toLowerCase()}`}</p>
            </div>
          </div>

          <div className="min-w-0">
            {!hasSavings ? (
              <p className="text-[13px] text-ink-3 py-8 text-center">{t('noSavingsYet')}</p>
            ) : (
              <>
                <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block" role="img" aria-label={t('overview')}>
                  {[0, 0.5, 1].map((f) => (
                    <g key={f}>
                      <line x1={padL} x2={W - padR} y1={padT + innerH - f * innerH} y2={padT + innerH - f * innerH} stroke="var(--tl-line-2)" />
                      <text x={padL - 6} y={padT + innerH - f * innerH + 3} textAnchor="end" fontSize="9" fill="var(--tl-ink-3)" fontFamily="var(--font-jetbrains)">{fmtCompact(maxBar * f, cur)}</text>
                    </g>
                  ))}
                  {S.map((m, i) => (
                    <g key={m.key}>
                      {m.potential > 0 && <rect x={cx(i) + 2} y={yBar(m.potential)} width={barW} height={Math.max(2, padT + innerH - yBar(m.potential))} rx="4" fill="var(--tl-line)" />}
                      <rect x={cx(i) - barW - 2} y={yBar(m.saved)} width={barW} height={Math.max(2, padT + innerH - yBar(m.saved))} rx="4" fill={m.saved > 0 ? 'var(--tl-green)' : 'var(--tl-line-2)'} />
                      <text x={cx(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--tl-ink-2)" fontFamily="var(--font-geist-sans)">{m.label}</text>
                    </g>
                  ))}
                  <polyline points={linePts} fill="none" stroke="var(--tl-ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  {S.map((m, i) => <circle key={m.key} cx={cx(i)} cy={yCum(m.cumulative)} r={i === S.length - 1 ? 4 : 2.5} fill={i === S.length - 1 ? 'var(--tl-ink)' : 'var(--tl-surface)'} stroke="var(--tl-ink)" strokeWidth="2" />)}
                  {/* Running-total label: sits left of the last point so it never collides with the top gridline. */}
                  {S.length > 0 && <text x={cx(S.length - 1) + 4} y={yCum(S[S.length - 1].cumulative) - 9} textAnchor="end" fontSize="10.5" fontWeight="700" fill="var(--tl-ink)" fontFamily="var(--font-geist-sans)">{fmtCompact(S[S.length - 1].cumulative, cur)}</text>}
                </svg>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-[11.5px] text-ink-2">
                  <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-green" />{t('legendSaved')}</span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-line" />{t('legendPotential')}</span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 rounded-full bg-ink" />{t('legendCumulative')}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* 2. Money on the table — and what keeps getting in the way */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3.5">
        <Card>
          <SectionHeading title={t('opportunities')} sub={t('opportunitiesSub')} />
          {I.opportunities.length === 0 ? <p className="text-[13px] text-ink-3 py-2">{t('noOpportunities')}</p> : (
            <ol className="m-0 p-0 list-none divide-y divide-line-2">
              {I.opportunities.map((o, i) => (
                <li key={o.id}>
                  <Link href={`${linkBase}/deal/${o.id}`} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-3 py-3 no-underline group">
                    <span className="w-6 h-6 rounded-md bg-ink text-white grid place-items-center font-display font-bold text-[12px] mt-0.5">{i + 1}</span>
                    <span className="min-w-0">
                      <span className="flex items-baseline gap-2 min-w-0"><span className="font-semibold text-[13.5px] text-ink truncate group-hover:text-green-deep transition-colors">{o.vendor}</span><span className="text-[11.5px] text-ink-3 truncate">{o.category}</span></span>
                      {o.ask ? <span className="block text-[12.5px] text-ink-2 leading-snug mt-0.5 line-clamp-2">{o.ask}</span> : o.flags > 0 ? <span className="block text-[12.5px] text-ink-3 mt-0.5">{t('attentionFlags', { n: o.flags })}</span> : null}
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block font-display font-bold text-[15px] text-green-deep tl-num">{fmtCompact(o.potential, cur)}</span>
                      <span className="block text-[11px] text-ink-3">{t('legendPotential')}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card>
          <SectionHeading title={t('recurring')} sub={t('recurringSub')} />
          {I.recurringFlags.length === 0 ? <p className="text-[13px] text-ink-3 py-2">{t('noFlags')}</p> : (
            <div className="flex flex-col gap-3">
              {I.recurringFlags.map((f) => (
                <div key={f.type}>
                  <div className="flex justify-between items-baseline text-[13px] mb-1.5 gap-3">
                    <span className="min-w-0 truncate"><b>{f.type}</b></span>
                    <span className="text-[12px] text-ink-2 whitespace-nowrap tl-num">{t('recurringIn', { n: f.deals })}</span>
                  </div>
                  <Bar pct={(f.deals / Math.max(I.activeCount, 1)) * 100} cls={f.deals >= 2 ? 'bg-risk' : 'bg-warn'} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* 3. Where the money goes, and how good the quotes are */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <Card>
          <SectionHeading title={t('spendByCategory')} sub={t('total', { v: fmtCompact(I.totalSpend, cur) })} />
          {I.categories.length === 0 ? <p className="text-[13px] text-ink-3">{t('noData')}</p> : (
            <div className="flex flex-col gap-3">
              {I.categories.map((c) => (
                <div key={c.name}>
                  <div className="flex justify-between items-baseline text-[13px] mb-1.5 gap-3">
                    <span className="min-w-0 truncate"><b>{c.name}</b> <span className="text-ink-3 text-[12px]">{t('deals', { n: c.count })}</span></span>
                    <span className="tl-num whitespace-nowrap text-[12px]">
                      {c.saved > 0 && <span className="text-green-deep mr-2">{t('saved', { v: fmtCompact(c.saved, cur) })}</span>}
                      <b className="text-[13px]">{fmtCompact(c.spend, cur)}</b>
                    </span>
                  </div>
                  <Bar pct={(c.spend / maxCat) * 100} />
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <SectionHeading title={t('scoreByCategory')} sub={t('scoreByCategorySub')} />
          {I.categoryScores.length === 0 ? <p className="text-[13px] text-ink-3">{t('noData')}</p> : (
            <div className="flex flex-col gap-3">
              {I.categoryScores.map((c) => (
                <div key={c.name}>
                  <div className="flex justify-between items-baseline text-[13px] mb-1.5 gap-3">
                    <span className="min-w-0 truncate"><b>{c.name}</b> <span className="text-ink-3 text-[12px]">{t('scoreDeals', { n: c.count })}</span></span>
                    <b className={`tl-num text-[13px] ${c.score < 40 ? 'text-risk' : c.score < 60 ? 'text-warn' : 'text-green-deep'}`}>{c.score}</b>
                  </div>
                  <Bar pct={c.score} cls={c.score < 40 ? 'bg-risk' : c.score < 60 ? 'bg-warn' : 'bg-green'} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* 4. What's coming, and the record */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <Card>
          <SectionHeading title={t('renewals')} sub={t('renewalsSub')} />
          {I.renewals.length === 0 ? <div><p className="text-[13px] text-ink-3">{t('noRenewals')}</p><p className="text-[12px] text-ink-3 mt-1">{t('noRenewalsHint')}</p></div> : (
            <div className="divide-y divide-line-2">
              {I.renewals.map((r) => (
                <Link key={r.id} href={`${linkBase}/deal/${r.id}`} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1.5fr_auto_1fr] items-center gap-3 py-2.5 no-underline hover:bg-surface-2 -mx-2 px-2 rounded-lg">
                  <div className="min-w-0"><div className="font-semibold text-[13px] truncate">{r.vendor}</div><div className="text-[11.5px] text-ink-3 truncate">{fmtCompact(r.amount, cur)}{r.saved > 0 ? ` · ${t('savedLastTime', { v: fmtCompact(r.saved, cur) })}` : ''}</div></div>
                  <Chip tone={r.daysOut <= 90 ? 'warn' : 'neutral'}>{t('days', { n: r.daysOut })}</Chip>
                  <span className="hidden sm:block text-right text-[12.5px] text-ink-2 tl-num">{dateFmt(r.date)}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <SectionHeading title={t('topWins')} />
          {I.topWins.length === 0 ? <p className="text-[13px] text-ink-3">{t('noWins')}</p> : (
            <div className="flex flex-col gap-2">
              {I.topWins.map((w, i) => (
                <Link key={w.id} href={`${linkBase}/deal/${w.id}`} className="flex items-center gap-3 rounded-[10px] border border-green-line bg-green-soft px-3 py-2 no-underline">
                  <span className="w-6 h-6 rounded-md bg-green text-white grid place-items-center font-display font-bold text-[12px] shrink-0">{i + 1}</span>
                  <span className="min-w-0 flex-1"><span className="block font-semibold text-[13px] truncate">{w.vendor}</span><span className="block text-[11.5px] text-ink-2 truncate">{w.category}</span></span>
                  <span className="font-display font-bold text-[15px] text-green-deep tl-num">{fmtMoney(w.saved, cur)}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      {I.closedDeals.length > 0 && (
        <div>
          <SectionHeading title={t('closedDeals')} sub={t('closedDealsSub')} />
          <Table>
            <TableHead cols="minmax(0,2fr) 1fr 1fr 1fr 1fr">
              <span>{t('colVendor')}</span><span className="text-right">{t('colOriginal')}</span><span className="text-right">{t('colFinal')}</span><span className="text-right">{t('colSaved')}</span><span className="text-right">{t('colClosed')}</span>
            </TableHead>
            {I.closedDeals.map((d) => (
              <TableRow key={d.id} cols="minmax(0,2fr) 1fr 1fr 1fr 1fr" href={`${linkBase}/deal/${d.id}`}>
                <NameCell name={d.vendor} sub={d.category} />
                <HideM className="text-right tl-num text-ink-3">{fmtMoney(d.original, cur)}</HideM>
                <HideM className="text-right tl-num font-semibold">{fmtMoney(d.final, cur)}</HideM>
                <div className="text-right tl-num">{d.saved > 0 ? <span className="font-semibold text-green-deep">{fmtMoney(d.saved, cur)} <span className="text-ink-3 font-normal text-[11.5px]">{d.pct.toFixed(0)}%</span></span> : <span className="text-ink-3">—</span>}</div>
                <HideM className="text-right text-[12.5px] text-ink-3">{dateFmt(d.closedAt)}</HideM>
              </TableRow>
            ))}
          </Table>
        </div>
      )}
    </>
  )
}
