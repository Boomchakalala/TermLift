'use client'

import { useMemo, useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Search, MoreHorizontal, CheckCircle2, Trash2, CheckSquare, Loader2 } from 'lucide-react'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { trackEvent } from '@/lib/analytics'
import type { HomeRow } from '@/lib/home-rows'
import { ScoreRing, Table, TableHead, TableRow, HideM, NameCell, Btn, DealStatus } from '@/components/system'
import { CloseDealModal } from '@/components/CloseDealModal'

type Filter = 'all' | 'needs' | 'termlift' | 'won'

interface Props {
  rows: HomeRow[]
  linkBase?: string
  /** Demo: no row menu, no delete. */
  readOnly?: boolean
  initialFilter?: Filter
}

function useTimeAgo() {
  const { t, locale } = useI18n()
  return (iso: string) => {
    const diffMs = Date.now() - new Date(iso).getTime()
    const m = Math.floor(diffMs / 60000), h = Math.floor(diffMs / 3600000), d = Math.floor(diffMs / 86400000)
    if (m < 60) return t('time.mAgo', { count: Math.max(1, m) })
    if (h < 24) return t('time.hAgo', { count: h })
    if (d === 1) return t('time.yesterday')
    if (d < 7) return t('time.dAgo', { count: d })
    if (d < 30) return t('time.wAgo', { count: Math.floor(d / 7) })
    return new Date(iso).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { month: 'short', day: 'numeric' })
  }
}

function RowMenu({ row, onClose, onDelete }: { row: HomeRow; onClose: () => void; onDelete: () => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  return (
    <div ref={ref} className="relative" onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
      <button onClick={() => setOpen(!open)} className="p-1 rounded-md text-ink-3 hover:text-ink-2 hover:bg-line-2 transition-colors" aria-label="Deal actions" aria-expanded={open}>
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-20 w-44 bg-surface rounded-[10px] shadow-lg border border-line py-1">
          {!row.closed && (
            <button onClick={() => { setOpen(false); onClose() }} className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-ink hover:bg-ground"><CheckCircle2 className="w-3.5 h-3.5 text-green-deep" />{t('dealList.closeDeal')}</button>
          )}
          <button onClick={() => { setOpen(false); onDelete() }} className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-risk hover:bg-risk-soft"><Trash2 className="w-3.5 h-3.5" />{t('dealList.delete')}</button>
        </div>
      )}
    </div>
  )
}

/** Inbox-style tick. Purely visual: the row's own click toggles selection. */
function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'shrink-0 w-[18px] h-[18px] rounded-[5px] border grid place-items-center transition-colors',
        on ? 'bg-green border-green text-white' : 'bg-surface border-line-2',
      )}
    >
      {on && <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.5 2.5 4.5-5" /></svg>}
    </span>
  )
}

const COLS = 'minmax(0,2fr) minmax(0,1.3fr) 0.9fr 1fr 1.1fr 0.8fr 28px'

export function HomeDealsClient({ rows: initialRows, linkBase = '/app', readOnly = false, initialFilter = 'all' }: Props) {
  const { t } = useI18n()
  const router = useRouter()
  const timeAgo = useTimeAgo()
  const [rows, setRows] = useState(initialRows)
  const [filter, setFilter] = useState<Filter>(initialFilter)
  const [q, setQ] = useState('')
  const [closing, setClosing] = useState<HomeRow | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // Inbox-style multi-select: rows become toggles, a bar above the list carries select-all / delete.
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  useEffect(() => setRows(initialRows), [initialRows])

  const needsCount = rows.filter((r) => r.waitingOnClient).length

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (term && !r.vendor.toLowerCase().includes(term) && !r.category.toLowerCase().includes(term)) return false
      if (filter === 'needs') return r.waitingOnClient
      if (filter === 'termlift') return r.mode === 'termlift' && !r.closed
      if (filter === 'won') return r.won
      return true
    })
  }, [rows, q, filter])
  const active = filtered.filter((r) => !r.closed)
  const closed = filtered.filter((r) => r.closed)

  const visibleIds = filtered.map((r) => r.id)
  const selectedVisible = visibleIds.filter((id) => selected.has(id))
  const allVisibleSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length

  const startSelecting = () => { setSelected(new Set()); setSelecting(true) }
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()) }
  const toggleOne = (id: string) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const toggleAllVisible = () => setSelected((prev) => {
    const next = new Set(prev)
    if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id))
    else visibleIds.forEach((id) => next.add(id))
    return next
  })

  const handleDelete = async (row: HomeRow) => {
    if (!confirm(row.closed && row.savingsKind === 'saved' ? t('dealList.deleteConfirmClosed') : t('dealList.deleteConfirm'))) return
    setDeletingId(row.id)
    try {
      const res = await fetch(`/api/deal/${row.id}`, { method: 'DELETE' })
      if (res.ok) {
        setRows((prev) => prev.filter((r) => r.id !== row.id))
        trackEvent({ name: 'deal_deleted', properties: { isClosed: row.closed, hasSavings: row.savingsKind === 'saved' } })
        router.refresh()
      } else alert(t('dealList.deleteFailed'))
    } catch { alert(t('dealList.deleteError')) }
    finally { setDeletingId(null) }
  }

  const handleBulkDelete = async () => {
    const ids = selectedVisible
    if (ids.length === 0) return
    const closedWithSavings = rows.filter((r) => ids.includes(r.id) && r.closed && r.savingsKind === 'saved').length
    const msg = closedWithSavings > 0
      ? t('dealList.deleteConfirmManyClosed', { n: ids.length, closed: closedWithSavings })
      : t('dealList.deleteConfirmMany', { n: ids.length })
    if (!confirm(msg)) return
    setBulkDeleting(true)
    try {
      const res = await fetch('/api/deals', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
      const data = res.ok ? await res.json() : null
      if (!data) { alert(t('dealList.deleteFailed')); return }
      const gone = new Set<string>([...(data.deleted || []), ...(data.skipped || [])])
      setRows((prev) => prev.filter((r) => !gone.has(r.id)))
      trackEvent({ name: 'deals_bulk_deleted', properties: { count: (data.deleted || []).length } })
      if ((data.failed || []).length > 0) alert(t('dealList.deletePartial', { n: data.failed.length }))
      stopSelecting()
      router.refresh()
    } catch { alert(t('dealList.deleteError')) }
    finally { setBulkDeleting(false) }
  }

  const filters: Array<{ key: Filter; label: string; count?: number }> = [
    { key: 'all', label: t('home.filterAll') },
    { key: 'needs', label: t('home.filterNeeds'), count: needsCount },
    { key: 'termlift', label: t('home.filterTermlift') },
    { key: 'won', label: t('home.filterWon') },
  ]

  const renderRow = (r: HomeRow) => {
    const isSel = selected.has(r.id)
    // Desktop-only hover hint on rows still at the quick stage; every other secondary line comes from the status itself.
    const hint = !r.closed && r.needsUnlock
      ? <span className="text-ink-3 opacity-0 group-hover:opacity-100 group-hover:text-green-deep transition-opacity">{t('home.hintUnlock')}</span>
      : null
    const name = <NameCell name={r.vendor} sub={[r.category, r.dealType].filter(Boolean).join(' · ')} />
    return (
      <TableRow
        key={r.id}
        cols={COLS}
        href={selecting ? undefined : `${linkBase}/deal/${r.id}`}
        onClick={selecting ? () => toggleOne(r.id) : undefined}
        className={cn('group', deletingId === r.id && 'opacity-50', selecting && isSel && 'bg-green-soft/60 hover:bg-green-soft/60')}
      >
        {selecting ? <div className="flex items-center gap-3 min-w-0"><Tick on={isSel} />{name}</div> : name}
        {/* Phone: the badge sits top-right, aligned across rows; the hover hint is desktop-only. */}
        <DealStatus stage={r.stage} mode={r.mode} won={r.won} lost={r.lost} closed={r.closed} waitingOnClient={r.waitingOnClient} roundCount={r.roundCount} hint={hint} className="max-md:items-end max-md:text-right max-md:shrink-0" secondaryClassName="max-md:hidden" />
        {/* Phone-only third line: the numbers the desktop columns carry. */}
        <div className="md:hidden col-span-2 flex items-center gap-2 min-w-0 text-[12.5px] tl-num -mt-0.5">
          {r.score != null && <ScoreRing score={r.score} size={22} stroke={3} muted={r.closed && !r.won} />}
          <span className="text-ink-2 truncate">{r.total || '—'}</span>
          {r.savingsKind !== 'none' && (
            <span className="truncate">
              <span className="text-ink-3">· </span>
              <span className="font-semibold text-green-deep">{r.savings}</span>
              <span className="text-ink-3"> {r.savingsKind === 'saved' ? t('home.saved') : t('home.potential')}</span>
            </span>
          )}
          {!r.closed && r.flags > 0 && <span className="text-ink-3 ml-auto shrink-0">{t('home.flags', { n: r.flags })}</span>}
        </div>
        <HideM className="flex items-center gap-2">
          {r.score != null ? <ScoreRing score={r.score} size={28} stroke={3} muted={r.closed && !r.won} /> : <span className="text-ink-3">—</span>}
          <span className="text-[12px] text-ink-2 tl-num">{!r.closed && r.flags > 0 ? t('home.flags', { n: r.flags }) : ''}</span>
        </HideM>
        <HideM className="tl-num text-ink-2">{r.total || '—'}</HideM>
        <HideM className="tl-num">
          {r.savingsKind === 'none' ? <span className="text-ink-3">—</span> : (
            <span className={cn('font-semibold', r.savingsKind === 'saved' ? 'text-green-deep' : 'text-green-deep/90')}>
              {r.savings} <span className="text-ink-3 font-normal text-[11.5px]">{r.savingsKind === 'saved' ? t('home.saved') : t('home.potential')}</span>
            </span>
          )}
        </HideM>
        <HideM className="text-[12.5px] text-ink-3">{timeAgo(r.closed && r.closedAt ? r.closedAt : r.updatedAt)}</HideM>
        <HideM className="flex justify-end">
          {!readOnly && !selecting && <span className="opacity-0 group-hover:opacity-100 transition-opacity"><RowMenu row={r} onClose={() => setClosing(r)} onDelete={() => handleDelete(r)} /></span>}
        </HideM>
      </TableRow>
    )
  }

  const head = (lastCol: string) => (
    <TableHead cols={COLS}>
      <span>{t('home.colVendor')}</span><span>{t('home.colStage')}</span><span>{t('home.colScore')}</span><span>{t('home.colTotal')}</span><span>{t('home.colSavings')}</span><span>{lastCol}</span><span />
    </TableHead>
  )

  const chip = (on: boolean) => cn('h-8 px-3 rounded-lg border text-[12.5px] font-semibold transition-colors inline-flex items-center gap-1.5', on ? 'bg-ink text-white border-ink' : 'bg-surface text-ink-2 border-line hover:border-[#C9D3CE]')

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={chip(filter === f.key)}>
            {f.label}
            {f.count ? <span className={cn('tl-num', filter === f.key ? 'text-white/80' : 'text-warn')}>{f.count}</span> : null}
          </button>
        ))}
        {!readOnly && rows.length > 0 && !selecting && (
          <button onClick={startSelecting} className={chip(false)} aria-pressed={false}>
            <CheckSquare className="w-3.5 h-3.5" />{t('dealList.select')}
          </button>
        )}
        <label className="relative w-full sm:w-[240px] sm:ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('home.searchPlaceholder')} className="w-full h-8 pl-9 pr-3 rounded-lg border border-line bg-surface text-[13px] placeholder:text-ink-3 focus:outline-none focus:border-green focus:ring-[3px] focus:ring-green/15" />
        </label>
      </div>

      {selecting && (
        <div className="sticky top-2 z-10 flex items-center gap-3 px-3 h-11 rounded-[12px] border border-line bg-surface shadow-[0_10px_30px_-18px_rgba(16,26,23,0.4)]">
          <button onClick={toggleAllVisible} className="flex items-center gap-2 text-[13px] font-semibold text-ink min-w-0" aria-pressed={allVisibleSelected} aria-label={t('dealList.selectAll')}>
            <Tick on={allVisibleSelected} />
            <span className="max-sm:hidden">{t('dealList.selectAll')}</span>
          </button>
          <span className="text-[12.5px] text-ink-3 tl-num truncate">{t('dealList.selectedCount', { n: selectedVisible.length })}</span>
          <div className="ml-auto flex items-center gap-2">
            <Btn size="sm" variant="ghost" onClick={stopSelecting} disabled={bulkDeleting}>{t('dealList.cancel')}</Btn>
            <Btn size="sm" variant="ink" onClick={handleBulkDelete} disabled={bulkDeleting || selectedVisible.length === 0} className="!bg-risk hover:!bg-risk/90">
              {bulkDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              {t('dealList.deleteSelected')}{selectedVisible.length > 0 ? ` (${selectedVisible.length})` : ''}
            </Btn>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="py-10 text-center text-[13px] text-ink-3 border border-dashed border-line rounded-[14px] bg-surface">{t('home.noMatch')}</div>
      ) : (
        <>
          {active.length > 0 && (
            <section>
              <p className="tl-label text-ink-3 mb-2 ml-0.5">{t('home.sectionActive', { n: active.length })}</p>
              <Table>{head(t('home.colUpdated'))}{active.map(renderRow)}</Table>
            </section>
          )}
          {closed.length > 0 && (
            <section>
              <p className="tl-label text-ink-3 mb-2 ml-0.5">{t('home.sectionClosed', { n: closed.length })}</p>
              <Table>{head(t('home.colClosed'))}{closed.map(renderRow)}</Table>
            </section>
          )}
        </>
      )}

      {closing && (
        <CloseDealModal
          dealId={closing.id}
          currentTotal={closing.total || undefined}
          roundCount={closing.roundCount}
          confirmedOffer={closing.confirmedOffer}
          onClose={() => setClosing(null)}
          onSuccess={() => { setClosing(null); router.refresh() }}
        />
      )}
      {readOnly && rows.length > 0 && (
        <div className="text-center pt-2"><Btn href="/login?from=demo" variant="primary">{t('home.demoCta')}</Btn></div>
      )}
    </>
  )
}
