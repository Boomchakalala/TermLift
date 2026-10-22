'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { NextAction } from '@/lib/negotiation-flow'

interface Props {
  next: NextAction
  locale: 'en' | 'fr'
  /** The one button. Provided by the workspace so quick-state can run Full Analysis directly. */
  action: ReactNode
  /** Optional second, quieter link (e.g. "Agreement reached? Close the deal"). */
  aside?: ReactNode
  error?: string | null
  className?: string
}

/**
 * The page's answer to "what should I do next": one title, one sentence,
 * one button. Sits right under the stats and mirrors the header action.
 */
export function NextActionCard({ next, locale, action, aside, error, className }: Props) {
  const green = next.key === 'unlock_full' || next.key === 'prepare_round_1' || next.key === 'generate_counter'
  return (
    <div className={cn('rounded-[14px] border px-5 py-4 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-center', green ? 'bg-green-soft border-green-line' : 'bg-surface border-line', className)}>
      <div className="min-w-0">
        <p className="tl-label text-[11.5px] text-green-deep">{locale === 'fr' ? 'Prochaine étape' : 'Next step'}</p>
        <h3 className="font-display text-[16px] font-bold text-ink mt-1 leading-snug">{next.title[locale]}</h3>
        <p className="text-[13.5px] text-ink-2 mt-1 max-w-[64ch] leading-relaxed">{next.body[locale]}</p>
        {error && <p className="text-[12.5px] text-risk mt-1.5">{error}</p>}
        {aside && <div className="mt-2 text-[12.5px]">{aside}</div>}
      </div>
      <div className={cn('flex sm:justify-end [&>a]:w-full sm:[&>a]:w-auto [&>button]:w-full sm:[&>button]:w-auto', green && 'tl-next-action')}>{action}</div>
    </div>
  )
}
