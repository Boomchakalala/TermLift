'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import {
  User, Globe, Shield, AlertTriangle, Bell,
  Briefcase, Check, Loader2, Mail, Target, Zap, ChevronDown,
  Heart, Scale, Swords, Send, Sparkles, FileText, BarChart3,
  TrendingUp, CheckCircle2, Monitor, MessageSquare, Palette, Handshake,
} from 'lucide-react'
import { useI18n } from '@/i18n/context'
import { AppPage, PageHeader } from '@/components/system'
import { FREE_ANALYSIS_LIMIT } from '@/lib/pricing'
import { NEGOTIATION_FEE_PERCENT } from '@/lib/pricing'
import { RAW_TEXT_MAX_AGE_DAYS, NEGOTIATION_DOC_GRACE_DAYS, NEGOTIATION_DOC_MAX_AGE_DAYS } from '@/lib/retention'

interface NegotiationPrefs {
  payment_terms: 'net_30' | 'net_60' | 'net_90' | 'no_preference'
  top_priority: 'lowest_price' | 'best_terms' | 'max_flexibility'
  auto_renewal: 'fine' | 'prefer_opt_in'
  contract_term_strategy: 'match_quote' | 'push_longer' | 'no_preference'
}

interface SettingsClientProps {
  email: string; firstName: string; lastName: string
  usageCount: number; dealCount: number; activeDeals: number; closedDeals: number; roundCount: number
  isAdmin: boolean; baseCurrency: string; totalSavings: string; memberSince: string; joinedAgo: string
  locale: string; negotiationPreferences?: NegotiationPrefs | null
}

type Section = 'profile' | 'display' | 'negotiation' | 'notifications' | 'privacy' | 'danger'

export function SettingsClient({
  email, firstName: initFirst, lastName: initLast,
  usageCount, dealCount, activeDeals, closedDeals, roundCount,
  isAdmin, baseCurrency: initCurrency, totalSavings, memberSince, joinedAgo,
  negotiationPreferences: initPrefs,
}: SettingsClientProps) {
  const router = useRouter()
  const supabase = createClient()
  const { t, locale, setLocale } = useI18n()

  const [activeSection, setActiveSection] = useState<Section>('profile')

  // ── state (unchanged) ──────────────────────
  const [firstName, setFirstName] = useState(initFirst)
  const [lastName, setLastName] = useState(initLast)
  const [nameSaving, setNameSaving] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [selectedCurrency, setSelectedCurrency] = useState(initCurrency)
  const [currencySaving, setCurrencySaving] = useState(false)
  const [productEmails, setProductEmails] = useState(true)
  const defaultPrefs: NegotiationPrefs = { payment_terms: 'no_preference', top_priority: 'lowest_price', auto_renewal: 'prefer_opt_in', contract_term_strategy: 'match_quote' }
  const [negPrefs, setNegPrefs] = useState<NegotiationPrefs>(initPrefs || defaultPrefs)
  const [prefsSaving, setPrefsSaving] = useState(false)
  const [prefsSaved, setPrefsSaved] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // ── new state (visual-only, no API yet) ────
  const [emailTone, setEmailTone] = useState<'friendly' | 'direct' | 'firm'>('friendly')
  const [companyName, setCompanyName] = useState('')
  const [companySize, setCompanySize] = useState('')
  const [industry, setIndustry] = useState('')
  const [negStyle, setNegStyle] = useState<'collaborative' | 'balanced' | 'aggressive'>('collaborative')
  const [sigName, setSigName] = useState(initFirst || '')
  const [sigTitle, setSigTitle] = useState('')
  const [renewalReminders, setRenewalReminders] = useState(true)
  const [weeklyDigest, setWeeklyDigest] = useState(false)
  const [dealAlerts, setDealAlerts] = useState(true)
  const [notifProductUpdates, setNotifProductUpdates] = useState(true)

  const remaining = Math.max(0, FREE_ANALYSIS_LIMIT - usageCount)
  const avatarInitial = firstName ? firstName[0].toUpperCase() : email[0].toUpperCase()

  // ── handlers (unchanged) ───────────────────
  const handleSaveName = async () => {
    setNameSaving(true)
    try { const res = await fetch('/api/user/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim() }) }); if (res.ok) { setNameSaved(true); setTimeout(() => setNameSaved(false), 2000) } } catch {}
    setNameSaving(false)
  }
  const handleCurrencyChange = async (val: string) => {
    setSelectedCurrency(val); setCurrencySaving(true)
    try { await fetch('/api/user/currency', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseCurrency: val }) }); router.refresh() } catch {}
    setCurrencySaving(false)
  }
  const handleLanguageChange = (val: string) => { setLocale(val as 'en' | 'fr') }
  const handlePasswordReset = async () => {
    setResetLoading(true)
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/app/settings` })
    setResetLoading(false); setResetSent(true)
  }
  const handleSavePrefs = async () => {
    setPrefsSaving(true)
    try { const res = await fetch('/api/user/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(negPrefs) }); if (res.ok) { setPrefsSaved(true); setTimeout(() => setPrefsSaved(false), 2000) } } catch {}
    setPrefsSaving(false)
  }
  const handleDeleteAccount = async () => {
    setDeleteLoading(true); setDeleteError(null)
    try { const res = await fetch('/api/account/delete', { method: 'POST' }); if (!res.ok) throw new Error((await res.json()).error || 'Failed'); await supabase.auth.signOut(); router.push('/') } catch (err) { setDeleteError(err instanceof Error ? err.message : 'Something went wrong'); setDeleteLoading(false) }
  }
  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  // ── nav items ──────────────────────────────
  const navGroups = [
    { label: 'Account', items: [
      { key: 'profile' as Section, name: t('settingsClient.profile'), icon: User },
    ]},
    { label: locale === 'fr' ? 'Preferences' : 'Preferences', items: [
      { key: 'display' as Section, name: locale === 'fr' ? 'Affichage' : 'Display', icon: Palette },
      { key: 'negotiation' as Section, name: locale === 'fr' ? 'Pr\u00e9f\u00e9rences de n\u00e9gociation' : 'Negotiation preferences', icon: Handshake },
      { key: 'notifications' as Section, name: locale === 'fr' ? 'Notifications' : 'Notifications', icon: Bell, badge: 'NEW' },
    ]},
    { label: locale === 'fr' ? 'Systeme' : 'System', items: [
      { key: 'privacy' as Section, name: locale === 'fr' ? 'Confidentialite' : 'Privacy', icon: Shield },
      { key: 'danger' as Section, name: locale === 'fr' ? 'Zone de danger' : 'Danger Zone', icon: AlertTriangle, isDanger: true },
    ]},
  ]

  const currencies = [
    { val: 'USD', label: '$ USD' }, { val: 'EUR', label: '\u20AC EUR' }, { val: 'GBP', label: '\u00A3 GBP' },
    { val: 'CAD', label: 'C$ CAD' }, { val: 'AUD', label: 'A$ AUD' }, { val: 'CHF', label: 'CHF' }, { val: 'JPY', label: '\u00A5 JPY' },
  ]

  // ── section header/icon color maps ─────────
  const sectionMeta: Record<Section, { icon: any; title: string; color: string }> = {
    profile: { icon: User, title: t('settingsClient.profile'), color: 'emerald' },
    display: { icon: Palette, title: locale === 'fr' ? 'Affichage' : 'Display', color: 'purple' },
    negotiation: { icon: Handshake, title: locale === 'fr' ? 'Pr\u00e9f\u00e9rences de n\u00e9gociation' : 'Negotiation preferences', color: 'amber' },
    notifications: { icon: Bell, title: 'Notifications', color: 'blue' },
    privacy: { icon: Shield, title: locale === 'fr' ? 'Confidentialite' : 'Privacy', color: 'slate' },
    danger: { icon: AlertTriangle, title: locale === 'fr' ? 'Zone de danger' : 'Danger Zone', color: 'red' },
  }

  const bgColorMap: Record<string, string> = {
    emerald: 'bg-green/10', blue: 'bg-blue-500/10', amber: 'bg-amber-500/10',
    red: 'bg-red-500/10', purple: 'bg-purple-500/10', slate: 'bg-ink-3/10',
  }
  const textColorMap: Record<string, string> = {
    emerald: 'text-green-deep', blue: 'text-blue-500', amber: 'text-amber-500',
    red: 'text-red-500', purple: 'text-purple-500', slate: 'text-ink-3',
  }

  const current = sectionMeta[activeSection]

  // ═══════════════════════════════════════════
  return (
    <AppPage>
      <PageHeader title={t('settingsPage.title')} sub={t('settingsPage.sub')} />

      {/* ── BODY ────────────────────────────────── */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0">

        {/* Mobile nav — dropdown select (avoids clipped horizontal scroll) */}
        <div className="flex-shrink-0 bg-white px-4 py-3 border-b border-line md:hidden">
          <div className="flex gap-2">
            <select
              value={activeSection}
              onChange={(e) => setActiveSection(e.target.value as Section)}
              className="flex-1 px-3 py-2.5 text-[13px] border border-line rounded-[10px] bg-white text-ink-2 focus:outline-none  focus:border-green/30 focus:border-green transition-all"
            >
              {navGroups.flatMap(group =>
                group.items.map(item => (
                  <option key={item.key} value={item.key}>{item.name}</option>
                ))
              )}
            </select>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-medium text-ink-3 border border-line rounded-[10px] hover:bg-surface-2 transition-all whitespace-nowrap"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Sign out
            </button>
          </div>
        </div>

        {/* Desktop nav — vertical sidebar */}
        <div className="hidden md:flex md:flex-col w-[220px] flex-shrink-0 bg-surface px-3 py-4 border-r border-line justify-between">
          <div>{navGroups.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] font-bold text-ink-3 uppercase tracking-wider mb-2 px-2 pt-2">{group.label}</p>
              <nav className="flex flex-col space-y-0.5">
                {group.items.map((item) => {
                  const isDanger = (item as any).isDanger
                  const isActive = activeSection === item.key
                  const badge = (item as any).badge
                  return (
                    <button
                      key={item.key}
                      onClick={() => setActiveSection(item.key)}
                      className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors text-left ${
                        isDanger
                          ? isActive
                            ? 'bg-risk-soft text-risk'
                            : 'text-risk hover:bg-risk-soft'
                          : isActive
                          ? 'bg-green-soft text-green-deep font-semibold'
                          : 'text-ink-2 hover:bg-ground hover:text-ink'
                      }`}
                    >
                      <item.icon className={`w-4 h-4 flex-shrink-0 ${
                        isDanger
                          ? 'text-risk'
                          : isActive ? 'text-green-deep' : 'text-ink-3'
                      }`} />
                      {item.name}
                      {badge && (
                        <span className="ml-auto text-[9px] font-bold text-green-deep bg-green/10 px-1.5 py-0.5 rounded">
                          {badge}
                        </span>
                      )}
                    </button>
                  )
                })}
              </nav>
            </div>
          ))}</div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-[10px] text-[13px] font-medium text-ink-3 hover:bg-surface-2 hover:text-ink-2 transition-all text-left mt-2"
          >
            <svg className="w-4 h-4 flex-shrink-0 text-ink-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign out
          </button>
        </div>

        {/* CONTENT */}
        <div className="flex-1 p-4 md:p-6 bg-ground pb-24 md:pb-10">
          <div className={`bg-surface border ${activeSection === 'danger' ? 'border-risk-line' : 'border-line'} rounded-[14px] p-4 sm:p-5 max-w-[860px]`}>
            {/* Section header */}
            <div className="flex items-center gap-3 mb-5">
              <div className={`w-9 h-9 rounded-[10px] ${bgColorMap[current.color]} flex items-center justify-center`}>
                <current.icon className={`w-[18px] h-[18px] ${textColorMap[current.color]}`} />
              </div>
              <h3 className="text-[14px] font-bold uppercase tracking-wide text-ink font-display">{current.title}</h3>
            </div>

            {/* ═══ PROFILE ═══ */}
            {activeSection === 'profile' && (
              <div className="space-y-6">
                {/* Avatar + info */}
                <div className="flex items-center gap-5">
                  <div className="w-20 h-20 rounded-full bg-green flex items-center justify-center flex-shrink-0 text-2xl font-bold text-white shadow-md">
                    {avatarInitial}
                  </div>
                  <div>
                    <h4 className="text-[15px] font-bold text-ink font-display">
                      {firstName || lastName ? `${firstName} ${lastName}`.trim() : email.split('@')[0]}
                    </h4>
                    <p className="text-[12px] text-ink-3 mt-0.5">{email}</p>
                    <div className="flex items-center gap-2 mt-2">
                      {isAdmin && <span className="text-[11px] font-bold text-white bg-ink px-2 py-0.5 rounded-full">Admin</span>}
                      <span className="text-[11px] text-ink-3">{t('settingsClient.memberSince', { date: memberSince })}</span>
                    </div>
                  </div>
                </div>

                {/* Name fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[12px] font-medium text-ink-3 mb-1.5 block">{t('settingsClient.firstName')}</label>
                    <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder={t('settingsClient.firstName')} className="w-full px-4 py-3 text-[13px] border border-line rounded-[10px] focus:outline-none  focus:border-green/30 focus:border-green transition-all" />
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-ink-3 mb-1.5 block">{t('settingsClient.lastName')}</label>
                    <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder={t('settingsClient.lastName')} className="w-full px-4 py-3 text-[13px] border border-line rounded-[10px] focus:outline-none  focus:border-green/30 focus:border-green transition-all" />
                  </div>
                </div>
                <button onClick={handleSaveName} disabled={nameSaving} className="px-4 py-2 text-[12px] font-semibold text-white bg-green hover:bg-green-deep rounded-[10px] transition-colors disabled:opacity-50">
                  {nameSaved ? <span className="flex items-center gap-1"><Check className="w-3 h-3" />{t('settingsClient.saved')}</span> : nameSaving ? t('settingsClient.saving') : t('settingsClient.saveName')}
                </button>

                {/* Email + password */}
                <div className="pt-4 border-t border-line-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[12px] font-medium text-ink-3">{t('settingsClient.email')}</p>
                      <p className="text-[13px] text-ink-2 mt-0.5">{email}</p>
                    </div>
                    {resetSent ? (
                      <span className="text-[12px] text-green-deep font-medium">{t('settingsClient.resetEmailSent')}</span>
                    ) : (
                      <button onClick={handlePasswordReset} disabled={resetLoading} className="text-[12px] font-medium text-green-deep hover:text-green-deep transition-colors disabled:opacity-50">
                        {resetLoading ? t('settingsClient.sending') : t('settingsClient.sendResetEmail')}
                      </button>
                    )}
                  </div>
                </div>

                {/* Usage stats */}
                <div className="pt-5 border-t border-line-2">
                  <p className="text-[12px] font-bold text-ink uppercase tracking-wide mb-4">{t('settingsClient.usage')}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    <div className="bg-ground rounded-[10px] p-4 border border-line">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-surface-2 flex items-center justify-center"><FileText className="w-3.5 h-3.5 text-ink-3" /></div>
                        <p className="text-[11px] text-ink-3">{t('settingsClient.analysesTotal')}</p>
                      </div>
                      <p className="text-[22px] font-bold text-ink font-display">{dealCount}</p>
                    </div>
                    <div className="bg-ground rounded-[10px] p-4 border border-line">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-surface-2 flex items-center justify-center"><BarChart3 className="w-3.5 h-3.5 text-ink-3" /></div>
                        <p className="text-[11px] text-ink-3">{t('settingsClient.roundsCreated')}</p>
                      </div>
                      <p className="text-[22px] font-bold text-ink font-display">{roundCount}</p>
                    </div>
                    <div className="bg-ground rounded-[10px] p-4 border border-line">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-green-soft flex items-center justify-center"><Zap className="w-3.5 h-3.5 text-green-deep" /></div>
                        <p className="text-[11px] text-ink-3">{t('settingsClient.activeDeals')}</p>
                      </div>
                      <p className="text-[22px] font-bold text-ink font-display">{activeDeals}</p>
                    </div>
                    <div className="bg-ground rounded-[10px] p-4 border border-line">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-green-soft flex items-center justify-center"><CheckCircle2 className="w-3.5 h-3.5 text-green-deep" /></div>
                        <p className="text-[11px] text-ink-3">{t('settingsClient.closedDeals')}</p>
                      </div>
                      <p className="text-[22px] font-bold text-ink font-display">{closedDeals}</p>
                    </div>
                    <div className="bg-green-soft rounded-[10px] p-4 border border-green-line">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-green flex items-center justify-center"><TrendingUp className="w-3.5 h-3.5 text-white" /></div>
                        <p className="text-[11px] text-green-deep">{locale === 'fr' ? '\u00c9conomis\u00e9' : 'Saved'}</p>
                      </div>
                      <p className="text-[22px] font-bold text-green-deep font-display">{totalSavings}</p>
                    </div>
                  </div>
                </div>

                {/* Usage — replaces the dormant Subscription section. No plan model to manage. */}
                <div className="rounded-[14px] border border-line bg-surface-2 px-4 py-3.5">
                  <p className="tl-h3 text-ink mb-2.5">{t('settingsPage.usage')}</p>
                  <div className="flex items-center justify-between text-[13px] mb-1.5">
                    <b>{t('settingsPage.usageQuick')}</b>
                    <span className="text-ink-2 tl-num">{t('settingsPage.usageUsed', { used: Math.min(usageCount, FREE_ANALYSIS_LIMIT), limit: FREE_ANALYSIS_LIMIT })}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-line-2 overflow-hidden"><div className="h-full rounded-full bg-green" style={{ width: `${Math.min(100, (usageCount / FREE_ANALYSIS_LIMIT) * 100)}%` }} /></div>
                  <p className="text-[12px] text-ink-3 mt-2.5">{t('settingsPage.usageNote', { pct: NEGOTIATION_FEE_PERCENT })}</p>
                  {remaining === 0 && <a href="mailto:hello@termlift.com" className="inline-block mt-2 text-[12.5px] font-semibold text-green-deep hover:underline">{t('settingsPage.usageContact')}</a>}
                </div>
              </div>
            )}

            {/* ═══ DISPLAY ═══ */}
            {activeSection === 'display' && (
              <div className="space-y-6">
                {/* Currency */}
                <div>
                  <p className="text-[12px] font-medium text-ink-3 mb-3">{t('settingsClient.baseCurrency')}</p>
                  <p className="text-[11.5px] text-ink-3 mb-3">{t('settingsClient.baseCurrencyDesc')}</p>
                  <div className="flex flex-wrap gap-2">
                    {currencies.map((c) => (
                      <button
                        key={c.val}
                        onClick={() => handleCurrencyChange(c.val)}
                        disabled={currencySaving}
                        className={`px-3.5 py-2 rounded-[10px] text-[12px] font-semibold transition-all ${
                          selectedCurrency === c.val
                            ? 'bg-green text-white '
                            : 'bg-surface-2 text-ink-2 hover:bg-line-2'
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Language */}
                <div>
                  <p className="text-[12px] font-medium text-ink-3 mb-3">{t('settingsClient.language')}</p>
                  <div className="grid grid-cols-2 gap-3">
                    {[{ val: 'en', flag: '\uD83C\uDDEC\uD83C\uDDE7', name: 'English' }, { val: 'fr', flag: '\uD83C\uDDEB\uD83C\uDDF7', name: 'Français' }].map((l) => (
                      <button
                        key={l.val}
                        onClick={() => handleLanguageChange(l.val)}
                        className={`flex items-center gap-3 p-3.5 rounded-[10px] border-2 transition-all ${
                          locale === l.val
                            ? 'border-green bg-green/5'
                            : 'border-line hover:border-[#C9D3CE]'
                        }`}
                      >
                        <span className="text-xl">{l.flag}</span>
                        <div className="text-left">
                          <p className={`text-[13px] font-semibold ${locale === l.val ? 'text-green-deep' : 'text-ink-2'}`}>{l.name}</p>
                        </div>
                        {locale === l.val && <Check className="w-4 h-4 text-green-deep ml-auto" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ═══ NEGOTIATION ═══ */}
            {activeSection === 'negotiation' && (
              <div className="space-y-7">
                {/* Payment terms */}
                <div>
                  <p className="text-[12px] font-medium text-ink-3 mb-3">{t('settingsClient.paymentTerms')}</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {[
                      { val: 'no_preference', label: t('settingsClient.noPreference') },
                      { val: 'net_30', label: 'Net 30' },
                      { val: 'net_60', label: 'Net 60' },
                      { val: 'net_90', label: 'Net 90' },
                    ].map(opt => (
                      <SelectCard key={opt.val} selected={negPrefs.payment_terms === opt.val} onClick={() => setNegPrefs({ ...negPrefs, payment_terms: opt.val as NegotiationPrefs['payment_terms'] })} title={opt.label} />
                    ))}
                  </div>
                </div>

                {/* Top priority */}
                <div>
                  <p className="text-[12px] font-medium text-ink-3 mb-3">{t('settingsClient.topPriority')}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {[
                      { val: 'lowest_price', label: t('settingsClient.lowestPrice'), icon: Zap },
                      { val: 'best_terms', label: t('settingsClient.bestTerms'), icon: Scale },
                      { val: 'max_flexibility', label: t('settingsClient.maxFlexibility'), icon: Sparkles },
                    ].map(opt => (
                      <SelectCard key={opt.val} selected={negPrefs.top_priority === opt.val} onClick={() => setNegPrefs({ ...negPrefs, top_priority: opt.val as NegotiationPrefs['top_priority'] })} title={opt.label} icon={opt.icon} />
                    ))}
                  </div>
                </div>

                {/* Auto-renewal */}
                <div>
                  <p className="text-[12px] font-medium text-ink-3 mb-3">{t('settingsClient.autoRenewal')}</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    <SelectCard selected={negPrefs.auto_renewal === 'fine'} onClick={() => setNegPrefs({ ...negPrefs, auto_renewal: 'fine' })} title={t('settingsClient.autoRenewalFine')} desc="No issue with auto-renewal clauses" />
                    <SelectCard selected={negPrefs.auto_renewal === 'prefer_opt_in'} onClick={() => setNegPrefs({ ...negPrefs, auto_renewal: 'prefer_opt_in' })} title={t('settingsClient.autoRenewalOptIn')} desc="Want manual renewal control" />
                  </div>
                </div>

                {/* Contract term strategy */}
                <div>
                  <p className="text-[12px] font-medium text-ink-3 mb-1">Contract term strategy</p>
                  <p className="text-[11px] text-ink-3 mb-3">Controls whether the AI suggests extending the quoted contract term as a negotiation lever.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <SelectCard
                      selected={negPrefs.contract_term_strategy === 'match_quote'}
                      onClick={() => setNegPrefs({ ...negPrefs, contract_term_strategy: 'match_quote' })}
                      title="Match the quote"
                      desc="Don't suggest a longer term than what's quoted"
                    />
                    <SelectCard
                      selected={negPrefs.contract_term_strategy === 'push_longer'}
                      onClick={() => setNegPrefs({ ...negPrefs, contract_term_strategy: 'push_longer' })}
                      title="Push longer if it saves"
                      desc="Flag extended term as leverage if it unlocks savings"
                    />
                    <SelectCard
                      selected={negPrefs.contract_term_strategy === 'no_preference'}
                      onClick={() => setNegPrefs({ ...negPrefs, contract_term_strategy: 'no_preference' })}
                      title="No preference"
                      desc="AI decides based on context"
                    />
                  </div>
                </div>

                {/* Email tone (NEW) */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <p className="text-[12px] font-medium text-ink-3">Default email tone</p>
                    <span className="text-[10px] font-bold text-green-deep bg-green/10 px-1.5 py-0.5 rounded">NEW</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {[
                      { val: 'friendly' as const, label: 'Friendly', desc: 'Warm and collaborative, relationship-first', icon: Heart },
                      { val: 'direct' as const, label: 'Direct', desc: 'Clear and concise, gets to the point', icon: Send },
                      { val: 'firm' as const, label: 'Firm', desc: 'Professional pushback, strong position', icon: Shield },
                    ].map(opt => (
                      <SelectCard key={opt.val} selected={emailTone === opt.val} onClick={() => setEmailTone(opt.val)} title={opt.label} desc={opt.desc} icon={opt.icon} />
                    ))}
                  </div>
                </div>

                {/* Negotiation style (NEW) */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <p className="text-[12px] font-medium text-ink-3">Negotiation style</p>
                    <span className="text-[10px] font-bold text-green-deep bg-green/10 px-1.5 py-0.5 rounded">NEW</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {[
                      { val: 'collaborative' as const, label: 'Collaborative', desc: 'Build long-term relationships', icon: Heart },
                      { val: 'balanced' as const, label: 'Balanced', desc: 'Fair but firm', icon: Scale },
                      { val: 'aggressive' as const, label: 'Aggressive', desc: 'Maximum savings, push hard', icon: Swords },
                    ].map(opt => (
                      <SelectCard key={opt.val} selected={negStyle === opt.val} onClick={() => setNegStyle(opt.val)} title={opt.label} desc={opt.desc} icon={opt.icon} />
                    ))}
                  </div>
                </div>

                {/* Company info (NEW) */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <p className="text-[12px] font-medium text-ink-3">Company information</p>
                    <span className="text-[10px] font-bold text-green-deep bg-green/10 px-1.5 py-0.5 rounded">NEW</span>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[11px] font-medium text-ink-3 mb-1 block">Company name</label>
                      <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Acme Corp" className="w-full px-4 py-3 text-[13px] border border-line rounded-[10px] focus:outline-none  focus:border-green/30 focus:border-green transition-all" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-medium text-ink-3 mb-1 block">Company size</label>
                        <select value={companySize} onChange={e => setCompanySize(e.target.value)} className="w-full px-4 py-3 text-[13px] border border-line rounded-[10px] focus:outline-none  focus:border-green/30 focus:border-green transition-all bg-white">
                          <option value="">Select...</option>
                          <option value="1-10">1-10</option>
                          <option value="11-50">11-50</option>
                          <option value="51-200">51-200</option>
                          <option value="201-500">201-500</option>
                          <option value="500+">500+</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-ink-3 mb-1 block">Industry</label>
                        <select value={industry} onChange={e => setIndustry(e.target.value)} className="w-full px-4 py-3 text-[13px] border border-line rounded-[10px] focus:outline-none  focus:border-green/30 focus:border-green transition-all bg-white">
                          <option value="">Select...</option>
                          <option value="technology">Technology</option>
                          <option value="finance">Finance</option>
                          <option value="healthcare">Healthcare</option>
                          <option value="retail">Retail</option>
                          <option value="manufacturing">Manufacturing</option>
                          <option value="professional_services">Professional Services</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Email signature (NEW) */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <p className="text-[12px] font-medium text-ink-3">Email signature</p>
                    <span className="text-[10px] font-bold text-green-deep bg-green/10 px-1.5 py-0.5 rounded">NEW</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-[11px] font-medium text-ink-3 mb-1 block">Name</label>
                      <input value={sigName} onChange={e => setSigName(e.target.value)} className="w-full px-4 py-3 text-[13px] border border-line rounded-[10px] focus:outline-none  focus:border-green/30 focus:border-green transition-all" />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-ink-3 mb-1 block">Job title</label>
                      <input value={sigTitle} onChange={e => setSigTitle(e.target.value)} placeholder="Procurement Manager" className="w-full px-4 py-3 text-[13px] border border-line rounded-[10px] focus:outline-none  focus:border-green/30 focus:border-green transition-all" />
                    </div>
                  </div>
                  <div className="bg-ground rounded-[10px] p-4 border border-line-2">
                    <p className="text-[11px] text-ink-3 mb-1">Preview</p>
                    <div className="text-[13px] text-ink-2 leading-relaxed">
                      <p>Best regards,</p>
                      <p className="font-semibold text-ink mt-1">{sigName || 'Your name'}</p>
                      {sigTitle && <p className="text-ink-3">{sigTitle}</p>}
                      {companyName && <p className="text-ink-3">{companyName}</p>}
                    </div>
                  </div>
                </div>

                <button onClick={handleSavePrefs} disabled={prefsSaving} className="px-5 py-2.5 text-[12px] font-semibold text-white bg-green hover:bg-green-deep rounded-[10px] transition-colors disabled:opacity-50">
                  {prefsSaved ? <span className="flex items-center gap-1"><Check className="w-3 h-3" />{t('settingsClient.saved')}</span> : prefsSaving ? t('settingsClient.saving') : t('settingsClient.savePreferences')}
                </button>
              </div>
            )}

            {/* ═══ NOTIFICATIONS ═══ */}
            {activeSection === 'notifications' && (
              <div className="space-y-5">
                <div className="space-y-4">
                  <ToggleRow label="Renewal reminders (30 days before renewal dates)" description="" value={renewalReminders} onChange={setRenewalReminders} />
                  <ToggleRow label="Weekly savings digest" description="" value={weeklyDigest} onChange={setWeeklyDigest} />
                  <ToggleRow label="Deal activity alerts (when rounds complete)" description="" value={dealAlerts} onChange={setDealAlerts} />
                  <ToggleRow label="Product updates & tips" description="" value={notifProductUpdates} onChange={setNotifProductUpdates} />
                </div>
                <p className="text-[11px] text-ink-3">Notifications are sent to {email}</p>
              </div>
            )}

            {/* ═══ PRIVACY ═══ */}
            {activeSection === 'privacy' && (
              <div className="space-y-5">
                <div className="space-y-4">
                  <ToggleRow label={t('settingsClient.receiveEmails')} description={t('settingsClient.receiveEmailsDesc')} value={productEmails} onChange={setProductEmails} />
                </div>
                {/* Not a toggle: this is what happens, stated plainly. The old "save extracted text"
                    switch was never wired to anything, so it was removed rather than left lying. */}
                <div className="bg-ground rounded-[10px] p-4 border border-line-2 space-y-2">
                  <p className="text-[12px] font-semibold text-ink">{t('settingsClient.retentionTitle')}</p>
                  <ul className="text-[11.5px] text-ink-3 leading-relaxed list-disc pl-4 space-y-1">
                    <li>{t('settingsClient.retentionFiles')}</li>
                    <li>{t('settingsClient.retentionText', { days: RAW_TEXT_MAX_AGE_DAYS })}</li>
                    <li>{t('settingsClient.retentionDocs', { grace: NEGOTIATION_DOC_GRACE_DAYS, months: Math.round(NEGOTIATION_DOC_MAX_AGE_DAYS / 30) })}</li>
                    <li>{t('settingsClient.retentionDelete')}</li>
                  </ul>
                  <p className="text-[11px] text-ink-3"><a href="/privacy" className="text-green-deep font-medium hover:underline">{t('settingsClient.retentionLink')}</a></p>
                </div>
              </div>
            )}

            {/* ═══ DANGER ZONE ═══ */}
            {activeSection === 'danger' && (
              <div className="space-y-4">
                <div className="bg-risk-soft rounded-[10px] p-4 border border-risk-line">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-[10px] bg-red-500/10 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-[18px] h-[18px] text-red-500" />
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-risk">{t('settingsClient.deleteAccount')}</p>
                      <p className="text-[11px] text-risk/70 mt-1 leading-relaxed">{t('settingsClient.dangerZoneDesc')}</p>
                      <button onClick={() => setShowDeleteModal(true)} className="mt-3 px-4 py-2 text-[12px] font-semibold text-white bg-red-500 hover:bg-red-600 rounded-[10px] transition-colors">
                        {t('settingsClient.deleteAccount')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !deleteLoading && setShowDeleteModal(false)}>
          <div className="bg-white rounded-[14px] max-w-md w-full p-6 border border-line shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-[10px] bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <p className="text-[16px] font-bold text-ink font-display">{t('settingsClient.deleteModalTitle')}</p>
            </div>
            <p className="text-[13px] text-ink-3 mb-2">{t('settingsClient.deleteWillDelete')}</p>
            <ul className="text-[13px] text-ink-3 mb-4 space-y-1 ml-3">
              <li>- {t('settingsClient.deleteBullet1', { dealCount, roundCount })}</li>
              <li>- {t('settingsClient.deleteBullet2')}</li>
              <li>- {t('settingsClient.deleteBullet3')}</li>
            </ul>
            <p className="text-[13px] font-semibold text-risk mb-4">{t('settingsClient.deleteCannotUndo')}</p>
            {deleteError && <div className="mb-3 p-3 bg-risk-soft rounded-[10px] text-[12px] text-risk border border-risk-line">{deleteError}</div>}
            <div className="flex items-center gap-3">
              <button onClick={() => setShowDeleteModal(false)} disabled={deleteLoading} className="flex-1 px-4 py-2.5 text-[13px] font-medium rounded-[10px] text-ink-2 disabled:opacity-50 border border-line hover:bg-surface-2 transition-colors">
                {t('settingsClient.cancel')}
              </button>
              <button onClick={handleDeleteAccount} disabled={deleteLoading} className="flex-1 px-4 py-2.5 text-[13px] font-semibold rounded-[10px] bg-red-500 hover:bg-red-600 text-white disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors">
                {deleteLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('settingsClient.deleting')}</> : t('settingsClient.yesDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppPage>
  )
}

// ── subcomponents ──────────────────────────
function SelectCard({ selected, onClick, title, desc, icon: Icon }: { selected: boolean; onClick: () => void; title: string; desc?: string; icon?: any }) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-4 rounded-[10px] border-2 transition-all w-full ${
        selected
          ? 'border-green bg-green/5 ring-1 /20'
          : 'border-line hover:border-[#C9D3CE] bg-white'
      }`}
    >
      <div className="flex items-start gap-3">
        {Icon && (
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${selected ? 'bg-green/10' : 'bg-surface-2'}`}>
            <Icon className={`w-4 h-4 ${selected ? 'text-green-deep' : 'text-ink-3'}`} />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[13px] font-semibold ${selected ? 'text-green-deep' : 'text-ink-2'}`}>{title}</span>
            {selected && <Check className="w-3.5 h-3.5 text-green-deep" />}
          </div>
          {desc && <p className="text-[11px] text-ink-3 mt-0.5 leading-relaxed">{desc}</p>}
        </div>
      </div>
    </button>
  )
}

function RadioCard({ title, value, onChange, options }: { title: string; value: string; onChange: (v: string) => void; options: { val: string; label: string }[] }) {
  return (
    <div className="bg-white rounded-[14px] p-6 border border-line ">
      <p className="text-[12px] font-medium text-ink-3 uppercase mb-4 tracking-wide">{title}</p>
      {options.map((opt) => (
        <button
          key={opt.val}
          onClick={() => onChange(opt.val)}
          className={`w-full flex items-center gap-2.5 p-3 rounded-[10px] mb-2 last:mb-0 transition-all text-left border-2 ${
            value === opt.val ? 'bg-green/5 border-green' : 'border-line'
          }`}
        >
          <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0" style={{ border: `1.5px solid ${value === opt.val ? '#059669' : '#E2E8F0'}`, backgroundColor: value === opt.val ? '#059669' : 'transparent' }}>
            {value === opt.val && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
          </div>
          <span className={`text-[13px] ${value === opt.val ? 'text-ink font-medium' : 'text-ink-2'}`}>{opt.label}</span>
        </button>
      ))}
    </div>
  )
}

function ToggleRow({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1 border-b border-line-2 last:border-0">
      <div className="flex-1">
        <p className="text-[13px] text-ink-2">{label}</p>
        {description && <p className="text-[11px] text-ink-3 mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${value ? 'bg-green' : 'bg-ink-3'}`}
      >
        <span className={`absolute top-[3px] inline-block w-[18px] h-[18px] rounded-full bg-white shadow-md transition-transform ${value ? 'translate-x-[23px]' : 'translate-x-[3px]'}`} />
      </button>
    </div>
  )
}
