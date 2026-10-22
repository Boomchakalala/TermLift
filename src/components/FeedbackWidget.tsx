'use client'

import { useState } from 'react'
import { MessageSquare, X, Loader2, Star } from 'lucide-react'
import { useT } from '@/i18n/context'

export function FeedbackWidget() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!message.trim() && !rating) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: rating || null,
          message: message.trim(),
          pageUrl: window.location.pathname,
        }),
      })
      if (!res.ok) throw new Error()
      setSent(true)
      setTimeout(() => {
        setOpen(false)
        setSent(false)
        setRating(0)
        setMessage('')
      }, 2000)
    } catch {
      setError(t('feedback.errorGeneric'))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {/* Tab button — fixed to right edge */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed right-0 bottom-[calc(120px+env(safe-area-inset-bottom))] md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-40 bg-green hover:bg-green-deep text-white px-2 py-3 rounded-l-lg shadow-lg transition-all hover:shadow-xl"
          style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
        >
          <span className="text-xs font-semibold tracking-wide flex items-center gap-1.5">
            <MessageSquare className="w-3 h-3 rotate-90" />
            {t('feedback.tab')}
          </span>
        </button>
      )}

      {/* Slide-in panel */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => !sending && setOpen(false)} />
          <div className="fixed right-0 top-1/2 -translate-y-1/2 z-50 w-[calc(100vw-1rem)] sm:w-80 bg-white rounded-l-2xl shadow-2xl border border-line border-r-0 animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="px-5 py-4 border-b border-line-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">{t('feedback.title')}</h3>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-surface-2 rounded-lg transition-colors">
                <X className="w-4 h-4 text-ink-3" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {sent ? (
                <div className="text-center py-6">
                  <div className="w-12 h-12 rounded-full bg-green-soft flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-green-deep" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <p className="text-sm text-ink-2 font-medium">{t('feedback.thanks')}</p>
                </div>
              ) : (
                <>
                  {/* Star rating */}
                  <div>
                    <p className="text-xs font-medium text-ink-3 mb-2">{t('feedback.rating')}</p>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setRating(star)}
                          onMouseEnter={() => setHoverRating(star)}
                          onMouseLeave={() => setHoverRating(0)}
                          className="p-0.5 transition-transform hover:scale-110"
                        >
                          <Star
                            className={`w-6 h-6 transition-colors ${
                              star <= (hoverRating || rating)
                                ? 'text-amber-400 fill-amber-400'
                                : 'text-line-2'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Message */}
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={t('feedback.placeholder')}
                    rows={4}
                    className="w-full px-3 py-2.5 text-sm border border-line rounded-lg resize-none focus:outline-none  focus:border-green focus:border-green placeholder-ink-3"
                  />

                  {error && <p className="text-xs text-risk">{error}</p>}

                  <button
                    onClick={handleSubmit}
                    disabled={sending || (!message.trim() && !rating)}
                    className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-green text-white hover:bg-green-deep transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {sending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('feedback.sending')}</> : t('feedback.send')}
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
