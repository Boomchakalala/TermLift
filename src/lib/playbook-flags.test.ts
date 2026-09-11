import { describe, expect, it } from 'vitest'
import { attachPlaybookAsks, isPolicyFlag, renderExistingFlagsForPrompt } from './playbook-flags'

const quick = [
  { type: 'Renewal', severity: 'high', score_category: 'terms', issue: 'Renewal pricing has a 4% floor with no ceiling', why_it_matters: 'Vendor can raise fees to any amount.', what_to_ask_for: 'POLICY ASK', if_they_push_back: 'POLICY FALLBACK', source_rule: 'model+escalation.no_cap' },
  { type: 'Commercial', severity: 'high', score_category: 'terms', issue: 'Seat counts cannot be reduced during the term', why_it_matters: '750 seats locked for 24 months.', what_to_ask_for: 'quick ask', if_they_push_back: 'quick fallback' },
  { type: 'Commercial', severity: 'medium', score_category: 'leverage', issue: 'Quote expired on January 31, 2026', why_it_matters: 'Prices are historical.', what_to_ask_for: 'Ask for a refreshed quote', if_they_push_back: 'Keep printed discounts', source_rule: 'quote.expired' },
]

describe('attachPlaybookAsks', () => {
  it('keeps every row, order, severity and issue; copies ask + fallback by index', () => {
    const r = attachPlaybookAsks(quick, [
      { index: 1, issue: 'different wording entirely', severity: 'low', what_to_ask_for: 'Annual true-down of 10%', if_they_push_back: 'Mid-term review at month 12' },
      { index: 2, what_to_ask_for: 'Refreshed quote keeping the printed discounts', if_they_push_back: 'Honour the printed unit prices' },
    ])
    expect(r.flags).toHaveLength(3)
    expect(r.flags.map((f) => f.issue)).toEqual(quick.map((f) => f.issue))
    expect(r.flags.map((f) => f.severity)).toEqual(['high', 'high', 'medium'])
    expect(r.flags[1].what_to_ask_for).toBe('Annual true-down of 10%')
    expect(r.flags[1].if_they_push_back).toBe('Mid-term review at month 12')
    expect(r.flags[2].what_to_ask_for).toBe('Refreshed quote keeping the printed discounts')
    expect(r.enriched).toBe(2)
    expect(r.unmatched).toBe(0)
    expect(quick[1].what_to_ask_for).toBe('quick ask') // input untouched
  })
  it('never overwrites a policy flag ask', () => {
    const r = attachPlaybookAsks(quick, [{ index: 0, what_to_ask_for: 'Cap at 2%', if_they_push_back: 'x' }])
    expect(r.flags[0].what_to_ask_for).toBe('POLICY ASK')
    expect(r.flags[0].if_they_push_back).toBe('POLICY FALLBACK')
    expect(r.enriched).toBe(0)
  })
  it('matches by position when no index and same length, by wording otherwise, and drops extras', () => {
    const byPos = attachPlaybookAsks(quick, [
      { what_to_ask_for: 'a' }, { what_to_ask_for: 'b' }, { what_to_ask_for: 'c' },
    ])
    expect(byPos.flags[1].what_to_ask_for).toBe('b')
    expect(byPos.flags[2].what_to_ask_for).toBe('c')
    const byWords = attachPlaybookAsks(quick, [
      { issue: 'Seat counts cannot be reduced during the 24-month term', what_to_ask_for: 'true-down right' },
      { issue: 'Compliance Plus discount is weaker than KSAT', what_to_ask_for: 'match discount' },
      { issue: 'Something unrelated about SLA credits', what_to_ask_for: 'sla' },
      { issue: 'Another unrelated one', what_to_ask_for: 'z' },
    ])
    expect(byWords.flags).toHaveLength(3)
    expect(byWords.flags[1].what_to_ask_for).toBe('true-down right')
    expect(byWords.unmatched).toBeGreaterThanOrEqual(2)
  })
  it('tolerates a missing or empty Playbook list', () => {
    expect(attachPlaybookAsks(quick, undefined).flags).toHaveLength(3)
    expect(attachPlaybookAsks([], [{ index: 0, what_to_ask_for: 'x' }]).flags).toEqual([])
  })
})

describe('isPolicyFlag / renderExistingFlagsForPrompt', () => {
  it('recognises rule-backed asks', () => {
    expect(isPolicyFlag(quick[0])).toBe(true)
    expect(isPolicyFlag(quick[1])).toBe(false)
    expect(isPolicyFlag(quick[2])).toBe(false)
  })
  it('renders the numbered authoritative block', () => {
    const s = renderExistingFlagsForPrompt(quick)
    expect(s).toContain('EXACTLY 3 entries')
    expect(s).toContain('0. [HIGH / terms] Renewal pricing has a 4% floor with no ceiling')
    expect(s).toContain('(ask fixed by policy; return it unchanged)')
    expect(renderExistingFlagsForPrompt([])).toContain('"red_flags": []')
  })
})
