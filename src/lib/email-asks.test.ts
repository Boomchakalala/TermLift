import { describe, it, expect } from 'vitest'
import { selectEmailAsks, isGenericDiscountAsk } from './email-asks'

// The stored KnowBe4 Playbook (round b1781f07…) after savings normalisation.
const fixture = {
  red_flags: [
    { type: 'Renewal', severity: 'high', score_category: 'terms', issue: '90-day written cancellation notice required to avoid auto-renewal', why_it_matters: '', what_to_ask_for: 'Reduce the cancellation notice window to 30 days. If KnowBe4 refuses, require them to send a written renewal reminder no later than 120 days before the renewal date.', if_they_push_back: '' },
    { type: 'Renewal', severity: 'high', score_category: 'terms', issue: 'Minimum 4% compounded annual fee escalation on renewal', why_it_matters: '', what_to_ask_for: 'Cap renewal escalation at CPI or 3%, whichever is lower, and remove the unilateral right to increase beyond the stated minimum.', if_they_push_back: '' },
    { type: 'Commercial', severity: 'medium', score_category: 'pricing', issue: 'Compliance Plus discount (30.85%) is materially lower than the KSAT discount (38.1%)', why_it_matters: '', what_to_ask_for: 'Match the Compliance Plus discount to the KSAT rate of 38.1%', if_they_push_back: '' },
    { type: 'Usage Risk', severity: 'medium', score_category: 'pricing', issue: '750 seats provisioned with no confirmation of actual headcount', why_it_matters: '', what_to_ask_for: 'Confirm actual headcount before signing.', if_they_push_back: '' },
    { type: 'Commercial', severity: 'medium', score_category: 'pricing', issue: 'No additional discount requested for the 24-month commitment length', why_it_matters: '', what_to_ask_for: 'Request an explicit multi-year discount of 5% applied to the total contract value', if_they_push_back: '' },
  ],
  what_to_ask_for: {
    must_have: [
      'Additional 5% discount on total contract value in recognition of the 24-month commitment — target $34,514',
      'Match Compliance Plus discount to KSAT rate of 38.1%',
      'Cap renewal fee escalation at 4% maximum (not minimum) with no additional discretionary increase',
      'Reduce auto-renewal cancellation notice from 90 days to 30 days, or require vendor to send a written renewal reminder at 120 days',
      'Confirm and lock seat count to verified headcount before signing',
    ],
    nice_to_have: ['True-down clause allowing up to 10% seat reduction at the 12-month anniversary'],
  },
  potential_savings: {
    must_have: [
      { ask: '5% discount on total contract value for 24-month commitment', amount: 1763, quantified: true },
      { ask: 'Match Compliance Plus discount to KSAT rate of 38.1%, reducing unit price from $13.53 to approximately $12.10', amount: 1073, quantified: true },
    ],
    nice_to_have: [{ ask: 'Right-size seat count if headcount is below 750', amount: null, quantified: false }],
  },
}

describe('selectEmailAsks (KnowBe4 fixture)', () => {
  it('opens with the refreshed quote, then the two HIGH flag asks; the 5% headline becomes a stretch', () => {
    const s = selectEmailAsks(fixture, { quoteExpired: true, expiredOn: '2026-01-31' })
    expect(s.asks.length).toBe(3)
    expect(s.asks[0].reason).toBe('refreshed_quote')
    expect(s.asks[0].label).toMatch(/refreshed quote/)
    expect(s.asks[1].reason).toBe('high_flag')
    expect(s.asks[2].reason).toBe('high_flag')
    expect(s.asks.map((a) => a.label).join(' ')).toMatch(/notice/)
    expect(s.asks.map((a) => a.label).join(' ')).toMatch(/escalation/)
    expect(s.asks.some((a) => /5%/.test(a.label))).toBe(false)
    expect(s.stretch.some((m) => m.startsWith('Additional 5% discount'))).toBe(true)
  })

  it('without an expiry, HIGH flags come first and the largest quantified must-have fills the third slot', () => {
    const s = selectEmailAsks(fixture, { quoteExpired: false })
    expect(s.asks.length).toBe(3)
    expect(s.asks[0].reason).toBe('high_flag')
    expect(s.asks[1].reason).toBe('high_flag')
    expect(s.asks[2].reason).toBe('must_have')
    // The generic 5% ask ranks last among must-haves, so Compliance Plus parity ($1,073) wins the slot.
    expect(s.asks[2].label).toMatch(/Compliance Plus/)
  })

  it('never selects an ask whose savings were unquantified as a money ask', () => {
    const s = selectEmailAsks(fixture, { quoteExpired: false })
    expect(s.asks.find((a) => /headcount/.test(a.label))).toBeUndefined()
  })

  it('keeps the rule-backed uplift and notice asks when a third HIGH flag competes for the two slots (live run 4)', () => {
    const out = {
      ...fixture,
      red_flags: [
        { type: 'Renewal', severity: 'high', score_category: 'terms', source_rule: 'model+escalation.no_cap', issue: 'Renewal escalation is uncapped', why_it_matters: '', what_to_ask_for: 'Cap renewal price increases at CPI or 3%, whichever is lower, and remove the vendor right to increase beyond the cap, in the order form.', if_they_push_back: '' },
        { type: 'Renewal', severity: 'high', score_category: 'terms', source_rule: 'model+auto_renew.notice_long', issue: 'Auto-renewal with 90-day non-renewal notice window', why_it_matters: '', what_to_ask_for: 'Reduce auto-renewal notice window from 90 days to 30 or 60 days', if_they_push_back: '' },
        { type: 'Scope', severity: 'high', score_category: 'terms', issue: 'Seat counts are contractually frozen', why_it_matters: '', what_to_ask_for: 'Mid-term seat reduction right of up to 15% at month 12 with 30 days notice', if_they_push_back: '' },
      ],
      what_to_ask_for: { must_have: ['Reduce auto-renewal notice window from 90 days to 30 or 60 days', 'Additional 5% discount on both KSAT and Compliance Plus line items', 'Mid-term seat reduction right of up to 15% at month 12 with 30 days notice'], nice_to_have: [] },
    }
    const s = selectEmailAsks(out, { quoteExpired: true, expiredOn: '2026-01-31' })
    expect(s.asks.map((a) => a.reason)).toEqual(['refreshed_quote', 'high_flag', 'high_flag'])
    expect(s.asks[1].label).toMatch(/CPI or 3%/)
    expect(s.asks[2].label).toMatch(/notice window/)
    expect(s.asks.some((a) => /seat reduction/.test(a.label))).toBe(false)
  })

  it('recognises generic headline-discount asks', () => {
    expect(isGenericDiscountAsk('5% discount on total contract value')).toBe(true)
    expect(isGenericDiscountAsk('Additional 5% discount on total contract value in recognition of the 24-month commitment')).toBe(true)
    expect(isGenericDiscountAsk('Match Compliance Plus discount to KSAT rate of 38.1%')).toBe(false)
  })
})
