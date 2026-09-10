import { describe, it, expect } from 'vitest'
import { inferDealTypeForPersistence, inferDealType } from './deal-type-inference'

describe('deal-type inference', () => {
  it('trusts the document\'s own "Order Type: Renewal" over the extraction summary (Datadog)', () => {
    const r = inferDealTypeForPersistence({ snapshotDealType: 'New purchase', recurring: true, extractedText: null, evidence: ['Order Type: Renewal', 'Start Date: 2/1/2026', 'End Date: 1/31/2027'] })
    expect(r.type).toBe('renewal')
    expect(r.confidence).toBe('high')
  })

  it('reads a current-subscription tell as a renewal when the summary said new (KnowBe4)', () => {
    const r = inferDealTypeForPersistence({ snapshotDealType: 'New purchase', recurring: true, extractedText: 'Sub end date: 11th Jan 2026\nStart Date: January 12, 2026', evidence: ['Sub end date: 11th Jan 2026'] })
    expect(r.type).toBe('renewal')
    expect(r.currentSubLanguage).toBe(true)
  })

  it('keeps a genuine new purchase', () => {
    const r = inferDealTypeForPersistence({ snapshotDealType: 'New purchase', recurring: true, extractedText: 'Welcome to Acme. Onboarding fee: $500. Initial term 12 months.', evidence: ['Onboarding fee: $500', 'Initial term 12 months'] })
    expect(r.type).toBe('new_purchase')
    expect(r.confidence).toBe('high')
  })

  it('ignores our own prompt header echoed as evidence', () => {
    const r = inferDealTypeForPersistence({ snapshotDealType: 'New purchase', recurring: undefined, extractedText: null, evidence: ['Deal Type: New'] })
    expect(r.evidence).toEqual([])
    expect(r.type).toBe('new_purchase')
    // Nothing contradicts the summary read, so it stands (the summary alone is the base rule's high-confidence case).
    expect(r.confidence).toBe('high')
  })

  it('base inference is unchanged for text-only calls', () => {
    expect(inferDealType('Renewal', true, 'renewal of the existing subscription').type).toBe('renewal')
  })
})
