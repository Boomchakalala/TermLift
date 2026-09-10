import { describe, it, expect } from 'vitest'
import { computeDealTarget, deriveDealTarget, attachTargetPrice, snapTarget } from './deal-target'

describe('deal target (single stored, snapped target_price)', () => {
  const output = {
    snapshot: { total_commitment: '$36,330' },
    potential_savings: { must_have: [{ ask: '5% discount', amount: 1763, quantified: true }, { ask: 'Compliance Plus parity', amount: 1073, quantified: true }], nice_to_have: [{ ask: 'Right-size if headcount', amount: null, quantified: false }] },
    market_benchmark: { benchmark_available: false },
    benchmark_interpretation: { target_price: null },
  }

  it('snaps to the nearest $500 at or above a $10,000 quote and $50 below it', () => {
    expect(snapTarget(33848, 36330)).toBe(34000)
    expect(snapTarget(33494, 36330)).toBe(33500)
    expect(snapTarget(34249, 36330)).toBe(34000)
    expect(snapTarget(8726, 9500)).toBe(8750)
    expect(snapTarget(8724, 9500)).toBe(8700)
  })

  it('derives quote minus the quantified must-have asks, then snaps once', () => {
    const t = deriveDealTarget(output)!
    expect(t.source).toBe('asks')
    expect(t.target).toBe(33500) // 36,330 − 2,836 = 33,494 → 33,500
    expect(t.anchor).toBe(33500)
    expect(t.savings).toBe(2830) // quote − snapped target, not the item sum
  })

  it('stores the snapped figure and every later reader uses it', () => {
    const stored = attachTargetPrice(output)
    expect(stored.target_price).toBe(33500)
    expect(stored.target_price_source).toBe('asks')
    const t = computeDealTarget({ ...stored, potential_savings: { must_have: [] } })!
    expect(t.source).toBe('stored')
    expect(t.target).toBe(33500)
    expect(t.savings).toBe(2830)
  })

  it('snaps a benchmark target too', () => {
    const t = deriveDealTarget({ snapshot: { total_commitment: '€12,000' }, potential_savings: { must_have: [{ ask: 'x', amount: 500 }] }, market_benchmark: { benchmark_available: true }, benchmark_interpretation: { target_price: 10730 } })!
    expect(t.source).toBe('benchmark')
    expect(t.target).toBe(10500)
  })

  it('returns null without a total, without quantified savings, or when snapping lands on the quote', () => {
    expect(deriveDealTarget({ snapshot: { total_commitment: '' }, potential_savings: { must_have: [{ ask: 'x', amount: 5 }] } })).toBeNull()
    expect(attachTargetPrice({ snapshot: { total_commitment: '$100' }, potential_savings: { must_have: [{ ask: 'if headcount', amount: null, quantified: false }] } }).target_price).toBeNull()
    expect(deriveDealTarget({ snapshot: { total_commitment: '$36,330' }, potential_savings: { must_have: [{ ask: 'tiny', amount: 40 }] } })).toBeNull() // 36,290 → 36,500 ≥ quote
  })
})
