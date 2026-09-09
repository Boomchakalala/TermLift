import { cn } from '@/lib/utils'

/** Single source of truth for score → colour. ≥60 green · 40–59 amber · <40 red. */
export function scoreColor(score: number): string {
  if (score >= 60) return 'var(--tl-green)'
  if (score >= 40) return 'var(--tl-warn)'
  return 'var(--tl-risk)'
}

export function scoreTextClass(score: number): string {
  if (score >= 60) return 'text-green-deep'
  if (score >= 40) return 'text-warn'
  return 'text-risk'
}

interface ScoreRingProps {
  score: number
  size?: number
  stroke?: number
  className?: string
  /** Grey ring for deals where the score is no longer the signal (closed without a win). */
  muted?: boolean
  /** Draw the arc from empty on mount (landing hero). Off everywhere in the product. */
  animate?: boolean
}

/**
 * The only score visual in the product. Same ring on landing, /try, the deal
 * page, Home rows and Vendors — the old app mixed a ring, a gradient bar and a
 * mini bar depending on the page.
 */
export function ScoreRing({ score, size = 88, stroke, className, muted, animate }: ScoreRingProps) {
  const s = Math.max(0, Math.min(100, Math.round(score)))
  const sw = stroke ?? Math.max(3, Math.round(size * 0.08))
  const r = (size - sw) / 2
  const c = 2 * Math.PI * r
  const off = c * (1 - s / 100)
  // Just the number. "/100" is implied by the ring and only cluttered it.
  return (
    <span className={cn('relative inline-grid place-items-center shrink-0', className)} style={{ width: size, height: size }} aria-label={`Score ${s} out of 100`} role="img">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--tl-line-2)" strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={muted ? 'var(--tl-ink-3)' : scoreColor(s)} strokeWidth={sw} strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" className={animate ? 'tl-ring-draw' : undefined} style={animate ? ({ '--tl-ring-c': c } as React.CSSProperties) : undefined} />
      </svg>
      <span className="absolute font-display font-extrabold tracking-[-0.03em] leading-none text-ink tl-num" style={{ fontSize: size * 0.36 }}>
        {s}
      </span>
    </span>
  )
}
