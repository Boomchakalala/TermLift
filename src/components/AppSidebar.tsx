'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useSyncExternalStore } from 'react'
import { FileText, Building2, Settings, User, LogOut, HelpCircle, ChevronDown, ChevronLeft, ChevronRight, Briefcase, Gauge, Plus, BarChart3, ShieldCheck } from 'lucide-react'
import { NotificationBell, type NotificationItem } from '@/components/NotificationBell'
import { useT } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { FREE_ANALYSIS_LIMIT } from '@/lib/pricing'

interface AppSidebarProps {
  userEmail: string
  isUpgraded: boolean
  usageCount: number
  isAdmin: boolean
  /** '/app' for the real app, '/demo' for the demo. */
  linkBase?: string
  demoMode?: boolean
  notifications?: NotificationItem[]
  /** Deals waiting on the user (unlock Deep Analysis, reply to TermLift) — shown as a badge on Deals. */
  needsYou?: number
}

/** Instant tooltip for the collapsed rail — the native title needs a second of stillness and is easy to miss. */
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <span role="tooltip" className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2.5 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[12px] font-medium text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity z-50 before:content-[''] before:absolute before:right-full before:top-1/2 before:-translate-y-1/2 before:border-[5px] before:border-transparent before:border-r-ink">
      {children}
    </span>
  )
}

const EXPANDED = 220
const COLLAPSED = 60
const STORAGE_KEY = 'termlift_sidebar'

// Collapse state lives in localStorage and is read through useSyncExternalStore
// so the server render (expanded) and the client agree without a setState-in-effect.
const listeners = new Set<() => void>()
function readCollapsed(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === 'collapsed' } catch { return false }
}
function writeCollapsed(v: boolean) {
  try { localStorage.setItem(STORAGE_KEY, v ? 'collapsed' : 'expanded') } catch { /* ignore */ }
  document.documentElement.style.setProperty('--sidebar-width', `${v ? COLLAPSED : EXPANDED}px`)
  listeners.forEach((l) => l())
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function AppSidebar({ userEmail, isUpgraded, usageCount, isAdmin, linkBase = '/app', demoMode = false, notifications = [], needsYou = 0 }: AppSidebarProps) {
  const pathname = usePathname()
  const t = useT()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showAdminSheet, setShowAdminSheet] = useState(false)
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false)
  const setCollapsed = (v: boolean) => writeCollapsed(v)

  // Keep the layout's margin in sync with the persisted width on first paint.
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${readCollapsed() ? COLLAPSED : EXPANDED}px`)
  }, [])

  const isActive = (href: string) => (href === linkBase ? pathname === linkBase || pathname.startsWith(`${linkBase}/deal`) : pathname.startsWith(href))
  const onAdmin = pathname.startsWith('/app/admin')

  const adminUnread = notifications.filter((n) => !n.read_at && n.type === 'negotiation_new_request').length

  type Item = { href: string; icon: typeof FileText; label: string; badge?: number; tone?: 'warn' | 'risk' }
  const workspace: Item[] = [
    { href: linkBase, icon: FileText, label: t('nav.deals'), badge: needsYou, tone: 'warn' },
    ...(demoMode ? [] : [{ href: `${linkBase}/vendors`, icon: Building2, label: t('nav.vendors') }]),
  ]
  // Admin tools sit behind one entry that opens only while you are in that area.
  const admin: Item[] = isAdmin && !demoMode ? [
    { href: '/app/admin/negotiations', icon: Briefcase, label: t('nav.adminNegotiations'), badge: adminUnread, tone: 'risk' as const },
    { href: '/app/admin/ai-usage', icon: Gauge, label: t('nav.adminAiUsage') },
    { href: '/app/admin/benchmarks', icon: BarChart3, label: t('nav.adminBenchmarks') },
  ] : []
  const account: Item[] = [
    { href: `${linkBase}/settings`, icon: Settings, label: t('nav.settings') },
    { href: demoMode ? '/help' : `${linkBase}/help`, icon: HelpCircle, label: t('nav.help') },
  ]


  const renderItem = (item: Item, opts: { sub?: boolean; active?: boolean } = {}) => {
    const { sub, active: forcedActive } = opts
    const active = forcedActive ?? isActive(item.href)
    const badge = item.badge ?? 0
    const tip = badge > 0 ? `${item.label} · ${badge}` : item.label
    return (
      <Link
        href={item.href}
        aria-label={collapsed ? tip : undefined}
        className={cn(
          'group relative flex items-center gap-2.5 rounded-lg font-medium transition-colors no-underline',
          sub ? 'h-[30px] text-[13px]' : 'h-[34px] text-[13.5px]',
          collapsed ? 'px-0 justify-center' : 'px-2.5',
          active ? 'bg-green-soft text-green-deep font-semibold' : 'text-ink-2 hover:bg-ground hover:text-ink',
        )}
      >
        <item.icon className={cn('w-4 h-4 shrink-0', active ? 'text-green-deep' : 'text-ink-3')} />
        {!collapsed && (
          <span className="flex-1 flex items-center justify-between min-w-0">
            <span className="truncate">{item.label}</span>
            {badge > 0 && (
              <span className={cn('ml-2 min-w-[18px] h-[18px] px-1 rounded-full text-white text-[10px] font-bold grid place-items-center shrink-0 tl-num', item.tone === 'risk' ? 'bg-risk' : 'bg-warn')}>
                {badge > 9 ? '9+' : badge}
              </span>
            )}
          </span>
        )}
        {collapsed && badge > 0 && <span className={cn('absolute top-1 right-1.5 w-2 h-2 rounded-full', item.tone === 'risk' ? 'bg-risk' : 'bg-warn')} />}
        {collapsed && <Tip>{tip}</Tip>}
      </Link>
    )
  }

  return (
    <>
      {/* Desktop sidebar — variant A: five destinations, admin folded, one loud button. */}
      <aside className={cn('hidden md:flex fixed top-0 left-0 bottom-0 flex-col bg-surface border-r border-line z-40 transition-[width] duration-200', collapsed ? 'w-[60px]' : 'w-[220px]')}>
        <div className={cn('pt-4 pb-3 flex items-center', collapsed ? 'px-2.5 justify-center' : 'px-4')}>
          <Link href="/" className="flex items-center gap-2 no-underline">
            <Image src="/logo-icon.png" alt="TermLift" width={26} height={26} priority />
            {!collapsed && <span className="font-display font-bold text-[16px] tracking-[-0.02em] text-ink">Term<span className="text-green">Lift</span></span>}
          </Link>
        </div>

        {/* Collapse toggle on the edge, out of the navigation's way */}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? t('nav.expand') : t('nav.collapse')}
          aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
          className="absolute top-[62px] -right-[11px] w-[22px] h-[22px] rounded-full bg-surface border border-line text-ink-3 hover:text-ink hover:border-[#C9D3CE] grid place-items-center shadow-sm transition-colors z-50"
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>

        <div className={cn(collapsed ? 'px-3' : 'px-3')}>
          <Link
            href={`${linkBase === '/demo' ? '/login?from=demo' : `${linkBase}/new`}`}
            aria-label={collapsed ? t('nav.newAnalysis') : undefined}
            className={cn('group relative flex items-center justify-center gap-2 h-9 rounded-[10px] bg-green text-white text-[13px] font-semibold no-underline shadow-[0_6px_18px_-8px_rgba(29,185,84,0.7)] hover:bg-[#19a84c] transition-colors', collapsed && 'w-9 mx-auto px-0')}
          >
            <Plus className="w-4 h-4" />
            {!collapsed && t('nav.newAnalysis')}
            {collapsed && <Tip>{t('nav.newAnalysis')}</Tip>}
          </Link>
        </div>

        <nav className="mt-4 px-3 flex flex-col gap-0.5" aria-label="Main">
          {workspace.map((it) => <span key={it.href} className="contents">{renderItem(it)}</span>)}
          {admin.length > 0 && (
            <>
              {renderItem({ href: admin[0].href, icon: ShieldCheck, label: t('nav.admin'), badge: adminUnread, tone: 'risk' }, { active: onAdmin })}
              {!collapsed && onAdmin && (
                <div className="pl-[26px] flex flex-col gap-0.5 mt-0.5">
                  {admin.map((it) => <span key={it.href} className="contents">{renderItem(it, { sub: true })}</span>)}
                </div>
              )}
            </>
          )}
          <div className="border-t border-line-2 my-2" />
          {account.map((it) => <span key={it.href} className="contents">{renderItem(it)}</span>)}
        </nav>

        <div className="flex-1" />

        {/* Footer: who you are, the bell, the account menu */}
        <div className={cn('relative border-t border-line py-2.5', collapsed ? 'px-2 flex flex-col items-center gap-1' : 'px-3')}>
          {collapsed ? (
            <>
              {!demoMode && <NotificationBell initialNotifications={notifications} collapsed />}
              <button type="button" onClick={() => setShowUserMenu(!showUserMenu)} aria-expanded={showUserMenu} aria-label={userEmail} className="group relative w-8 h-8 rounded-full bg-green-soft text-green-deep grid place-items-center text-[12px] font-bold">
                {(userEmail[0] || 'U').toUpperCase()}
                <Tip>{userEmail}</Tip>
              </button>
            </>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={() => setShowUserMenu(!showUserMenu)} className="flex-1 min-w-0 flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-ground transition-colors text-left" aria-expanded={showUserMenu}>
                <span className="w-7 h-7 rounded-full bg-green-soft text-green-deep grid place-items-center shrink-0 text-[12px] font-bold">{(userEmail[0] || 'U').toUpperCase()}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[12.5px] font-medium text-ink truncate">{userEmail}</span>
                  {isAdmin && !demoMode ? (
                    <span className="block text-[11px] text-ink-3 truncate">{t('nav.admin')}</span>
                  ) : !isUpgraded ? (
                    <span className="block text-[11px] text-ink-3 truncate">{t('nav.freeUsed', { used: Math.min(usageCount, FREE_ANALYSIS_LIMIT), limit: FREE_ANALYSIS_LIMIT })}</span>
                  ) : null}
                </span>
                <ChevronDown className={cn('w-3.5 h-3.5 text-ink-3 transition-transform shrink-0', showUserMenu && 'rotate-180')} />
              </button>
              {!demoMode && <NotificationBell initialNotifications={notifications} up />}
            </div>
          )}
          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowUserMenu(false)} />
              <div className={cn('absolute bottom-full mb-1 bg-surface rounded-[10px] shadow-lg border border-line py-1 z-20', collapsed ? 'left-2 w-52' : 'left-3 right-3')}>
                <Link href={`${linkBase}/settings`} onClick={() => setShowUserMenu(false)} className="flex items-center gap-2 px-3 py-2 text-[13px] text-ink-2 hover:bg-ground no-underline"><Settings className="w-3.5 h-3.5" />{t('nav.settings')}</Link>
                <div className="border-t border-line-2 my-1" />
                {demoMode ? (
                  <Link href="/login?from=demo" onClick={() => setShowUserMenu(false)} className="flex items-center gap-2 px-3 py-2 text-[13px] font-semibold text-green-deep hover:bg-green-soft no-underline"><User className="w-3.5 h-3.5" />{t('nav.demoSignup')}</Link>
                ) : (
                  <form action="/auth/signout" method="post">
                    <button type="submit" className="flex items-center gap-2 px-3 py-2 text-[13px] text-risk hover:bg-risk-soft w-full text-left"><LogOut className="w-3.5 h-3.5" />{t('nav.signOut')}</button>
                  </form>
                )}
              </div>
            </>
          )}
        </div>
      </aside>

      {/* Phone top bar: the sidebar is hidden, so this is the only place the brand and the bell live on a phone. */}
      <div className="md:hidden flex items-center justify-between h-12 px-4 bg-surface border-b border-line">
        <Link href={demoMode ? '/' : linkBase} className="flex items-center gap-2 no-underline">
          <Image src="/logo-icon.png" alt="TermLift" width={24} height={24} priority />
          <span className="font-display font-bold text-[15px] tracking-[-0.02em] text-ink">Term<span className="text-green">Lift</span></span>
        </Link>
        {!demoMode && <NotificationBell initialNotifications={notifications} align="right" />}
      </div>

      {/* Mobile admin sheet — the admin pages have no other entry point on a phone */}
      {showAdminSheet && isAdmin && !demoMode && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setShowAdminSheet(false)}>
          <div className="absolute inset-0 bg-ink/30" />
          <div className="absolute left-3 right-3 bottom-[72px] bg-surface rounded-[14px] border border-line shadow-lg py-1.5" onClick={(e) => e.stopPropagation()}>
            <p className="tl-label text-ink-3 px-4 pt-2 pb-1">{t('nav.admin')}</p>
            {admin.map((it) => (
              <Link key={it.href} href={it.href} onClick={() => setShowAdminSheet(false)} className={cn('flex items-center gap-2.5 px-4 py-2.5 text-[14px] font-medium no-underline', isActive(it.href) ? 'text-green-deep' : 'text-ink')}>
                <it.icon className={cn('w-4 h-4', isActive(it.href) ? 'text-green-deep' : 'text-ink-3')} />
                <span className="flex-1">{it.label}</span>
                {(it.badge ?? 0) > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-risk text-white text-[10px] font-bold grid place-items-center tl-num">{it.badge}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Mobile bottom bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-line z-40 flex items-center justify-around px-1 py-1 pb-[max(4px,env(safe-area-inset-bottom))]" aria-label="Main">
        {[workspace[0], ...(demoMode ? [] : [workspace[1]])].filter(Boolean).map((it) => {
          const active = isActive(it.href)
          return (
            <Link key={it.href} href={it.href} className={cn('relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-[10.5px] font-semibold no-underline', active ? 'text-green-deep' : 'text-ink-3')}>
              <it.icon className="w-5 h-5" />{it.label}
              {(it.badge ?? 0) > 0 && <span className="absolute top-0.5 right-1.5 w-2 h-2 rounded-full bg-warn" />}
            </Link>
          )
        })}
        <Link href={demoMode ? '/login?from=demo' : `${linkBase}/new`} className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-[10.5px] font-semibold text-ink-3 no-underline">
          <span className="w-5 h-5 rounded-md bg-green text-white grid place-items-center"><Plus className="w-3.5 h-3.5" /></span>{t('nav.newShort')}
        </Link>
        {isAdmin && !demoMode && (
          <button
            type="button"
            onClick={() => setShowAdminSheet((v) => !v)}
            aria-expanded={showAdminSheet}
            className={cn('relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-[10.5px] font-semibold', pathname.startsWith('/app/admin') || showAdminSheet ? 'text-green-deep' : 'text-ink-3')}
          >
            <ShieldCheck className="w-5 h-5" />{t('nav.adminShort')}
            {adminUnread > 0 && <span className="absolute top-0.5 right-1.5 w-2 h-2 rounded-full bg-risk" />}
          </button>
        )}
        <Link href={demoMode ? '/login?from=demo' : `${linkBase}/settings`} className={cn('flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-[10.5px] font-semibold no-underline', isActive(`${linkBase}/settings`) ? 'text-green-deep' : 'text-ink-3')}>
          <User className="w-5 h-5" />{demoMode ? t('nav.signUpShort') : t('nav.accountShort')}
        </Link>
      </nav>
    </>
  )
}
