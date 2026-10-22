'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { FlowStep } from '@/lib/negotiation-flow'

interface Props {
  steps: FlowStep[]
  locale: 'en' | 'fr'
  className?: string
}

/**
 * The negotiation as a path: Analysis → Strategy → Round 1 → Round 2 … → Outcome.
 * Done steps get a green check, the current one a soft-green ground, upcoming
 * ones a dashed circle. Narrow screens keep every step (scrollable) but only
 * label the current one, so nothing is hidden and nothing overflows.
 */
export function NegotiationProgress({ steps, locale, className }: Props) {
  const currentIdx = Math.max(0, steps.findIndex((s) => s.state === 'current'))
  return (
    <div className={cn('flex items-center gap-0 bg-surface border border-line rounded-xl p-1 overflow-x-auto', className)} role="list" aria-label={locale === 'fr' ? 'Étapes de la négociation' : 'Negotiation steps'}>
      {steps.map((s, i) => {
        // The track between two steps is green once the step before it is done.
        const track = i > 0 && <span aria-hidden className={cn('h-[2px] rounded-full shrink-0 w-3 sm:w-5', i <= currentIdx ? 'bg-green' : 'bg-line')} />
        const label = s.label[locale]
        const inner = (
          <>
            <span
              className={cn(
                'w-5 h-5 rounded-full grid place-items-center tl-label text-[10px] shrink-0 border-[1.5px]',
                s.state === 'done' && 'bg-green border-green text-white',
                s.state === 'current' && 'border-green text-green-deep bg-surface shadow-[0_0_0_3px_var(--tl-green-soft)]',
                s.state === 'next' && 'border-dashed border-line text-ink-3 bg-surface',
              )}
              aria-hidden
            >
              {s.state === 'done' ? '✓' : i + 1}
            </span>
            <span className={cn('truncate', s.state !== 'current' && 'hidden sm:inline')}>{label}</span>
          </>
        )
        const cls = cn(
          'flex items-center justify-center gap-2 rounded-lg text-[12.5px] font-semibold whitespace-nowrap min-w-0 px-2.5 py-1.5 shrink-0',
          s.state === 'current' ? 'bg-green-soft text-green-deep flex-[2] sm:flex-1' : 'flex-none sm:flex-1',
          s.state === 'done' && 'text-ink-2',
          s.state === 'next' && 'text-ink-3',
        )
        return (
          <Fragment key={s.key}>
            {track}
            {s.href ? (
              <Link href={s.href} className={cls} role="listitem" aria-current={s.state === 'current' ? 'step' : undefined} title={label}>{inner}</Link>
            ) : (
              <div className={cls} role="listitem" aria-current={s.state === 'current' ? 'step' : undefined} title={label}>{inner}</div>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}
