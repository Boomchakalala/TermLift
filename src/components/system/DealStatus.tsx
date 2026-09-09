'use client'

import { useT } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { dealStatusDisplay, type DealStatusInput, type DealStatusKey } from '@/lib/deal-status-display'

/**
 * The deal status block: one tinted badge naming the stage, one optional
 * secondary line naming who or where (Round 2, TermLift handling, Reply
 * needed). Grey → blue → amber → green as the deal moves; lost is muted red.
 * Tint only, no border: the badge is a state, not a control.
 */
const TONE: Record<DealStatusKey, string> = {
  analyzed: 'bg-ground text-ink-2',
  playbook: 'bg-info-soft text-info',
  negotiating: 'bg-warn-soft text-warn',
  won: 'bg-green-soft text-green-deep',
  lost: 'bg-risk-soft text-risk',
  closed: 'bg-ground text-ink-3',
}

interface DealStatusProps extends DealStatusInput {
  /** Right-align badge and secondary line (phone rows, where the block sits top-right). */
  align?: 'start' | 'end'
  /** Fallback secondary line when the status has none (e.g. the desktop hover hint). */
  hint?: React.ReactNode
  /** Extra classes for the secondary line (e.g. hide it on phones). */
  secondaryClassName?: string
  className?: string
}

export function DealStatus({ align = 'start', hint, secondaryClassName, className, ...input }: DealStatusProps) {
  const t = useT()
  const s = dealStatusDisplay(input)
  const secondary = s.secondary
    ? <span className={cn('text-[11.5px] leading-tight truncate', s.secondary.attention ? 'text-warn font-semibold' : 'text-ink-3', secondaryClassName)}>{t(s.secondary.key, s.secondary.values)}</span>
    : hint
      ? <span className={cn('text-[11.5px] leading-tight truncate', secondaryClassName)}>{hint}</span>
      : null
  return (
    <div className={cn('min-w-0 flex flex-col gap-1', align === 'end' ? 'items-end text-right' : 'items-start', className)}>
      <span className={cn('inline-flex items-center gap-1.5 h-[22px] px-2.5 rounded-full text-[11.5px] font-semibold leading-none whitespace-nowrap', TONE[s.key])}>
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70 shrink-0" aria-hidden />
        {t(s.labelKey)}
      </span>
      {secondary}
    </div>
  )
}
