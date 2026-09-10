import { parseMoney } from '@/lib/currency'
import { quantifiedMustHaveTotal } from '@/lib/savings-normalize'

/**
 * The one target price for a deal (2026-09-11).
 *
 *   target_price = clamped benchmark target, when the engine published a range
 *                = quote total − sum of quantified must-have savings, otherwise
 *
 * It is computed once at assembly (fast pass, then again when the Playbook
 * rescores) and STORED on the round as `target_price`; every reader (header
 * tile, playbook, must-have total, email) uses that stored number. No rounding:
 * the must-have total is exactly quote − target_price, and the email states
 * the target exactly as stored. The model's own `target_price_range` is kept
 * as an estimate and drives nothing.
 */
export interface DealTarget {
  /** The stored figure. */
  target: number
  /** Same as `target` — kept so existing readers keep working. */
  anchor: number
  source: 'benchmark' | 'asks' | 'stored'
  total: number
  savings: number
}

type OutputLike = {
  snapshot?: { total_commitment?: unknown } | null
  potential_savings?: unknown
  market_benchmark?: { benchmark_available?: boolean } | null
  benchmark_interpretation?: { target_price?: number | null } | null
  target_price?: number | null
  target_price_source?: 'benchmark' | 'asks' | null
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

/**
 * Snap a target once, before it is stored: nearest $500 on quotes of $10,000
 * or more, nearest $50 under that. 33,848 on a $36,330 quote → 34,000.
 */
export function snapTarget(target: number, total: number): number {
  if (!(target > 0)) return target
  const step = total >= 10_000 ? 500 : 50
  return Math.round(target / step) * step
}

/** Derive the target from the facts (benchmark target, else quote − quantified must-haves), snapped. Null when nothing supports one. */
export function deriveDealTarget(output: OutputLike | null | undefined, totalOverride?: number): DealTarget | null {
  if (!output) return null
  const total = totalOverride ?? parseMoney(String(output.snapshot?.total_commitment || '')).amount
  if (!(total > 0)) return null
  const bench = output.market_benchmark
  const interp = output.benchmark_interpretation
  if (bench?.benchmark_available && interp?.target_price != null && interp.target_price > 0 && interp.target_price < total) {
    const t = snapTarget(interp.target_price, total)
    return { target: t, anchor: t, source: 'benchmark', total, savings: round2(total - t) }
  }
  const savings = quantifiedMustHaveTotal(output.potential_savings)
  if (!(savings > 0)) return null
  const t = snapTarget(Math.max(0, total - savings), total)
  if (!(t > 0) || t >= total) return null
  return { target: t, anchor: t, source: 'asks', total, savings: round2(total - t) }
}

/** The stored target when the round carries one, else derived from the facts. */
export function computeDealTarget(output: OutputLike | null | undefined, totalOverride?: number): DealTarget | null {
  if (!output) return null
  if (typeof output.target_price === 'number' && Number.isFinite(output.target_price) && output.target_price > 0) {
    const total = totalOverride ?? parseMoney(String(output.snapshot?.total_commitment || '')).amount
    // Snapping is idempotent, so a round stored before the snap rule reads the same as one stored after it.
    const t = total > 0 ? snapTarget(output.target_price, total) : round2(output.target_price)
    return { target: t, anchor: t, source: 'stored', total, savings: total > 0 ? round2(total - t) : 0 }
  }
  return deriveDealTarget(output, totalOverride)
}

/** Compute and write `target_price` / `target_price_source` onto an output at assembly time. */
export function attachTargetPrice<T extends OutputLike>(output: T, totalOverride?: number): T & { target_price: number | null; target_price_source: 'benchmark' | 'asks' | null } {
  const t = deriveDealTarget(output, totalOverride)
  return { ...output, target_price: t ? t.target : null, target_price_source: t ? (t.source === 'stored' ? 'asks' : t.source) : null }
}
