import { describe, it, expect } from 'vitest'
import { computeScores, mergeExtractions, isExpired, toIsoDate, seedFromFacts, normalizeExtraction, countHighTermsFlags, type ExtractionResult } from './scoring'

function base(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    contractTotal: 36330,
    pricingItemized: true,
    fees: [],
    cancellationTerms: { refundSchedule: null, buyerInsideWindow: false, retentionPctInsideWindow: null, forceMajeurePresent: true, rescheduleOption: false, rescheduleFeePct: null },
    paymentTerms: { depositPct: 0, balanceDueDaysBeforeDelivery: 0, achOffered: false, netTerms: 30 },
    vendorRights: { unilateralSubstitution: false, mandatoryMarketing: false, reciprocalValue: true },
    tbdLineItems: [],
    leverageFactors: { competingQuoteInHand: false, daysToDeadline: null, soleSource: false, dealSizeSignificant: false, buyerInsidePenaltyWindow: false },
    ...overrides,
  }
}

// The KnowBe4 fixture as the fast pass extracted it, plus the renewal fields the
// extraction call now reads: auto-renew, 90-day notice, "minimum 4%" with no cap,
// vendor may increase further; quote expired 2026-01-31, analysed 2026-09-10.
const knowBe4 = base({
  cancellationTerms: { refundSchedule: 'auto-renews unless 90-day written notice', buyerInsideWindow: false, retentionPctInsideWindow: null, forceMajeurePresent: false, rescheduleOption: false, rescheduleFeePct: null },
  vendorRights: { unilateralSubstitution: false, mandatoryMarketing: false, reciprocalValue: false },
  leverageFactors: { competingQuoteInHand: false, daysToDeadline: 79, soleSource: false, dealSizeSignificant: true, buyerInsidePenaltyWindow: false },
  renewalTerms: { autoRenew: true, noticeDays: 90, escalationMinPct: 4, escalationCapPct: null, extraIncreaseAllowed: true },
  quoteDates: { created: '2025-11-13', expires: '2026-01-31', currentSubEnd: '2026-01-11' },
})

describe('computeScores — renewal terms, expiry and flag caps (KnowBe4 fixture)', () => {
  it('reproduces the pre-change score when the new fields are absent', () => {
    const { renewalTerms: _r, quoteDates: _q, ...legacy } = knowBe4
    const r = computeScores(legacy)
    expect(r.pricing).toBe(100)
    expect(r.terms).toBe(90)
    expect(r.leverage).toBe(70)
    expect(r.overall).toBe(89)
  })

  it('deducts for a 90-day notice, an uncapped minimum uplift and a discretionary increase', () => {
    const r = computeScores(knowBe4, { asOf: '2026-09-10' })
    const labels = r.deductions.filter((d) => d.category === 'terms').map((d) => d.label)
    expect(labels).toContain('Auto-renewal with 90-day notice window')
    expect(labels.some((l) => l.startsWith('Renewal uplift of at least 4% with no cap'))).toBe(true)
    expect(labels).toContain('Vendor may raise renewal pricing beyond the stated increase')
    // 100 − 10 (force majeure) − 15 − 20 − 10
    expect(r.terms).toBe(45)
  })

  it('gives an expired quote no deadline leverage either way', () => {
    const r = computeScores(knowBe4, { asOf: '2026-09-10' })
    expect(r.deductions.find((d) => d.label === 'Over 30 days to deadline')).toBeUndefined()
    expect(r.leverage).toBe(60) // 50 + 10 deal size, no deadline bonus
    const live = computeScores(knowBe4, { asOf: '2026-01-10' })
    expect(live.leverage).toBe(70)
  })

  it('lands the fixture in the "Decent quote" band with the terms flags on the page', () => {
    const r = computeScores(knowBe4, { asOf: '2026-09-10', highTermsFlagCount: 2 })
    expect(r.terms).toBeLessThanOrEqual(65)
    expect(r.overall).toBeGreaterThanOrEqual(65)
    expect(r.overall).toBeLessThan(80)
    // 40 + 45×0.35 + 60×0.25 = 40 + 15.75 + 15 = 70.75 → 71
    expect(r.overall).toBe(71)
  })

  it('caps Terms at 75 for one HIGH terms flag and 65 for two, recording the cap as a deduction', () => {
    const clean = base()
    const one = computeScores(clean, { highTermsFlagCount: 1 })
    expect(one.terms).toBe(75)
    expect(one.deductions.find((d) => d.label.includes('cap 75'))?.points).toBe(-25)
    const two = computeScores(clean, { highTermsFlagCount: 2 })
    expect(two.terms).toBe(65)
    expect(two.terms).toBe(100 + two.deductions.filter((d) => d.category === 'terms').reduce((s, d) => s + d.points, 0))
  })

  it('does not apply a cap already below the bar', () => {
    const r = computeScores(knowBe4, { asOf: '2026-09-10', highTermsFlagCount: 2 })
    expect(r.deductions.find((d) => /\(cap \d+\)/.test(d.label))).toBeUndefined()
    expect(r.terms).toBe(45)
  })
})

describe('dates', () => {
  it('parses printed dates to ISO and compares them', () => {
    expect(toIsoDate('January 31, 2026')).toBe('2026-01-31')
    expect(toIsoDate('2026-01-31')).toBe('2026-01-31')
    expect(toIsoDate('31/01/2026')).toBe('2026-01-31')
    expect(toIsoDate('11th Jan 2026')).toBe('2026-01-11')
    expect(toIsoDate('not_stated')).toBeNull()
    expect(isExpired('January 31, 2026', '2026-09-10')).toBe(true)
    expect(isExpired('2026-09-10', '2026-09-10')).toBe(false)
    expect(isExpired(null, '2026-09-10')).toBe(false)
  })
})

describe('seedFromFacts + mergeExtractions', () => {
  it('seeds renewal fields from the extraction call and lets the deeper read fill the rest', () => {
    const fast = seedFromFacts(normalizeExtraction({ leverageFactors: { daysToDeadline: 79 } }, 36330), { auto_renew: true, notice_days: 90, escalation_min_pct: 4, extra_increase_allowed: true, quote_expires: 'January 31, 2026' })
    expect(fast.renewalTerms).toEqual({ autoRenew: true, noticeDays: 90, escalationMinPct: 4, escalationCapPct: null, extraIncreaseAllowed: true })
    expect(fast.quoteDates?.expires).toBe('2026-01-31')
    const deep = normalizeExtraction({ cancellationTerms: { forceMajeurePresent: false }, renewalTerms: { escalationCapPct: 6 }, quoteDates: { created: 'November 13, 2025' } }, 36330)
    const merged = mergeExtractions(fast, deep)
    expect(merged.cancellationTerms.forceMajeurePresent).toBe(false)
    expect(merged.renewalTerms?.noticeDays).toBe(90)
    expect(merged.renewalTerms?.escalationCapPct).toBe(6)
    expect(merged.quoteDates?.created).toBe('2025-11-13')
    expect(merged.leverageFactors.daysToDeadline).toBe(79)
    expect(merged.contractTotal).toBe(36330)
  })

  it('counts HIGH terms flags only', () => {
    expect(countHighTermsFlags([{ severity: 'high', score_category: 'terms' }, { severity: 'high', score_category: 'pricing' }, { severity: 'medium', score_category: 'terms' }])).toBe(1)
  })
})
