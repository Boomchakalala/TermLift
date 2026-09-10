import { describe, it, expect } from 'vitest'
import { selectEmailAsks, buildCandidateAsks } from './email-asks'

// The KnowBe4 Playbook after savings normalisation (live run 5), with the
// rule-backed flags the code merged in.
const fixture = {
  red_flags: [
    { type: 'Renewal', severity: 'high', score_category: 'terms', source_rule: 'model+escalation.no_cap', issue: 'Renewal escalation is uncapped', why_it_matters: '', what_to_ask_for: 'Cap renewal price increases at CPI or 3%, whichever is lower, and remove the vendor right to increase beyond the cap, in the order form.', if_they_push_back: '' },
    { type: 'Renewal', severity: 'high', score_category: 'terms', source_rule: 'model+auto_renew.notice_long', issue: 'Auto-renewal with 90-day non-renewal notice window', why_it_matters: '', what_to_ask_for: 'Reduce auto-renewal notice period from 90 days to 60 days', if_they_push_back: '' },
    { type: 'Scope', severity: 'high', score_category: 'terms', issue: 'Seat counts are contractually frozen', why_it_matters: '', what_to_ask_for: 'Mid-term seat reduction right of up to 15% at month 12 with 30 days notice', if_they_push_back: '' },
    { type: 'Commercial', severity: 'medium', score_category: 'pricing', issue: 'Compliance Plus discount (31%) is lower than KSAT (38%)', why_it_matters: '', what_to_ask_for: 'Match the Compliance Plus discount to the KSAT rate of 38%', if_they_push_back: '' },
    { type: 'Commercial', severity: 'medium', score_category: 'pricing', source_rule: 'model+quote.expired', issue: 'Quote expired January 31, 2026', why_it_matters: '', what_to_ask_for: 'Ask for a refreshed quote', if_they_push_back: '' },
  ],
  what_to_ask_for: {
    must_have: [
      'Reduce auto-renewal notice period from 90 days to 60 days',
      '5% additional discount on total contract value',
      'Mid-term seat reduction right of up to 15% at month 12 with 30 days notice',
      'Match the Compliance Plus discount to the KSAT rate of 38%',
    ],
    nice_to_have: ['Prepayment discount of 3% for paying the full term upfront'],
  },
  potential_savings: {
    must_have: [
      { ask: '5% additional discount on total contract value', amount: 1763, quantified: true },
      { ask: 'Compliance Plus discount improvement from 31% to 38%', amount: 1073, quantified: true },
    ],
    nice_to_have: [{ ask: 'Right-size seat count if prior-term utilization was below 750', amount: null, quantified: false }],
  },
}
const fmt = (n: number) => `$${n.toLocaleString('en-US')}`

describe('selectEmailAsks — policy v2 ranking', () => {
  it('expired quote: reopen line → target → uplift cap → notice; shape asks stay in the playbook', () => {
    const s = selectEmailAsks(fixture, { quoteExpired: true, expiredOn: '2026-01-31', targetPrice: 33494, formatMoney: fmt })
    expect(s.asks.map((a) => a.reason)).toEqual(['refreshed_quote', 'target_price', 'term', 'term'])
    expect(s.asks[1].label).toBe('Target total: $33,494')
    expect(s.asks[2].rule).toMatch(/escalation/)
    expect(s.asks[3].rule).toMatch(/auto_renew/)
    // Shape asks never reach the email as asks…
    expect(s.asks.some((a) => /seat reduction|Compliance Plus|5%/.test(a.label))).toBe(false)
    expect(s.playbookOnly).toContain('Mid-term seat reduction right of up to 15% at month 12 with 30 days notice')
    expect(s.playbookOnly).toContain('Prepayment discount of 3% for paying the full term upfront')
    // …but the quantified ones explain how the target is built.
    expect(s.justification).toEqual(['5% additional discount on total contract value', 'Compliance Plus discount improvement from 31% to 38%'])
  })

  it('live quote: no reopen line; target then the two term asks', () => {
    const s = selectEmailAsks(fixture, { quoteExpired: false, targetPrice: 33494, formatMoney: fmt })
    expect(s.asks.map((a) => a.reason)).toEqual(['target_price', 'term', 'term'])
    expect(s.asks.length).toBe(3)
  })

  it('caps term asks at two even when three HIGH terms flags exist, rule-backed first', () => {
    const s = selectEmailAsks(fixture, { quoteExpired: false, targetPrice: null })
    expect(s.asks.map((a) => a.reason)).toEqual(['term', 'term'])
    expect(s.asks[0].rule).toMatch(/escalation/)
    expect(s.asks[1].rule).toMatch(/auto_renew/)
    expect(s.playbookOnly).toContain('Mid-term seat reduction right of up to 15% at month 12 with 30 days notice')
  })

  it('no target and nothing rule-backed: a HIGH terms flag still counts as a term ask', () => {
    const out = { red_flags: [{ type: 'Terms', severity: 'high', score_category: 'terms', issue: 'No exit clause', what_to_ask_for: 'Add an exit clause after 12 months', if_they_push_back: '' }], what_to_ask_for: { must_have: ['Add an exit clause after 12 months', 'Remove the €500 onboarding fee'], nice_to_have: [] }, potential_savings: { must_have: [{ ask: 'Remove the €500 onboarding fee', amount: 500, quantified: true }] } }
    const s = selectEmailAsks(out, { targetPrice: 9500, formatMoney: fmt })
    expect(s.asks.map((a) => a.reason)).toEqual(['target_price', 'term'])
    expect(s.asks[1].label).toBe('Add an exit clause after 12 months')
    expect(s.justification).toEqual(['Remove the €500 onboarding fee'])
    expect(s.playbookOnly).toEqual(['Remove the €500 onboarding fee'])
  })

  it('carries the flag category onto candidates', () => {
    const c = buildCandidateAsks(fixture)
    expect(c.find((x) => /seat reduction/.test(x.label))?.category).toBe('terms')
    expect(c.find((x) => /Compliance Plus/.test(x.label))?.category).toBe('pricing')
  })

})
