'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { trackEvent } from '@/lib/analytics'
import { useI18n } from '@/i18n/context'
import { AnalysisUploader, formatBytes, type LiveFindings } from '@/components/AnalysisUploader'
import { AppPage, PageHeader, PageBody } from '@/components/system'

export default function NewAnalysisPage() {
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

  const hasContent = !!(input.trim() || imageData || pdfData)

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
    } catch (err) {
      setError(err instanceof Error ? err.message : t('try.failedProcess'))
    } finally {
      setUploading(false)
    }
  }

  const handleAnalyze = async () => {
    if (!hasContent) { setError(t('tryPage.errorNeedInput')); return }
    setAnalyzing(true); setError(null); setLiveFindings(null); setCompletionFlash(null)
    try {
      const basePayload: Record<string, unknown> = { title: uploadedFileName || 'New Deal', vendor: null, dealType: 'New', goal: context || null, saveExtractedText: false, locale }
      if (pdfData) { basePayload.pdfData = pdfData; basePayload.extractedText = '' }
      else if (imageData) { basePayload.imageData = imageData; basePayload.allPages = allPages || undefined; basePayload.extractedText = '' }
      else { basePayload.extractedText = input }

      // Lightweight preview first — real classify+extract data for the "live findings" chips. Best-effort.
      let precomputedClassification: unknown
      let precomputedFacts: unknown
      try {
        const previewRes = await fetch('/api/deal/extract-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(basePayload) })
        if (previewRes.ok) {
          const preview = await previewRes.json()
          precomputedClassification = preview.classification
          precomputedFacts = preview.facts
          setLiveFindings({
            total: preview.facts?.total_commitment ? `${preview.facts.total_commitment} total value` : undefined,
            term: preview.facts?.term || undefined,
            billing: preview.facts?.billing_payment || undefined,
            dealType: preview.facts?.deal_type || undefined,
          })
        }
      } catch { /* preview is a nicety, not a requirement */ }

      const response = await fetch('/api/deal/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...basePayload, precomputedClassification, precomputedFacts }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to create deal')
      trackEvent({ name: 'deal_created', properties: { dealType: 'New', source: imageData || pdfData ? 'upload' : 'paste', hasGoal: !!context } })
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
          <AnalysisUploader
            input={input} setInput={setInput}
            uploading={uploading} analyzing={analyzing} error={error}
            uploadedFileName={uploadedFileName} uploadedFileSize={uploadedFileSize}
            onFileUpload={handleFile} onClearFile={clearFile} onAnalyze={handleAnalyze}
            context={context} setContext={setContext}
            liveFindings={liveFindings} completionFlash={completionFlash}
          />
          <p className="text-[12px] text-ink-3 mt-3">
            {t('newPage.tailored')} · <Link href="/app/settings" className="text-green-deep hover:underline">{t('newPage.edit')}</Link>
          </p>
        </div>
      </PageBody>
    </AppPage>
  )
}
