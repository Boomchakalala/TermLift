'use client'

import Link from 'next/link'
import { useT } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { STAGE_ORDER, STAGE_LABEL_KEY, stageIndex, type DealStage } from '@/lib/deal-stage'

interface StageRailProps {
  current: DealStage
  /** Optional per-stage anchor/href — makes the rail double as in-page navigation. */
  hrefs?: Partial<Record<DealStage, string>>
  /** Tighter padding, hides labels for future stages — for embeds and mobile. */
  compact?: boolean
  /** Numbers only except the current stage — for very narrow embeds (hero screenshot). */
  minimal?: boolean
  /** Stages that were bypassed (e.g. a deal won without TermLift negotiating) — drawn neutral, no check. */
  skipped?: DealStage[]
  className?: string
}

/**
 * The ladder. Done stages get a green check, the current one a soft-green
 * ground, future ones a dashed circle. Same component on landing, pricing,
 * /try result, and the deal page header.
 */
export function StageRail({ current, hrefs, compact, minimal, skipped = [], className }: StageRailProps) {
  const t = useT()
  const idx = stageIndex(current)
  return (
    <div className={cn('@container flex items-center gap-0 bg-surface border border-line rounded-xl overflow-hidden', compact ? 'p-1' : 'p-1.5', className)} role="list" aria-label="Deal stages">
      {STAGE_ORDER.map((stage, i) => {
        const state: 'done' | 'now' | 'next' | 'skipped' = i === idx ? 'now' : skipped.includes(stage) ? 'skipped' : i < idx ? 'done' : 'next'
        const label = t(STAGE_LABEL_KEY[stage])
        const inner = (
          <>
            <span
              className={cn(
                'w-5 h-5 rounded-full grid place-items-center tl-label text-[10px] shrink-0 border-[1.5px]',
                state === 'done' && 'bg-green border-green text-white',
                state === 'now' && 'border-green text-green-deep bg-surface',
                state === 'next' && 'border-dashed border-line text-ink-3 bg-surface',
                state === 'skipped' && 'border-line text-ink-3 bg-line-2',
              )}
              aria-hidden
            >
              {state === 'done' ? '✓' : state === 'skipped' ? '–' : i + 1}
            </span>
            {/* Labels give way by importance as the rail narrows: current always shows,
                done steps need ~600px of rail, future steps ~820px. Numbers stay. */}
            <span
              className={cn(
                'truncate',
                (state === 'done' || state === 'skipped') && 'hidden @[600px]:inline',
                state === 'next' && 'hidden @[820px]:inline',
                minimal && state !== 'now' && '!hidden',
              )}
            >
              {label}
            </span>
          </>
        )
        const cls = cn(
          'flex items-center justify-center gap-2 rounded-lg text-[12.5px] font-semibold whitespace-nowrap min-w-0',
          // Below 600px only the current label is visible: the other steps shrink to their circle so
          // the current label never truncates on a phone.
          minimal ? (state === 'now' ? 'flex-1' : 'flex-none') : state === 'now' ? 'flex-1' : 'flex-none @[600px]:flex-1',
          compact ? 'px-2 py-1.5' : state === 'now' ? 'px-3 py-2' : 'px-1.5 py-2 @[600px]:px-3',
          state === 'done' && 'text-ink-2',
          state === 'now' && 'bg-green-soft text-green-deep',
          (state === 'next' || state === 'skipped') && 'text-ink-3',
          state === 'skipped' && 'line-through decoration-line',
        )
        const href = hrefs?.[stage]
        return href ? (
          <Link key={stage} href={href} className={cls} role="listitem" aria-current={state === 'now' ? 'step' : undefined}>
            {inner}
          </Link>
        ) : (
          <div key={stage} className={cls} role="listitem" aria-current={state === 'now' ? 'step' : undefined}>
            {inner}
          </div>
        )
      })}
    </div>
  )
}
