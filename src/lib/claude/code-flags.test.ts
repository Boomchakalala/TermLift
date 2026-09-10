import { describe, it, expect } from 'vitest'
import { detectCodeFlags, mergeCodeFlags } from './code-flags'
import { normalizeExtraction } from '@/lib/scoring'

const knowBe4 = normalizeExtraction({
  renewalTerms: { autoRenew: true, noticeDays: 90, escalationMinPct: 4, escalationCapPct: null, extraIncreaseAllowed: true },
  quoteDates: { created: 'November 13, 2025', expires: 'January 31, 2026', currentSubEnd: '11th Jan 2026' },
}, 36330)

describe('detectCodeFlags (rules 1, 2, 10/11 on the renewal/date fields)', () => {
  it('raises the 90-day notice, the uncapped uplift and the expired quote on the KnowBe4 fixture', () => {
    const flags = detectCodeFlags(knowBe4, '2026-09-10', '$36,330')
    const rules = flags.map((f) => f.source_rule)
    expect(rules).toEqual(['auto_renew.notice_long', 'escalation.no_cap', 'quote.expired'])
    expect(flags[0].severity).toBe('high')
    expect(flags[0].score_category).toBe('terms')
    expect(flags[1].severity).toBe('high')
    expect(flags[1].issue).toMatch(/minimum of 4% per year with no cap, and the vendor may increase beyond that/)
    expect(flags[2].issue).toBe('Quote expired on January 31, 2026')
    expect(flags[2].what_to_ask_for).toMatch(/refreshed quote/)
  })

  it('is quiet on a quote that states nothing', () => {
    expect(detectCodeFlags(normalizeExtraction({}, 1000), '2026-09-10')).toEqual([])
  })

  it('grades the notice window: short is high, medium is medium, unspecified is medium', () => {
    const at = (noticeDays: number | null) => detectCodeFlags(normalizeExtraction({ renewalTerms: { autoRenew: true, noticeDays } }, 1000), '2026-09-10')[0]
    expect(at(30).severity).toBe('high')
    expect(at(45).severity).toBe('medium')
    expect(at(75)).toBeUndefined()
    expect(at(null).severity).toBe('medium')
  })

  it('grades a capped uplift by the cap', () => {
    const cap = (escalationCapPct: number) => detectCodeFlags(normalizeExtraction({ renewalTerms: { escalationMinPct: 3, escalationCapPct } }, 1000), '2026-09-10')[0]
    expect(cap(7).severity).toBe('high')
    expect(cap(4).severity).toBe('medium')
    expect(cap(3)).toBeUndefined()
  })

  it('flags a quote expiring within a week and nothing for a live one', () => {
    const soon = detectCodeFlags(normalizeExtraction({ quoteDates: { expires: '2026-09-15' } }, 1000), '2026-09-10')
    expect(soon[0].source_rule).toBe('quote.expires_soon')
    expect(detectCodeFlags(normalizeExtraction({ quoteDates: { expires: '2026-12-31' } }, 1000), '2026-09-10')).toEqual([])
  })
})

describe('mergeCodeFlags', () => {
  it('keeps the model wording for a flag it already raised and lifts the severity', () => {
    const model = [{ type: 'Renewal', severity: 'medium', score_category: 'terms', issue: '90-day written cancellation notice required to avoid auto-renewal', why_it_matters: '', what_to_ask_for: 'Reduce to 30 days', if_they_push_back: '' }]
    const out = mergeCodeFlags(model, detectCodeFlags(knowBe4, '2026-09-10'))
    expect(out.length).toBe(3)
    expect(out[0].issue).toBe(model[0].issue)
    expect(out[0].severity).toBe('high')
    expect((out[0] as { source_rule?: string }).source_rule).toBe('model+auto_renew.notice_long')
    expect(out.map((f) => (f as { source_rule?: string }).source_rule)).toContain('escalation.no_cap')
  })

  it('appends rule flags the model missed', () => {
    const out = mergeCodeFlags([], detectCodeFlags(knowBe4, '2026-09-10'))
    expect(out.length).toBe(3)
  })
})
