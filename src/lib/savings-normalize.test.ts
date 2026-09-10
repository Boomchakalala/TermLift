import { describe, it, expect } from 'vitest'
import { normalizeSavings, quantifiedMustHaveTotal, isConditionalAsk, headlinePct } from './savings-normalize'

// The stored KnowBe4 Playbook savings (round b1781f07…).
const fixture = {
  total: 2889,
  currency: 'USD',
  must_have: [
    { ask: '5% discount on total contract value for 24-month commitment', amount: 1817, rationale: 'KnowBe4 benefits from two years of locked revenue.' },
    { ask: 'Match Compliance Plus discount to KSAT rate of 38.1%, reducing unit price from $13.53 to approximately $12.10', amount: 1073, rationale: 'The buyer cannot source Compliance Plus elsewhere.' },
  ],
  nice_to_have: [
    { ask: 'Right-size seat count if headcount is below 750', amount: 1206, rationale: 'Every 50 excess seats costs approximately $1,206 over the term. Verify headcount before signing.' },
  ],
}

describe('normalizeSavings (KnowBe4 fixture)', () => {
  it('recomputes the headline % on the total net of the line-specific ask and drops the conditional seat ask', () => {
    const r = normalizeSavings(fixture, 36330)!
    // 5% × (36,330 − 1,073) = 1,762.85 → 1,763
    expect(r.must_have[0].amount).toBe(1763)
    expect(r.must_have[0].recomputed_from).toEqual({ pct: 5, base: 35257, original: 1817 })
    expect(r.must_have[1].amount).toBe(1073)
    expect(r.total).toBe(2836)
    expect(r.nice_to_have[0].amount).toBeNull()
    expect(r.nice_to_have[0].quantified).toBe(false)
    expect(quantifiedMustHaveTotal(r)).toBe(2836)
  })

  it('leaves unconditional, non-headline asks untouched', () => {
    const r = normalizeSavings({ must_have: [{ ask: 'Remove the €500 onboarding fee', amount: 500 }] }, 10000)!
    expect(r.must_have[0].amount).toBe(500)
    expect(r.must_have[0].recomputed_from).toBeUndefined()
    expect(r.total).toBe(500)
  })

  it('detects conditional asks and headline percentages', () => {
    expect(isConditionalAsk('Right-size seat count if headcount is below 750')).toBe(true)
    expect(isConditionalAsk('Cap renewal escalation at 4%')).toBe(false)
    expect(headlinePct('5% discount on total contract value')).toBe(5)
    expect(headlinePct('Match Compliance Plus discount to KSAT rate of 38.1%')).toBeNull()
  })

  it('never sums two percentage discounts onto the same quoted total', () => {
    const r = normalizeSavings({ must_have: [
      { ask: '5% multi-year discount on total contract value', amount: 1817 },
      { ask: '3% loyalty discount on the total contract value', amount: 1090 },
      { ask: 'Remove the $500 onboarding fee', amount: 500 },
    ] }, 36330)!
    expect(r.must_have[0].quantified).toBe(true)
    expect(r.must_have[1].quantified).toBe(false)
    expect(r.must_have[1].amount).toBeNull()
    expect(r.must_have[1].dropped_reason).toBe('stacked_percentage')
    // 5% on the total net of the $500 line ask
    expect(r.must_have[0].amount).toBe(Math.round((36330 - 500) * 0.05))
    expect(r.total).toBe(Math.round((36330 - 500) * 0.05) + 500)
  })

  it('recomputes a period error against the printed line (Datadog: annual $13,365 Log Events read as monthly ×12)', () => {
    const lines = [
      { description: 'Infra Host (Pro)', line_total: 990 },
      { description: 'APM Host', line_total: 1227.6 },
      { description: 'Log Events (30 Day Retention Period)', line_total: 13365 },
    ]
    const r = normalizeSavings({ must_have: [{ ask: '15% discount on Log Events rate (from $2.475/M to $2.10/M)', amount: 20250, rationale: 'Saves $1,687.50/month x 12 months.' }] }, 16328, lines)!
    expect(r.must_have[0].amount).toBe(2005) // 15% × 13,365
    expect(r.must_have[0].recomputed_from).toEqual({ pct: 15, base: 13365, original: 20250 })
    expect(r.total).toBe(2005)
    expect(quantifiedMustHaveTotal(r)).toBe(2005)
  })

  it('unquantifies an impossible amount it cannot recompute, and never lets the total reach the quote', () => {
    const r = normalizeSavings({ must_have: [{ ask: 'Remove the platform fee', amount: 20000 }, { ask: 'Waive onboarding', amount: 9000 }, { ask: 'Waive support', amount: 9000 }] }, 16328, [])!
    expect(r.must_have[0].quantified).toBe(false)
    expect(r.must_have[0].dropped_reason).toBe('exceeds_quote')
    expect(r.total).toBeLessThan(16328)
    expect(r.total).toBe(9000)
  })

  it('removes a concession whose date is already behind the analysis date', () => {
    const r = normalizeSavings({ must_have: [{ ask: 'Remove the $500 onboarding fee', amount: 500 }], nice_to_have: [{ ask: 'Early signature discount — sign by 2/15/2026 in exchange for an additional 3% off', amount: 490 }] }, 16328, [], '2026-09-10')!
    expect(r.nice_to_have).toEqual([])
    expect(r.must_have.length).toBe(1)
  })

  it('returns null for a shape it does not understand', () => {
    expect(normalizeSavings(null, 100)).toBeNull()
    expect(normalizeSavings([], 100)).toBeNull()
  })
})
