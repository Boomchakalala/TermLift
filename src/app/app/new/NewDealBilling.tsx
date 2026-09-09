'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CreditCard, CheckCircle2 } from 'lucide-react'
import { useI18n } from '@/i18n/context'
import { Btn, GateCard } from '@/components/system'

interface Props {
  state: 'none' | 'credit' | 'gate'
  price: string
  limit: number
  checkout: string | null
  sessionId: string | null
}

/**
 * The paid path on the new-deal page: the gate before the uploader when the
 * free quota is used, the "credit waiting" note once paid, and the return leg
 * from Stripe Checkout (confirm with the server, then reload the page state).
 */
export function NewDealBilling({ state, price, limit, checkout, sessionId }: Props) {
  const { t, locale } = useI18n()
  const router = useRouter()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(checkout === 'success' && !!sessionId)
  const [cancelled, setCancelled] = useState(checkout === 'cancelled')
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current || !checkout) return
    handled.current = true
    if (checkout !== 'success' || !sessionId) { router.replace('/app/new'); return }
    ;(async () => {
      try {
        const res = await fetch('/api/billing/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) throw new Error(data.error || 'Payment not confirmed yet')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Payment not confirmed yet')
      } finally {
        setConfirming(false)
        router.replace('/app/new')
        router.refresh()
      }
    })()
  }, [checkout, sessionId, router])

  const start = async () => {
    setStarting(true); setError(null); setCancelled(false)
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start the payment')
      window.location.assign(data.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the payment')
      setStarting(false)
    }
  }

  if (confirming) {
    return <p className="mb-4 text-[13px] rounded-[10px] px-3.5 py-2.5 border bg-green-soft border-green-line text-green-deep inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{t('billing.confirming')}</p>
  }

  if (state === 'gate') {
    return (
      <div className="mb-4">
        <GateCard
          tone="green"
          eyebrow={t('billing.gateEyebrow')}
          title={t('billing.gateTitle')}
          body={<>{t('billing.gateBody', { limit, price })}{cancelled && <span className="block mt-1.5 text-ink-3">{t('billing.cancelled')}</span>}{error && <span className="block mt-1.5 text-risk">{error}</span>}</>}
          action={<Btn variant="primary" onClick={start} disabled={starting}>{starting ? <><Loader2 className="w-4 h-4 animate-spin" />{t('billing.gateStarting')}</> : <><CreditCard className="w-4 h-4" />{t('billing.gateCta', { price })}</>}</Btn>}
        />
      </div>
    )
  }

  if (state === 'credit') {
    return (
      <p className="mb-4 text-[13px] rounded-[10px] px-3.5 py-2.5 border bg-green-soft border-green-line text-green-deep inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />{t('billing.creditReady')}</p>
    )
  }

  if (cancelled) return <p className="mb-4 text-[13px] text-ink-3">{t('billing.cancelled')}</p>
  return null
}
