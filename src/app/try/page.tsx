'use client'

import { useRef, useState } from 'react'
import { ArrowLeft, FolderOpen, Loader2, Upload, Zap } from 'lucide-react'
import { AnalysisResultView } from '@/components/AnalysisResultView'
import { MarketingHeader } from '@/components/MarketingHeader'
import { MarketingFooter } from '@/components/MarketingFooter'
import { AnalysisProgress, formatBytes } from '@/components/AnalysisUploader'
import { Btn, Chip, StageRail } from '@/components/system'
import { trackEvent } from '@/lib/analytics'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'
import type { DealOutput } from '@/types'

const TRIAL_STORAGE_KEY = 'termlift_trial'

function saveTrialToStorage(data: Record<string, unknown>) {
  try { localStorage.setItem(TRIAL_STORAGE_KEY, JSON.stringify({ ...data, _savedAt: Date.now() })) } catch { /* unavailable */ }
}
function clearTrialStorage() {
  try { localStorage.removeItem(TRIAL_STORAGE_KEY) } catch { /* noop */ }
}

const DEMO_TEXT = `QUOTE - CloudStore Enterprise Plan

Annual Subscription: €42,000/year
Setup Fee: €4,500 (one-time)
User Licenses: 50 users included
Additional users: €45/user/month

Contract Terms:
- 3-year commitment required
- Auto-renewal for 3 years unless 90 days notice
- Price increase up to 8% annually
- Payment: Annual in advance
- Termination: Requires 180 days notice

Support:
- Standard support included
- Premium support: +€11,000/year

This quote expires in 14 days.`

export default function TryPage() {
  const { locale, t } = useI18n()
  const [input, setInput] = useState('')
  const [uploading, setUploading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [output, setOutput] = useState<DealOutput | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [uploadedFileSize, setUploadedFileSize] = useState<string | null>(null)
  const [imageData, setImageData] = useState<{ base64: string; mimeType: string } | null>(null)
  const [allPages, setAllPages] = useState<Array<{ base64: string; mimeType: string }> | null>(null)
  const [pdfData, setPdfData] = useState<{ base64: string; mimeType: string } | null>(null)
  const [goal, setGoal] = useState('')
  const [isDemoText, setIsDemoText] = useState(false)
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload')
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const clearFile = () => {
    setUploadedFileName(null); setUploadedFileSize(null); setInput(''); setImageData(null); setAllPages(null); setPdfData(null)
  }
  const useDemoText = () => {
    clearFile(); setInput(DEMO_TEXT); setIsDemoText(true); setActiveTab('paste')
  }

  const handleFileUpload = async (file: File) => {
    setUploading(true); setError(null); setIsDemoText(false)
    setUploadedFileSize(formatBytes(file.size))
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || t('try.failedProcess'))
      if (data.useVision && data.pdfData) {
        setPdfData(data.pdfData); setImageData(null); setAllPages(null); setInput(`[${t('try.docReceived')}]`)
      } else if (data.useVision && data.imageData) {
        setPdfData(null); setImageData(data.imageData); setAllPages(data.allPages || null)
        setInput(data.pageCount > 1 ? `[${t('try.docReceivedPages', { count: data.pageCount })}]` : `[${t('try.docReceived')}]`)
      } else {
        setInput(data.extractedText); setImageData(null); setAllPages(null); setPdfData(null)
      }
      setUploadedFileName(file.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('try.failedProcess'))
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = async () => {
    if (!input.trim() && !imageData && !pdfData) { setError(t('tryPage.errorNeedInput')); return }
    setAnalyzing(true); setError(null)
    const source = isDemoText ? 'demo' : uploadedFileName ? 'upload' : 'paste'
    trackEvent({ name: 'trial_started', properties: { source, dealType: 'New' } })
    try {
      const response = await fetch('/api/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extractedText: input, dealType: 'New', goal: goal || null, isDemoText, imageData: imageData || undefined, allPages: allPages || undefined, pdfData: pdfData || undefined, locale }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || t('try.failedAnalyze'))
      setOutput(data.output)
      trackEvent({
        name: 'trial_completed',
        properties: {
          redFlags: data.output.red_flags?.length || 0,
          potentialSavings: Array.isArray(data.output.potential_savings) ? data.output.potential_savings.length : (data.output.potential_savings?.items?.length || 0),
          hasCategory: !!data.output.snapshot?.category,
        },
      })
      // Prefer the server-extracted text: for uploads `input` is only a "[Document received]" placeholder.
      saveTrialToStorage({ output: data.output, dealType: 'New', goal: goal || null, extractedText: data.extractedText || input })
      window.scrollTo(0, 0)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('try.errorOccurred')
      setError(message)
      trackEvent({ name: 'trial_error', properties: { error: message } })
    } finally {
      setAnalyzing(false)
    }
  }

  // ── Result ─────────────────────────────────────────────────
  if (output) {
    return (
      <div className="min-h-screen bg-white">
        <MarketingHeader />
        <main className="max-w-[980px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="mb-3">
            <button onClick={() => { setOutput(null); clearFile(); setIsDemoText(false); clearTrialStorage() }} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" />{t('dealPage.trialAnalyseAnother')}
            </button>
          </div>
          <AnalysisResultView output={output} locale={locale} />
        </main>
        <MarketingFooter />
      </div>
    )
  }

  // ── Upload ─────────────────────────────────────────────────
  const canAnalyse = !!(input.trim() || imageData || pdfData) && !uploading && !analyzing
  const inputCls = 'w-full rounded-[10px] border border-line bg-surface px-3 py-2.5 text-[13.5px] text-ink placeholder:text-ink-3 focus:outline-none focus:border-green focus:ring-[3px] focus:ring-green/15 resize-none'

  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />
      {/* One centred column: the header and footer span 1120px, so a left-aligned 760px block read as
          off-centre. Centring the copy over the card makes the narrow width look intentional. */}
      <main className="max-w-[720px] mx-auto px-4 sm:px-6 pt-9 sm:pt-12 pb-12">
        <div className="text-center mb-5 sm:mb-6">
          <p className="tl-label text-green-deep text-[11px]">{t('tryPage.eyebrow')}</p>
          <h1 className="font-display font-extrabold text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.03em] text-ink mt-2 text-balance">{t('tryPage.title')}</h1>
          <p className="text-[14.5px] text-ink-2 mt-2 max-w-[44ch] mx-auto">{t('tryPage.sub')}</p>
          <div className="flex flex-wrap justify-center gap-1.5 mt-3"><Chip>{t('tryPage.chipScore')}</Chip><Chip>{t('tryPage.chipFlags')}</Chip><Chip>{t('tryPage.chipSavings')}</Chip></div>
        </div>

        <div className="bg-surface border border-line rounded-[14px] overflow-hidden">
          <div className="flex gap-1 border-b border-line px-4" role="tablist">
            {(['upload', 'paste'] as const).map((tab) => (
              <button key={tab} role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)} className={cn('px-3 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors', activeTab === tab ? 'text-ink border-green' : 'text-ink-3 border-transparent hover:text-ink-2')}>
                {tab === 'upload' ? t('tryPage.tabUpload') : t('tryPage.tabPaste')}
              </button>
            ))}
          </div>

          <div className="p-4 flex flex-col gap-2.5">
            {analyzing ? (
              <AnalysisProgress />
            ) : activeTab === 'upload' ? (
              <div
                onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true) }}
                onDragLeave={(e) => { e.preventDefault(); setDragging(false) }}
                onDrop={async (e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) await handleFileUpload(f) }}
                onClick={() => fileInputRef.current?.click()}
                className={cn('rounded-xl border-[1.5px] border-dashed px-4 py-4 grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto] gap-3.5 items-center cursor-pointer transition-colors', dragging ? 'border-green bg-green-soft' : 'border-line bg-ground hover:border-green')}
              >
                <input ref={fileInputRef} type="file" className="hidden" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await handleFileUpload(f); e.target.value = '' }} />
                <span className="w-10 h-10 rounded-[10px] bg-green grid place-items-center text-white shrink-0">{uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}</span>
                <div className="min-w-0">
                  <p className="font-display font-bold text-[14.5px] text-ink truncate">{uploadedFileName || t('tryPage.dropTitle')}</p>
                  <p className="text-[12.5px] text-ink-2 mt-0.5 truncate">{uploadedFileName && uploadedFileSize ? uploadedFileSize : t('tryPage.dropSub')}</p>
                </div>
                <Btn variant="ghost" size="sm" className="col-span-2 sm:col-span-1" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }} disabled={uploading}>
                  <FolderOpen className="w-3.5 h-3.5" />{uploadedFileName ? t('tryPage.chooseAnother') : t('tryPage.browse')}
                </Btn>
              </div>
            ) : (
              <label className="flex flex-col gap-1.5">
                <span className="tl-label text-ink-3">{t('tryPage.pasteLabel')}</span>
                <textarea value={input.startsWith('[') ? '' : input} onChange={(e) => { if (uploadedFileName) clearFile(); setInput(e.target.value); if (e.target.value !== DEMO_TEXT) setIsDemoText(false) }} disabled={uploading || analyzing} placeholder={t('tryPage.pastePlaceholder')} className={inputCls} style={{ minHeight: 170 }} />
              </label>
            )}
            {!analyzing && (
              <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} placeholder={t('tryPage.contextPlaceholder')} className={inputCls} />
            )}
            {error && <p role="alert" className="text-[13px] text-risk bg-risk-soft border border-risk-line rounded-[10px] px-3.5 py-2.5">{error}</p>}
          </div>

          <div className="px-4 py-2.5 border-t border-line bg-surface-2 flex flex-wrap items-center gap-3">
            <Btn variant="primary" onClick={handleSubmit} disabled={!canAnalyse} className="order-first w-full sm:w-auto sm:order-last sm:ml-auto">
              {analyzing ? <><Loader2 className="w-4 h-4 animate-spin" />{t('tryPage.analysing')}</> : <><Zap className="w-4 h-4" />{t('tryPage.cta')}</>}
            </Btn>
            <button type="button" onClick={useDemoText} disabled={uploading || analyzing} className="text-[12.5px] font-medium text-ink-2 hover:text-ink transition-colors disabled:opacity-50">{t('tryPage.sample')}</button>
            <span className="text-[12px] text-ink-3 sm:ml-auto sm:mr-3">{t('tryPage.trust')}</span>
          </div>
        </div>

        <div className="mt-4"><StageRail current="quick" /></div>
        <p className="text-center text-[12px] text-ink-3 mt-2.5">{t('tryPage.footnote')}</p>
      </main>
      <MarketingFooter />
    </div>
  )
}
