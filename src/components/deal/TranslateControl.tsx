'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Languages, Loader2 } from 'lucide-react'
import { useT } from '@/i18n/context'
import { Chip } from '@/components/system'
import type { OutputLocale } from '@/lib/output-language'

export interface LanguageView {
  /** Language the deal's content was generated in (Round 1). */
  dealLocale: OutputLocale
  /** Language the UI is showing. */
  uiLocale: OutputLocale
  /** original: showing the stored content · translated: showing the cached copy · untranslated: no copy yet */
  state: 'original' | 'translated' | 'untranslated'
  /** True when a cached copy exists for uiLocale (so "View in …" can just link). */
  available: boolean
}

/**
 * The small language control in the deal header, shown only when the deal's
 * generated language differs from the UI language. Translating is a one-off
 * Haiku pass cached per round; nothing re-analyses, nothing overwrites.
 */
export function TranslateControl({ dealId, view }: { dealId: string; view: LanguageView }) {
  const t = useT()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (view.dealLocale === view.uiLocale) return null

  const base = `/app/deal/${dealId}`
  const translate = async () => {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`${base}/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: view.uiLocale }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'failed')
      router.refresh()
    } catch {
      setError(t('dealPage.translateFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (view.state === 'translated') {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3" title={t('dealPage.translateNote')}>
        <Chip><Languages className="w-3 h-3" />{t('dealPage.translatedFrom')}</Chip>
        <Link href={`${base}?original=1`} className="text-ink-2 hover:text-ink underline underline-offset-2 no-underline hover:underline">{t('dealPage.viewOriginal')}</Link>
      </span>
    )
  }
  if (view.available) {
    return <Link href={base} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line bg-surface text-[12.5px] font-semibold text-ink-2 hover:text-ink hover:border-[#C9D3CE] no-underline"><Languages className="w-3.5 h-3.5" />{t('dealPage.translateTo')}</Link>
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={translate} disabled={busy} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line bg-surface text-[12.5px] font-semibold text-ink-2 hover:text-ink hover:border-[#C9D3CE] disabled:opacity-60 transition-colors">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Languages className="w-3.5 h-3.5" />}
        {busy ? t('dealPage.translating') : error ? t('dealPage.translateRetry') : t('dealPage.translateTo')}
      </button>
      {error && <span role="alert" className="text-[12px] text-risk">{error}</span>}
    </span>
  )
}
