import { describe, it, expect } from 'vitest'
import { stripPastDated, stripLongerTermOffers, longerTermOptedIn, datesIn, filterSolidAgainstFlags, stripDeadlineLeverage } from './playbook-hygiene'

describe('playbook hygiene — policy v2', () => {
  it('finds printed dates in several styles', () => {
    expect(datesIn('sign by January 15, 2026 or 31/01/2026 or 2026-02-01 or 11th Jan 2026')).toEqual(['2026-02-01', '2026-01-15', '2026-01-11', '2026-01-31'])
  })

  it('strips concessions whose dates are before the analysis date', () => {
    const r = stripPastDated([
      'Fast signature before January 15, 2026 in exchange for 3% off',
      'Reference call within 30 days of signing',
      'Commit by 2026-12-01 for the Q4 promotion',
    ], '2026-09-10')
    expect(r.dropped).toEqual(['Fast signature before January 15, 2026 in exchange for 3% off'])
    expect(r.kept.length).toBe(2)
  })

  it('drops longer-term offers unless the person opted in', () => {
    const items = ['Commit to a 36-month term in exchange for 8% off', 'Extend the contract to three years for a rate lock', 'Fast signature within 5 business days', 'Willingness to serve as a reference customer']
    expect(stripLongerTermOffers(items, false).kept).toEqual(['Fast signature within 5 business days', 'Willingness to serve as a reference customer'])
    expect(stripLongerTermOffers(items, true).kept).toEqual(items)
    expect(longerTermOptedIn({ contract_term_strategy: 'push_longer' })).toBe(true)
    expect(longerTermOptedIn({ contract_term_strategy: 'match_quote' })).toBe(false)
    expect(longerTermOptedIn(null)).toBe(false)
  })

  it('keeps the earlier rules working', () => {
    expect(filterSolidAgainstFlags(['24-month term locks in pricing'], [{ issue: 'No additional discount for the 24-month term' }], []).dropped.length).toBe(1)
    expect(stripDeadlineLeverage(['Quote expires January 31, 2026 — the rep needs this closed', '750 seats is meaningful volume']).kept).toEqual(['750 seats is meaningful volume'])
  })
})
