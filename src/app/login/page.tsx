'use client'

import { useState, Suspense, useEffect } from 'react'
import { NEW_DEALS_PER_DAY } from '@/lib/pricing'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { trackEvent, identifyUser } from '@/lib/analytics'
import { useT } from '@/i18n/context'
import { Logo } from '@/components/MarketingHeader'
import { Btn } from '@/components/system'

const inputCls = 'w-full h-10 rounded-[10px] border border-line bg-surface px-3 text-[13.5px] text-ink placeholder:text-ink-3 focus:outline-none focus:border-green focus:ring-[3px] focus:ring-green/15 disabled:opacity-60'

function LoginForm() {
  const t = useT()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromTrial = searchParams.get('from') === 'trial'
  const fromNegotiate = searchParams.get('from') === 'negotiate'
  // Post-auth destination — only same-site paths, never external URLs (open-redirect guard)
  const nextRaw = searchParams.get('next')
  const nextPath = nextRaw && /^\/(?!\/)/.test(nextRaw) ? nextRaw : '/app'
  const supabase = createClient()

  // Visitors from the trial or the negotiate funnel are almost always new
  useEffect(() => {
    if (fromTrial || fromNegotiate) setIsSignUp(true)
  }, [fromTrial, fromNegotiate])

  // The OAuth callback bounces here with ?error= when the exchange fails — say so instead of silently reloading.
  const authError = searchParams.get('error')
  useEffect(() => {
    if (!authError) return
    setError(authError === 'auth_failed' ? t('login.oauthFailed') : `${t('login.oauthFailed')} (${authError})`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authError])

  useEffect(() => {
    if (isSignUp) trackEvent({ name: 'signup_started', properties: { source: fromTrial ? 'trial' : undefined } })
  }, [isSignUp, fromTrial])

  const handleGoogleAuth = async () => {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}${nextPath}` } })
        if (error) throw error
        if (data.user) {
          trackEvent({ name: 'signup_completed', properties: {} })
          identifyUser(data.user.id)
        }
        setMessage(t('login.confirmEmail'))
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        if (data.user) {
          trackEvent({ name: 'login_completed', properties: {} })
          identifyUser(data.user.id)
        }
        router.push(nextPath)
        router.refresh()
      }
    } catch (err) {
      if (err instanceof Error) setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-ground flex flex-col">
      <header className="h-14 flex items-center px-5 sm:px-7">
        <Logo />
        <Link href="/" className="ml-auto text-[13px] font-medium text-ink-2 hover:text-ink no-underline transition-colors">{t('login.backToSite')}</Link>
      </header>
      <div className="flex flex-col flex-1">
        <main className="flex-1 flex flex-col items-center justify-center px-5 sm:px-8 pt-6 pb-16">
          <form onSubmit={handleAuth} className="w-full max-w-[400px] bg-surface border border-line rounded-[14px] px-6 py-7 sm:px-8 sm:py-8 flex flex-col gap-3.5">
            <div className="mb-1">
              <h1 className="font-display font-bold text-[24px] tracking-[-0.02em] text-ink">{isSignUp ? t('login.createAccount') : t('login.welcome')}</h1>
              <p className="text-[13.5px] text-ink-2 mt-1 leading-relaxed">
                {fromTrial ? t('login.trialPrompt', { day: NEW_DEALS_PER_DAY }) : isSignUp ? t('login.signUpStart') : t('login.signInAccess')}
              </p>
            </div>

            <Btn type="button" variant="ghost" block onClick={handleGoogleAuth} disabled={loading}>
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden>
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              {t('login.google')}
            </Btn>

            <div className="flex items-center gap-2.5 text-[12px] text-ink-3"><span className="h-px flex-1 bg-line" />{t('login.orEmail')}<span className="h-px flex-1 bg-line" /></div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-[12.5px] font-semibold text-ink">{t('login.email')}</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('login.emailPlaceholder')} required disabled={loading} className={inputCls} autoComplete="email" />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-[12.5px] font-semibold text-ink">{t('login.password')}</label>
                {!isSignUp && (
                  <Link href="/reset-password" className="text-[12px] font-medium text-green-deep hover:underline no-underline">
                    {t('login.password') === 'Mot de passe' ? 'Mot de passe oublié ?' : 'Forgot password?'}
                  </Link>
                )}
              </div>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('login.passwordPlaceholder')} required disabled={loading} minLength={6} className={inputCls} autoComplete={isSignUp ? 'new-password' : 'current-password'} />
            </div>

            {error && <div role="alert" className="px-3.5 py-2.5 text-[13px] text-risk bg-risk-soft border border-risk-line rounded-[10px]">{error}</div>}
            {message && <div role="status" className="px-3.5 py-2.5 text-[13px] text-green-deep bg-green-soft border border-green-line rounded-[10px]">{message}</div>}

            <Btn type="submit" variant="primary" block disabled={loading}>
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> {isSignUp ? t('login.creating') : t('login.signingIn')}</> : <>{isSignUp ? t('login.createAccountBtn') : t('login.signIn')} <ArrowRight className="w-4 h-4" /></>}
            </Btn>

            <button type="button" onClick={() => { setIsSignUp(!isSignUp); setError(null); setMessage(null) }} disabled={loading} className="text-[13px] text-ink-2 hover:text-ink transition-colors mt-1">
              {isSignUp ? t('login.haveAccount') : t('login.noAccount')}
            </button>

            <p className="text-[11.5px] text-ink-3 leading-relaxed text-center pt-4 mt-1 border-t border-line-2">
              {t('login.terms')}{' '}
              <Link href="/terms" className="text-ink-2 underline underline-offset-2 decoration-line hover:text-ink">{t('login.termsLink')}</Link>
              {' '}{t('login.and')}{' '}
              <Link href="/privacy" className="text-ink-2 underline underline-offset-2 decoration-line hover:text-ink">{t('login.privacyLink')}</Link>.
            </p>
          </form>
          <p className="tl-label text-ink-3 text-[10px] mt-5">{t('login.panel.free')}</p>
        </main>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
