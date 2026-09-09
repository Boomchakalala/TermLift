import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The phone's back control: one tappable "‹ Parent" link. The desktop
 * breadcrumb trail is too small to be a target and the bottom tab bar only
 * reaches top-level pages, so every sub-page shows this above its title.
 */
export function BackLink({ href, label, className }: { href: string; label: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn('inline-flex items-center gap-0.5 h-8 -ml-2 pl-1 pr-2.5 rounded-lg text-[13.5px] font-semibold text-ink-2 hover:text-ink hover:bg-ground active:bg-ground transition-colors no-underline max-w-full', className)}>
      <ChevronLeft className="w-4 h-4 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  )
}

export interface Crumb {
  label: string
  href?: string
}

interface PageHeaderProps {
  title: ReactNode
  sub?: ReactNode
  crumbs?: Crumb[]
  actions?: ReactNode
  /** Stats row, tabs, filters — anything that belongs in the white header band. */
  children?: ReactNode
  className?: string
}

/**
 * Every app page starts with this white band: optional breadcrumb, title,
 * one-line sub, actions on the right, then whatever belongs above the fold
 * (stat tiles, tabs). Content below sits on the ground colour.
 */
export function PageHeader({ title, sub, crumbs, actions, children, className }: PageHeaderProps) {
  // On a phone the trail collapses to one back link: the nearest crumb that links somewhere.
  const parent = crumbs ? [...crumbs.slice(0, -1)].reverse().find((c) => c.href) : undefined
  return (
    <div className={cn('bg-surface border-b border-line px-4 sm:px-6 py-4', className)}>
      {parent?.href && <BackLink href={parent.href} label={parent.label} className="md:hidden mb-1.5" />}
      {crumbs && crumbs.length > 0 && (
        <nav className="hidden md:flex items-center gap-1.5 text-[12.5px] text-ink-3 mb-2 min-w-0" aria-label="Breadcrumb">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1
            return (
              <span key={i} className="flex items-center gap-1.5 min-w-0">
                {c.href && !last ? (
                  <Link href={c.href} className="hover:text-ink-2 transition-colors truncate">{c.label}</Link>
                ) : (
                  <span className={cn('truncate', last && 'text-ink font-semibold')}>{c.label}</span>
                )}
                {!last && <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
              </span>
            )
          })}
        </nav>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[21px] font-bold text-ink tracking-[-0.02em] leading-tight">{title}</h1>
          {sub && <p className="text-[13px] text-ink-2 mt-0.5">{sub}</p>}
        </div>
        {actions && <div className="flex gap-2 ml-auto w-full sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

/**
 * Full-bleed wrapper for redesigned app pages: escapes the app layout's legacy
 * padding so PageHeader can run edge to edge. Remove (with the layout padding)
 * once every page under /app uses it.
 */
export function AppPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('-mx-5 sm:-mx-8 -mt-8 -mb-24 md:-mb-8 min-h-screen flex flex-col bg-ground', className)}>{children}</div>
}

/** Page body: ground colour, consistent gutters and vertical rhythm. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-4 sm:px-6 py-4 pb-24 md:pb-12 flex flex-col gap-3.5 bg-ground min-h-full', className)}>{children}</div>
}
