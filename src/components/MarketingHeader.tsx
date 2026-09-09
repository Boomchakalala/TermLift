'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import { useT } from '@/i18n/context'
import { Btn } from '@/components/system'

/** Icon + wordmark. `tone="white"` for dark panels (login aside). */
export function Logo({ size = 28, className = '', tone = 'ink' }: { size?: number; className?: string; tone?: 'ink' | 'white' }) {
  return (
    <Link href="/" className={`flex items-center gap-2 no-underline shrink-0 ${className}`}>
      <Image src="/logo-icon.png" alt="TermLift" width={size} height={size} priority />
      <span className={`font-display font-bold text-[17px] tracking-[-0.02em] ${tone === 'white' ? 'text-white' : 'text-ink'}`}>
        Term<span className="text-green">Lift</span>
      </span>
    </Link>
  )
}

export function MarketingHeader() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  const links = [
    { href: '/#how', label: t('nav.howItWorks') },
    { href: '/pricing', label: t('nav.pricing') },
    { href: '/demo', label: t('nav.examples') },
  ]
  const linkCls = 'text-[13.5px] font-medium text-ink-2 hover:text-ink no-underline transition-colors'

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-line">
      <div className="max-w-[1120px] mx-auto flex items-center gap-7 px-5 sm:px-7 h-14">
        <Logo />
        <nav className="hidden md:flex items-center gap-6 ml-auto">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={linkCls}>{l.label}</Link>
          ))}
          <Link href="/login" className={linkCls}>{t('nav.signIn')}</Link>
          <Btn href="/try" variant="primary" size="sm">{t('nav.tryFree')}</Btn>
        </nav>
        <button
          onClick={() => setOpen(!open)}
          className="md:hidden ml-auto p-2 -mr-2 text-ink-2 hover:text-ink rounded-lg hover:bg-ground transition-colors"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Phone menu floats over the page instead of pushing it down: the header keeps its height. */}
      {/* Absolute, not fixed: backdrop-blur on the header makes it the containing block for fixed children. */}
      {open && <div className="md:hidden absolute left-0 right-0 top-full h-screen z-40 bg-ink/20" onClick={close} aria-hidden />}
      {open && (
        <div className="md:hidden absolute left-0 right-0 top-full z-50 border-t border-b border-line bg-white px-5 py-3 pb-4 flex flex-col gap-0.5 shadow-[0_24px_48px_-24px_rgba(16,26,23,0.35)]">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={close} className="py-2.5 px-2 text-[14px] font-medium text-ink-2 hover:text-ink rounded-lg no-underline">{l.label}</Link>
          ))}
          <Link href="/login" onClick={close} className="py-2.5 px-2 text-[14px] font-medium text-ink-2 hover:text-ink rounded-lg no-underline">{t('nav.signIn')}</Link>
          <Btn href="/try" variant="primary" size="lg" block className="mt-2">{t('nav.tryFree')}</Btn>
        </div>
      )}
    </header>
  )
}
