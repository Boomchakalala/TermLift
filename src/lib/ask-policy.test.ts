import { describe, it, expect } from 'vitest'
import { enforceUpliftPolicy, enforceUpliftText, upliftCapCeiling, upliftAskText, upliftFallbackText } from './ask-policy'

const rt = { autoRenew: true, noticeDays: 90, escalationMinPct: 4, escalationCapPct: null, extraIncreaseAllowed: true }

describe('uplift ask policy', () => {
  it('asks CPI or 3% and falls back to 4%, never above the stated minimum', () => {
    expect(upliftCapCeiling(rt)).toBe(4)
    expect(upliftCapCeiling({ ...rt, escalationMinPct: 3 })).toBe(3)
    expect(upliftCapCeiling({ ...rt, escalationMinPct: null })).toBe(4)
    expect(upliftAskText()).toMatch(/CPI or 3%, whichever is lower/)
    expect(upliftFallbackText(rt)).toBe('Accept a hard cap of 4% per year with no discretionary increase (never above the 4% minimum the vendor already states).')
    expect(upliftFallbackText({ ...rt, escalationMinPct: 3 })).toMatch(/hard cap of 3%/)
  })

  it('rewrites a 6% cap proposal to the ceiling and leaves lower caps alone', () => {
    expect(enforceUpliftText('Hard cap on renewal price increases at 6% maximum per term', 4)).toEqual({ text: 'Hard cap on renewal price increases at 4% maximum per term', changed: true })
    expect(enforceUpliftText('Cap renewal escalation at CPI or 3%, whichever is lower', 4).changed).toBe(false)
    expect(enforceUpliftText('a maximum of 5% per year', 4).text).toBe('a maximum of 4% per year')
    expect(enforceUpliftText('not to exceed 4%', 4).changed).toBe(false)
    expect(enforceUpliftText('a 7% cap on increases', 4).text).toBe('a 4% cap on increases')
    // A discount percentage is not a cap.
    expect(enforceUpliftText('Match the Compliance Plus discount to 38.1%', 4).changed).toBe(false)
  })

  it('polices flags, asks and savings lines (the 6% the Playbook wrote on the fixture)', () => {
    const r = enforceUpliftPolicy({
      red_flags: [{ what_to_ask_for: 'Cap at 6% per term', if_they_push_back: 'Accept 8% maximum' }],
      what_to_ask_for: { must_have: ['Hard cap on renewal price increases at 6% maximum per term — remove the open-ended escalation right'], nice_to_have: [] },
      potential_savings: { must_have: [{ ask: 'Cap uplift at 5%', amount: 100 }], nice_to_have: [] },
    }, rt)
    expect(r.rewrites.length).toBe(4)
    expect(r.output.red_flags![0].what_to_ask_for).toBe('Cap at 4% per term')
    expect(r.output.red_flags![0].if_they_push_back).toBe('Accept 4% maximum')
    expect(r.output.what_to_ask_for!.must_have![0]).toBe('Hard cap on renewal price increases at 4% maximum per term — remove the open-ended escalation right')
    expect(r.output.potential_savings!.must_have![0].ask).toBe('Cap uplift at 4%')
  })
})
