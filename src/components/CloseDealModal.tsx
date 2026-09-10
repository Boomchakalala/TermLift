'use client'

import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, Upload, FileText, Check, TrendingDown } from 'lucide-react'
import { trackEvent } from '@/lib/analytics'
import { detectCurrency, formatCurrency, parseMoney } from '@/lib/currency'
import { Btn, Chip, StatTile } from '@/components/system'
import { cn } from '@/lib/utils'
import type { ConfirmedVendorOffer } from '@/lib/vendor-offer'
import { useLockBodyScroll } from '@/hooks/useLockBodyScroll'

interface CloseDealModalProps {
  dealId: string
  currentTotal?: string
  roundCount?: number
  /**
   * Latest vendor offer a person or document stands behind (never inferred).
   * When present it is the default final total; the user still has to
   * confirm it before the deal can close.
   */
  confirmedOffer?: ConfirmedVendorOffer | null
  onClose: () => void
  onSuccess: () => void
}

function parseMoneyLocal(str: string): number {
  return parseMoney(str).amount
}

/** SHA-256 of the file bytes, hex. Identity evidence only; null when the browser can't hash. */
async function fingerprintFile(file: File): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

function formatMoney(amount: number, currencyCode: ReturnType<typeof detectCurrency>): string {
  return formatCurrency(Math.round(amount), currencyCode)
}

type Outcome = 'won' | 'lost'

const changeOptions = [
  { id: 'Price', label: 'Price' },
  { id: 'Payment terms', label: 'Payment terms' },
  { id: 'Term length', label: 'Term length' },
  { id: 'Cancellation policy', label: 'Cancellation' },
  { id: 'Auto-renewal', label: 'Auto-renewal' },
  { id: 'Scope', label: 'Scope' },
  { id: 'SLA/Support', label: 'SLA / Support' },
  { id: 'Liability', label: 'Liability / Legal' },
  { id: 'Security', label: 'Security / Compliance' },
  { id: 'Other', label: 'Other' },
]

const field =
  'w-full text-[14px] text-ink bg-surface border border-line rounded-[10px] outline-none transition-colors placeholder:text-ink-3 focus:border-green disabled:opacity-50'

function Label({ children, required, hint }: { children: React.ReactNode; required?: boolean; hint?: string }) {
  return (
    <p className="tl-label text-ink-3 mb-2">
      {children}{required && <span className="text-risk ml-1">*</span>}
      {hint && <span className="ml-1.5 normal-case tracking-normal font-normal text-ink-3">({hint})</span>}
    </p>
  )
}

/**
 * Close a deal: outcome, final number, what moved. Stage 4 of the ladder.
 * One primary button. The "fill from the signed document" path is a plain
 * upload, not a feature pitch.
 */
export function CloseDealModal({ dealId, currentTotal, roundCount = 0, confirmedOffer = null, onClose, onSuccess }: CloseDealModalProps) {
  const currency = detectCurrency(currentTotal || '')
  const originalAmount = parseMoneyLocal(currentTotal || '')
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Phones: without this the page behind the modal scrolls instead of the modal.
  useLockBodyScroll()

  // Default final total: the latest confirmed/verified vendor offer, if any. Prefilled
  // only — the person must still tick the confirmation box before closing.
  const offerPrefill = confirmedOffer && confirmedOffer.amount > 0
    ? formatMoney(confirmedOffer.amount, ((confirmedOffer.currency || currency) as ReturnType<typeof detectCurrency>))
    : ''

  const [outcome, setOutcome] = useState<Outcome>('won')
  const [finalTotal, setFinalTotal] = useState(offerPrefill)
  // The final total only counts once a person confirmed it: typing it, or ticking the box under a prefilled estimate.
  const [finalConfirmed, setFinalConfirmed] = useState(false)
  const [whatChanged, setWhatChanged] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [uploadedFile, setUploadedFile] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)
  const [closedOutcome, setClosedOutcome] = useState('')
  const [closedSavings, setClosedSavings] = useState('')
  const [closedPct, setClosedPct] = useState(0)
  const [showManual, setShowManual] = useState(false)

  const [aiLoading, setAiLoading] = useState(false)
  const [aiDone, setAiDone] = useState(false)

  const finalAmount = outcome === 'lost' ? originalAmount : parseMoneyLocal(finalTotal)
  const savingsAmount = originalAmount > 0 && finalAmount > 0 ? originalAmount - finalAmount : 0
  const savingsPercent = originalAmount > 0 && savingsAmount > 0 ? (savingsAmount / originalAmount) * 100 : 0

  const isLost = outcome === 'lost'
  const canSubmit = isLost || (finalTotal.trim() && finalConfirmed && whatChanged.length > 0)

  const toggleChange = (id: string) => {
    setWhatChanged(prev => prev.includes(id) ? prev.filter(o => o !== id) : [...prev, id])
  }

  const [extractedDocText, setExtractedDocText] = useState<string | null>(null)
  const [uploadLoading, setUploadLoading] = useState(false)
  // Evidence that survives the document: its fingerprint, type and size, plus
  // the figure the model read from it. The file itself is never stored.
  const [docEvidence, setDocEvidence] = useState<{ sha256: string | null; type: string; sizeBytes: number; extractedTotal: number | null; model: string | null } | null>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadLoading(true)
    setUploadedFile(file.name)
    try {
      const sha256 = await fingerprintFile(file)
      // Send file to /api/extract which handles PDF, DOCX, and images
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/extract', { method: 'POST', body: formData })
      const data = await res.json()
      if (res.ok && data.text) {
        setExtractedDocText(data.text)
        setDocEvidence({ sha256, type: file.type || file.name.split('.').pop() || 'unknown', sizeBytes: file.size, extractedTotal: null, model: null })
      } else {
        setError(data.error || 'Failed to extract text from document')
        setUploadedFile(null)
      }
    } catch {
      setUploadedFile(null)
      setExtractedDocText(null)
      setDocEvidence(null)
    }
    setUploadLoading(false)
  }

  const handleAICalc = async () => {
    setAiLoading(true)
    try {
      const res = await fetch(`/api/deal/${dealId}/estimate-close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          finalDocumentText: extractedDocText || undefined,
          originalTotal: currentTotal || undefined,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        // A prefilled figure is a suggestion, not an outcome — confirmation resets.
        if (data.final_total) {
          setFinalTotal(data.final_total); setFinalConfirmed(false)
          if (extractedDocText) setDocEvidence((ev) => ev ? { ...ev, extractedTotal: parseMoneyLocal(String(data.final_total)) || null, model: data.model || null } : ev)
        }
        if (data.what_changed?.length) setWhatChanged(data.what_changed)
        if (data.summary) setNotes(data.summary)
        setAiDone(true)
      }
    } catch {}
    setAiLoading(false)
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      const outcomeMap = { won: 'closed_won', lost: 'closed_lost' } as const
      const response = await fetch(`/api/deal/${dealId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: outcomeMap[outcome],
          finalTotal: isLost ? null : (finalTotal || null),
          // The server derives savings from initial − final; nothing computed here is sent.
          finalTotalConfirmed: !isLost && finalConfirmed,
          finalTotalEvidence: extractedDocText ? 'document' : 'manual',
          verification: extractedDocText && docEvidence ? docEvidence : null,
          whatChanged: whatChanged.length > 0 ? whatChanged : null,
          notes: notes || null,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to close deal')
      const saved = typeof data.savingsAmount === 'number' ? data.savingsAmount : 0
      const savedPct = typeof data.savingsPercent === 'number' ? data.savingsPercent : 0
      trackEvent({ name: 'deal_closed', properties: { outcome, hasSavings: saved > 0, savingsAmount: saved > 0 ? saved : undefined } })
      setClosedOutcome(isLost ? 'Signed at the original terms' : 'Negotiated, improved terms secured')
      setClosedSavings(saved > 0 ? formatMoney(saved, currency) : '')
      setClosedPct(savedPct)
      setClosed(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setLoading(false)
    }
  }

  // Phones: the panel is the scroll container, so it must be sized to the visible
  // viewport (dvh, not vh — vh ignores Safari's toolbars) and stop scroll chaining.
  const overlay = 'fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4'
  const panel = 'bg-surface rounded-[14px] border border-line shadow-[0_24px_60px_-20px_rgba(16,26,23,0.35)] w-full'

  // Rendered into <body>: the modal opens from inside the deal header and the
  // home list, whose own stacking contexts would otherwise keep it under the
  // phone action bar and bottom nav.
  const portal = (node: React.ReactNode) => createPortal(node, document.body)

  // ─── Confirmation screen ───
  if (closed) {
    const finalShown = isLost ? (currentTotal || '—') : (finalTotal || '—')
    return portal(
      <div className={overlay} onClick={() => { onSuccess(); onClose() }}>
        <div className={cn(panel, 'max-w-[520px] p-6 sm:p-7 rounded-b-none sm:rounded-b-[14px]')} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-soft text-green-deep grid place-items-center shrink-0"><Check className="w-5 h-5" strokeWidth={2.5} /></div>
            <div>
              <h3 className="font-display font-bold text-[17px] leading-tight">Deal closed</h3>
              <p className="text-[13px] text-ink-2 mt-0.5">{closedOutcome}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2.5 mt-5">
            <StatTile label="Original" value={currentTotal || '—'} />
            <StatTile label="Final" value={finalShown} />
            <StatTile label="Saved" value={closedSavings || '—'} tone={closedSavings ? 'money' : 'neutral'} hi={!!closedSavings} sub={closedSavings && closedPct > 0 ? `${closedPct.toFixed(1)}%` : undefined} />
          </div>
          <div className="flex justify-end gap-2.5 mt-5">
            <Btn variant="ghost" onClick={() => { onSuccess(); onClose() }}>Done</Btn>
            <Btn href={`/app/deal/${dealId}/outcome`} variant="primary">View outcome</Btn>
          </div>
        </div>
      </div>
    )
  }

  const showFields = !isLost && (showManual || aiDone || !!finalTotal.trim())

  return portal(
    <div className={overlay} onClick={onClose}>
      <div className={cn(panel, 'max-w-[580px] max-h-[calc(100dvh-1rem)] sm:max-h-[90dvh] overflow-y-auto overscroll-contain rounded-b-none sm:rounded-b-[14px]')} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-line sticky top-0 bg-surface z-10 flex items-start justify-between gap-4">
          <div>
            <p className="tl-label text-ink-3">Step 4 · Closed</p>
            <h3 className="font-display font-bold text-[17px] leading-tight mt-1">Close deal</h3>
            <p className="text-[12.5px] text-ink-2 mt-0.5">Record the final outcome and what you saved.</p>
          </div>
          <button onClick={onClose} className="p-1.5 -mr-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-ground transition-colors" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 sm:px-6 py-5 flex flex-col gap-6">
          {/* Outcome */}
          <div>
            <Label>Outcome</Label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: 'won' as Outcome, icon: <Check className="w-3.5 h-3.5" strokeWidth={3} />, title: 'Negotiated', sub: 'You pushed back and improved terms.' },
                { id: 'lost' as Outcome, icon: <TrendingDown className="w-3.5 h-3.5" strokeWidth={2.5} />, title: 'Signed as-is', sub: 'Accepted the original terms.' },
              ]).map((o) => {
                const on = outcome === o.id
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setOutcome(o.id)}
                    aria-pressed={on}
                    className={cn('text-left rounded-[10px] border px-3.5 py-3 transition-colors', on ? 'border-ink bg-ground' : 'border-line bg-surface hover:border-[#C9D3CE]')}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn('w-5 h-5 rounded-full grid place-items-center', on ? 'bg-ink text-white' : 'bg-line-2 text-ink-3')}>{o.icon}</span>
                      <span className={cn('text-[13.5px] font-semibold', on ? 'text-ink' : 'text-ink-2')}>{o.title}</span>
                    </div>
                    <p className="text-[11.5px] text-ink-3 mt-1 ml-7">{o.sub}</p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Signed as-is: just the number, for the record */}
          {isLost && (
            <StatTile label="Signed at" value={currentTotal || '—'} sub="No savings will be recorded for this deal." />
          )}

          {/* Fill from the signed document */}
          {!isLost && !aiDone && (
            <div>
              <Label>Fill from the signed document</Label>
              <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" className="hidden" onChange={handleFileSelect} />
              {uploadedFile ? (
                <div className="flex items-center gap-3 rounded-[10px] border border-line bg-ground px-3.5 py-3">
                  {uploadLoading ? <Loader2 className="w-4 h-4 text-ink-3 animate-spin shrink-0" /> : <FileText className="w-4 h-4 text-ink-3 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-ink truncate">{uploadedFile}</p>
                    <p className="text-[11.5px] text-ink-3 mt-0.5">{uploadLoading ? 'Extracting text…' : extractedDocText ? 'Document ready' : 'Processing…'}</p>
                  </div>
                  <button onClick={() => { setUploadedFile(null); setExtractedDocText(null); setDocEvidence(null) }} className="p-1 text-ink-3 hover:text-ink rounded transition-colors" aria-label="Remove file">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center gap-3 rounded-[10px] border border-dashed border-line bg-surface hover:bg-ground hover:border-[#C9D3CE] px-3.5 py-3 text-left transition-colors"
                >
                  <Upload className="w-4 h-4 text-ink-3 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-ink">Upload the final document</p>
                    <p className="text-[11.5px] text-ink-3 mt-0.5">PDF, image or DOCX of the signed agreement. We compare it to the original quote. The file is read in memory and not kept; only its fingerprint and the figures are recorded.</p>
                  </div>
                </button>
              )}
              <div className="flex flex-wrap items-center gap-2.5 mt-2.5">
                {extractedDocText && !uploadLoading && (
                  <Btn variant="primary" onClick={handleAICalc} disabled={aiLoading}>
                    {aiLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Comparing…</> : 'Compare to original quote'}
                  </Btn>
                )}
                {!extractedDocText && roundCount >= 2 && (
                  <Btn variant="ghost" onClick={handleAICalc} disabled={aiLoading}>
                    {aiLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Reading your rounds…</> : 'Auto-fill from your rounds'}
                  </Btn>
                )}
                {!showManual && (
                  <Btn variant="link" onClick={() => setShowManual(true)} className="text-[12.5px]">or fill in manually</Btn>
                )}
              </div>
            </div>
          )}

          {aiDone && (
            <div className="flex items-center gap-2.5 text-[13px] text-ink-2">
              <Chip tone="green">Pre-filled</Chip>
              <span>From your negotiation data. Check the numbers before closing.</span>
            </div>
          )}
          {!aiDone && !isLost && offerPrefill && (
            <div className="flex items-center gap-2.5 text-[13px] text-ink-2">
              <Chip tone="green">Pre-filled</Chip>
              <span>From the vendor’s {confirmedOffer?.provenance === 'document_verified' ? 'document-verified' : 'confirmed'} offer in Round {confirmedOffer?.round}. Confirm or edit it before closing.</span>
            </div>
          )}

          {/* Final number + savings */}
          {showFields && (
            <>
              <div>
                <Label>Financial outcome</Label>
                <div className="grid grid-cols-2 gap-2.5">
                  <StatTile label="Original quote" value={currentTotal || '—'} />
                  <div className="min-w-0 rounded-[14px] border border-green-line bg-surface px-3.5 py-3 flex flex-col gap-1 focus-within:border-green transition-colors">
                    <span className="tl-label text-green-deep">Final agreed</span>
                    <input
                      type="text"
                      value={finalTotal}
                      onChange={(e) => { setFinalTotal(e.target.value); setFinalConfirmed(e.target.value.trim().length > 0) }}
                      placeholder="e.g. €42,000"
                      disabled={loading}
                      className="font-display text-[21px] leading-[1.05] font-bold tracking-[-0.02em] tl-num text-ink w-full bg-transparent outline-none placeholder:text-ink-3 placeholder:font-normal placeholder:text-[15px]"
                    />
                  </div>
                </div>
                {finalTotal.trim() && !finalConfirmed && (
                  <label className="flex items-start gap-2.5 mt-2.5 rounded-[10px] border border-warn-line bg-warn-soft px-3.5 py-3 text-[13px] text-ink cursor-pointer">
                    <input type="checkbox" checked={finalConfirmed} onChange={(e) => setFinalConfirmed(e.target.checked)} className="mt-0.5" />
                    <span><b>This is the final total we agreed.</b> The figure above was suggested by TermLift from your documents. Confirm it, or edit it, before closing.</span>
                  </label>
                )}
                {savingsAmount > 0 && (
                  <StatTile className="mt-2.5" label="Savings captured" value={formatMoney(savingsAmount, currency)} sub={`${savingsPercent.toFixed(1)}% below the original quote · confirmed on close`} tone="money" hi />
                )}
                {finalTotal.trim() && finalAmount > 0 && originalAmount > 0 && finalAmount >= originalAmount && (
                  <p className="text-[12px] text-ink-3 mt-2">Final amount is equal to or higher than the original, so no savings will be recorded.</p>
                )}
              </div>

              <div>
                <Label required>What changed?</Label>
                <div className="flex flex-wrap gap-1.5">
                  {changeOptions.map((opt) => {
                    const on = whatChanged.includes(opt.id)
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => toggleChange(opt.id)}
                        aria-pressed={on}
                        className={cn(
                          'inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-md border text-[12px] font-semibold transition-colors',
                          on ? 'bg-green-soft border-green-line text-green-deep' : 'bg-surface border-line text-ink-2 hover:border-[#C9D3CE] hover:text-ink',
                        )}
                      >
                        {on && <Check className="w-3 h-3" strokeWidth={3} />}
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          {/* Notes */}
          {(showFields || isLost) && (
            <div>
              <Label hint="optional">Notes</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                disabled={loading}
                placeholder={isLost ? 'Why did you sign at the original terms?' : 'Key wins, concessions, or context for your records…'}
                className={cn(field, 'px-3 py-2.5 resize-y min-h-[84px]')}
              />
            </div>
          )}

          {error && <p className="text-[13.5px] text-risk bg-risk-soft border border-risk-line rounded-[10px] px-3.5 py-3">{error}</p>}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-line">
            <Btn variant="ghost" onClick={onClose} disabled={loading}>Cancel</Btn>
            <Btn variant="primary" onClick={handleSubmit} disabled={loading || !canSubmit}>
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Closing…</> : 'Close deal'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}
