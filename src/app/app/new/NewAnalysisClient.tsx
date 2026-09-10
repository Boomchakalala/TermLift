'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { trackEvent } from '@/lib/analytics'
import { useI18n } from '@/i18n/context'
import { AnalysisUploader, formatBytes, type LiveFindings } from '@/components/AnalysisUploader'
import { AppPage, PageHeader, PageBody } from '@/components/system'

/** billing: the gate or credit note from the server page; locked: past the free quota with no credit — no uploader until paid. */
export function NewAnalysisClient({ billing, locked }: { billing?: ReactNode; locked?: boolean }) {
  const { locale, t } = useI18n()
  const router = useRouter()

  const [input, setInput] = useState('')
  const [uploading, setUploading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [uploadedFileSize, setUploadedFileSize] = useState<string | null>(null)
  const [imageData, setImageData] = useState<{ base64: string; mimeType: string } | null>(null)
  const [allPages, setAllPages] = useState<Array<{ base64: string; mimeType: string }> | null>(null)
  const [pdfData, setPdfData] = useState<{ base64: string; mimeType: string } | null>(null)
  const [context, setContext] = useState('')
  const [liveFindings, setLiveFindings] = useState<LiveFindings | null>(null)
  const [completionFlash, setCompletionFlash] = useState<{ opportunityCount: number } | null>(null)
  // Deal type is chosen here, never hard-coded: the preview's inference sets the
  // default (a quote naming a current subscription reads as a renewal), the person
  // can override it, and the chosen value goes into every prompt.
  const [dealType, setDealType] = useState<'New' | 'Renewal'>('New')
  const [dealTypeTouched, setDealTypeTouched] = useState(false)
  const [suggestedDealType, setSuggestedDealType] = useState<{ type: 'New' | 'Renewal'; reason: 'renewal' | 'expansion' | 'new_purchase' | 'unknown'; confidence: 'high' | 'low' } | null>(null)
  const [precomputed, setPrecomputed] = useState<{ classification: unknown; facts: unknown; key: string; suggested?: 'New' | 'Renewal' } | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const hasContent = !!(input.trim() || imageData || pdfData)

  const buildPayload = (type: 'New' | 'Renewal') => {
    const basePayload: Record<string, unknown> = { title: uploadedFileName || 'New Deal', vendor: null, dealType: type, goal: context || null, saveExtractedText: false, locale }
    if (pdfData) { basePayload.pdfData = pdfData; basePayload.extractedText = '' }
    else if (imageData) { basePayload.imageData = imageData; basePayload.allPages = allPages || undefined; basePayload.extractedText = '' }
    else { basePayload.extractedText = input }
    return basePayload
  }
  // Key of the document the preview was computed for; a changed paste or file invalidates it.
  const contentKey = () => (pdfData ? `pdf:${pdfData.base64.length}:${uploadedFileName}` : imageData ? `img:${imageData.base64.length}:${uploadedFileName}` : `txt:${input.trim().length}:${input.trim().slice(0, 64)}`)

  /** Classify + extract now (same call the analysis would make; reused, never repeated). Sets the live findings and the deal-type default. */
  const runPreview = async (type: 'New' | 'Renewal') => {
    const key = contentKey()
    if (precomputed?.key === key) return precomputed
    setPreviewing(true)
    try {
      const previewRes = await fetch('/api/deal/extract-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildPayload(type)) })
      if (!previewRes.ok) return null
      const preview = await previewRes.json()
      const next: { classification: unknown; facts: unknown; key: string; suggested?: 'New' | 'Renewal' } = { classification: preview.classification, facts: preview.facts, key }
      setLiveFindings({
        total: preview.facts?.total_commitment ? `${preview.facts.total_commitment} total value` : undefined,
        term: preview.facts?.term || undefined,
        billing: preview.facts?.billing_payment || undefined,
        dealType: preview.facts?.deal_type || undefined,
      })
      const inf = preview.inferredDealType as { type?: string; confidence?: 'high' | 'low'; currentSubLanguage?: boolean } | undefined
      if (inf?.type) {
        const suggested: 'New' | 'Renewal' = inf.type === 'renewal' || inf.type === 'expansion' || inf.currentSubLanguage ? 'Renewal' : 'New'
        setSuggestedDealType({ type: suggested, reason: (inf.type as 'renewal' | 'expansion' | 'new_purchase' | 'unknown') || 'unknown', confidence: inf.confidence || 'low' })
        if (!dealTypeTouched) setDealType(suggested)
        next.suggested = suggested
      }
      setPrecomputed(next)
      return next
    } catch { return null }
    finally { setPreviewing(false) }
  }

  // A file just landed: classify + extract now so the deal-type default and the live findings
  // are on screen before Analyse. Effect, not a call inside handleFile: it needs the committed state.
  useEffect(() => {
    if (!pdfData && !imageData) return
    void runPreview(dealType)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfData, imageData])
  // Pasted text: read it once typing settles, so the detected deal type and the live findings
  // appear without the person having to click anything.
  useEffect(() => {
    if (pdfData || imageData || uploadedFileName) return
    const text = input.trim()
    if (text.length < 200 || text.startsWith('[')) return
    const id = setTimeout(() => { void runPreview(dealType) }, 1500)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, pdfData, imageData, uploadedFileName])

  const handleFile = async (file: File) => {
    setUploading(true); setError(null); setUploadedFileSize(formatBytes(file.size))
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
      setPrecomputed(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('try.failedProcess'))
    } finally {
      setUploading(false)
    }
  }

  const handleAnalyze = async () => {
    if (!hasContent) { setError(t('tryPage.errorNeedInput')); return }
    setAnalyzing(true); setError(null); setCompletionFlash(null)
    try {
      // Preview (classify + extract) — reused when it already ran on upload/paste, else run now. Best-effort.
      const pre = await runPreview(dealType)
      // The person may not have touched the selector: honour the suggestion the preview just produced.
      const chosenType: 'New' | 'Renewal' = dealTypeTouched ? dealType : (pre?.suggested ?? suggestedDealType?.type ?? dealType)
      if (chosenType !== dealType) setDealType(chosenType)
      const basePayload = buildPayload(chosenType)

      const response = await fetch('/api/deal/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...basePayload, precomputedClassification: pre?.classification, precomputedFacts: pre?.facts }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to create deal')
      trackEvent({ name: 'deal_created', properties: { dealType: chosenType, source: imageData || pdfData ? 'upload' : 'paste', hasGoal: !!context } })
      setCompletionFlash({ opportunityCount: data.output?.red_flags?.length || 0 })
      setTimeout(() => router.push(`/app/deal/${data.dealId}`), 700)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('try.errorOccurred'))
      setAnalyzing(false)
    }
  }

  const clearFile = () => { setUploadedFileName(null); setUploadedFileSize(null); setInput(''); setImageData(null); setAllPages(null); setPdfData(null) }

  return (
    <AppPage>
      <PageHeader
        crumbs={[{ label: t('nav.deals'), href: '/app' }, { label: t('newPage.crumb') }]}
        title={t('newPage.title')}
        sub={t('newPage.sub')}
      />
      <PageBody>
        {/* AnalysisUploader is a 3+2 column grid (shared with /try); it needs the width or the side column collapses. */}
        <div className="max-w-[1080px] w-full">
          {billing}
          {!locked && <AnalysisUploader
            input={input} setInput={setInput}
            uploading={uploading} analyzing={analyzing} error={error}
            uploadedFileName={uploadedFileName} uploadedFileSize={uploadedFileSize}
            onFileUpload={handleFile} onClearFile={clearFile} onAnalyze={handleAnalyze}
            context={context} setContext={setContext}
            liveFindings={liveFindings} completionFlash={completionFlash}
            dealType={dealType}
            onDealTypeChange={(v) => { setDealType(v); setDealTypeTouched(true) }}
            suggestedDealType={suggestedDealType}
            previewing={previewing}
            onInputSettled={() => { if (input.trim().length >= 80 && !uploadedFileName) void runPreview(dealType) }}
          />}
          {!locked && <p className="text-[12px] text-ink-3 mt-3">
            {t('newPage.tailored')} · <Link href="/app/settings" className="text-green-deep hover:underline">{t('newPage.edit')}</Link>
          </p>}
        </div>
      </PageBody>
    </AppPage>
  )
}
