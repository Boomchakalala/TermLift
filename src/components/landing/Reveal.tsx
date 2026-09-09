'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Runs `cb` once, the first time the element enters the viewport. */
function useOnceInView<T extends Element>(cb: () => void) {
  const ref = useRef<T | null>(null)
  const done = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el || done.current) return
    if (!('IntersectionObserver' in window)) { done.current = true; cb(); return }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !done.current) { done.current = true; io.disconnect(); cb() }
    }, { threshold: 0.4 })
    io.observe(el)
    return () => io.disconnect()
  }, [cb])
  return ref
}

/**
 * A money figure that counts up from zero the first time it scrolls into view.
 * Keeps the string's own formatting (symbol, thousands separator, decimals).
 */
export function CountUp({ value, className, duration = 700 }: { value: string; className?: string; duration?: number }) {
  const [shown, setShown] = useState(value)
  const [armed, setArmed] = useState(false)
  const ref = useOnceInView<HTMLSpanElement>(() => setArmed(true))
  useEffect(() => {
    if (!armed || prefersReducedMotion()) return
    const m = value.match(/^([^\d]*)([\d.,\s]+)(.*)$/)
    if (!m) return
    const [, prefix, num, suffix] = m
    const target = parseFloat(num.replace(/[^\d.]/g, ''))
    if (!Number.isFinite(target)) return
    const sep = num.includes(',') ? ',' : num.includes(' ') ? ' ' : ''
    const fmt = (n: number) => (sep ? Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, sep) : Math.round(n).toString())
    // All state updates happen inside animation frames, never synchronously in the effect.
    let start = 0
    let raf = 0
    const tick = (now: number) => {
      if (!start) start = now
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(p < 1 ? `${prefix}${fmt(target * eased)}${suffix}` : value)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [armed, value, duration])
  return <span ref={ref} className={cn('tl-num', className)}>{shown}</span>
}

/** A thin bar that fills to `pct` the first time it scrolls into view. */
export function FillBar({ pct, className }: { pct: number; className?: string }) {
  const [on, setOn] = useState(false)
  const ref = useOnceInView<HTMLSpanElement>(() => setOn(true))
  const width = Math.max(0, Math.min(100, pct))
  return (
    <span ref={ref} className={cn('block h-1.5 rounded-full bg-line-2 overflow-hidden', className)} aria-hidden>
      <span className="block h-full rounded-full bg-green transition-[width] duration-[900ms] ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none" style={{ width: on ? `${width}%` : prefersReducedMotion() ? `${width}%` : '0%' }} />
    </span>
  )
}
