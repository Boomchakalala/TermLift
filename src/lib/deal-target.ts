import { parseMoney } from '@/lib/currency'
import { quantifiedMustHaveTotal } from '@/lib/savings-normalize'
import { roundAnchor } from '@/lib/deal-metrics'

/**
 * The one target price for a deal, computed in code (2026-09-11).
 *
 *   target = clamped benchmark target, when the engine published a range
 *          = quote total − sum of quantified must-have savings, otherwise
 *
 * `anchor` is the same figure rounded the way a person says it (nearest 100
 * under 20k, 500 under 200k, 1,000 above) — the number the hero tile shows
 * and the email states, so the two can never disagree. The model's own
 * `target_price_range` is kept on the output as an estimate but never drives
 * a tile or a draft.
 */
export interface DealTarget {
  /** Exact figure. */
  target: number
  /** Rounded figure for display and for the email anchor. */
  anchor: number
  source: 'benchmark' | 'asks'
  total: number
  savings: number
}

type OutputLike = {
  snapshot?: { total_commitment?: unknown } | null
  potential_savings?: unknown
  market_benchmark?: { benchmark_available?: boolean } | null
  benchmark_interpretation?: { target_price?: number | null } | null
}

export function computeDealTarget(output: OutputLike | null | undefined, totalOverride?: number): DealTarget | null {
  if (!output) return null
  const total = totalOverride ?? parseMoney(String(output.snapshot?.total_commitment || '')).amount
  if (!(total > 0)) return null
  const bench = output.market_benchmark
  const interp = output.benchmark_interpretation
  if (bench?.benchmark_available && interp?.target_price != null && interp.target_price > 0 && interp.target_price < total) {
    const t = interp.target_price
    return { target: t, anchor: roundAnchor(t), source: 'benchmark', total, savings: Math.round((total - t) * 100) / 100 }
  }
  const savings = quantifiedMustHaveTotal(output.potential_savings)
  if (!(savings > 0)) return null
  const t = Math.max(0, total - savings)
  return { target: Math.round(t * 100) / 100, anchor: roundAnchor(t), source: 'asks', total, savings }
}
