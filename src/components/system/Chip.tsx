import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type ChipTone = 'neutral' | 'green' | 'warn' | 'risk' | 'info' | 'ink'

const tones: Record<ChipTone, string> = {
  neutral: 'bg-surface border-line text-ink-2',
  green: 'bg-green-soft border-green-line text-green-deep',
  warn: 'bg-warn-soft border-warn-line text-warn',
  risk: 'bg-risk-soft border-risk-line text-risk',
  info: 'bg-info-soft border-info-line text-info',
  ink: 'bg-ink border-ink text-white',
}

/**
 * Chip — severity, category, mode. Tone carries the meaning:
 * green = money/won, info = ready/you're acting, warn = in motion or waiting on you,
 * risk = high-severity flag, ink = admin/system. Deal stage is DealStatus, not Chip.
 */
export function Chip({ tone = 'neutral', children, className, mono }: { tone?: ChipTone; children: ReactNode; className?: string; mono?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 h-[22px] px-2 rounded-md border text-[11.5px] font-semibold whitespace-nowrap',
        mono && 'tl-label text-[10px]',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
