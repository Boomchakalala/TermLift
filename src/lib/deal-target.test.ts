import { describe, it, expect } from 'vitest'
import { computeDealTarget } from './deal-target'

describe('computeDealTarget', () => {
  it('is the quote minus the quantified must-have asks, rounded for the anchor (KnowBe4 after normalisation)', () => {
    const t = computeDealTarget({
      snapshot: { total_commitment: '$36,330' },
      potential_savings: { must_have: [{ ask: '5% discount', amount: 1763, quantified: true }, { ask: 'Compliance Plus parity', amount: 1073, quantified: true }], nice_to_have: [{ ask: 'Right-size if headcount', amount: null, quantified: false }] },
      market_benchmark: { benchmark_available: false },
      benchmark_interpretation: { target_price: null },
    })!
    expect(t.source).toBe('asks')
    expect(t.savings).toBe(2836)
    expect(t.target).toBe(33494)
    expect(t.anchor).toBe(33500)
  })

  it('prefers a published benchmark target', () => {
    const t = computeDealTarget({ snapshot: { total_commitment: '€10,000' }, potential_savings: { must_have: [{ ask: 'x', amount: 500 }] }, market_benchmark: { benchmark_available: true }, benchmark_interpretation: { target_price: 8800 } })!
    expect(t.source).toBe('benchmark')
    expect(t.target).toBe(8800)
    expect(t.anchor).toBe(8800)
  })

  it('returns null without a total or without quantified savings', () => {
    expect(computeDealTarget({ snapshot: { total_commitment: '' }, potential_savings: { must_have: [{ ask: 'x', amount: 5 }] } })).toBeNull()
    expect(computeDealTarget({ snapshot: { total_commitment: '$100' }, potential_savings: { must_have: [{ ask: 'if headcount', amount: null, quantified: false }] } })).toBeNull()
  })
})
