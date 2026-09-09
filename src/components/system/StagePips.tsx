'use client'

import { useT } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { STAGE_ORDER, stageChipKey, stageIndex, type DealStage, type NegotiationMode } from '@/lib/deal-stage'

interface StagePipsProps {
  stage: DealStage
  mode?: NegotiationMode
  won?: boolean
  closed?: boolean
  /** TermLift negotiation is waiting on the user — label turns amber. */
  waitingOnClient?: boolean
  /** Self-run negotiation round number, appended to the label when > 1. */
  round?: number
  /** Second line under the label (e.g. "Reply needed", "Unlock Deep Analysis"). */
  hint?: React.ReactNode
  /** Extra classes for the hint line (e.g. hide it on phones where the row has no room). */
  hintClassName?: string
  className?: string
}

/**
 * The ladder at table-row size: four pips and the stage name. Done pips are
 * green, the current pip is green, future pips are hairlines. A won deal
 * fills all four; a deal closed without change greys them out.
 */
export function StagePips({ stage, mode = null, won, closed, waitingOnClient, round, hint, hintClassName, className }: StagePipsProps) {
  const t = useT()
  const idx = closed ? STAGE_ORDER.length - 1 : stageIndex(stage)
  const grey = closed && !won
  const label = won ? t('dealList.won') : closed ? t('dealList.noChange') : t(stageChipKey(stage, mode))
  const labelCls = grey ? 'text-ink-3' : waitingOnClient ? 'text-warn' : won ? 'text-green-deep' : 'text-ink'
  return (
    <div className={cn('min-w-0 flex flex-col gap-1', className)}>
      <div className="flex items-center gap-1" aria-hidden>
        {STAGE_ORDER.map((s, i) => (
          <span
            key={s}
            className={cn(
              'h-1.5 w-4 rounded-full',
              grey ? 'bg-line' : i <= idx ? (waitingOnClient && i === idx ? 'bg-warn' : 'bg-green') : 'bg-line-2',
            )}
          />
        ))}
      </div>
      <span className={cn('text-[12.5px] font-semibold leading-tight truncate', labelCls)}>
        {label}{stage === 'negotiate' && mode === 'self' && !closed && round && round > 1 ? ` · R${round}` : ''}
      </span>
      {hint && <span className={cn('text-[11.5px] leading-tight truncate', hintClassName)}>{hint}</span>}
    </div>
  )
}
