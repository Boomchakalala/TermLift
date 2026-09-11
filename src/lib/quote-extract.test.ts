import { describe, expect, it } from 'vitest'
import { buildPersistedExtract, factsFromOutput, readPersistedExtract, renderExtractForModel, sanitizeTermClauses } from './quote-extract'
import type { ExtractedFacts } from './claude/extract'

const facts: ExtractedFacts = {
  vendor: 'KnowBe4',
  vendor_product: 'KnowBe4 / Security Awareness Training',
  category: 'SaaS - Security',
  description: 'Security awareness training platform.',
  term: '12 months',
  total_commitment: '$33,500',
  billing_payment: 'Annual upfront',
  pricing_model: 'Per seat, billed annually',
  currency: 'USD',
  deal_type: 'Renewal',
  contact_name: 'Sarah',
  quote_number: 'Q-2026-0417',
  quote_created: 'February 1, 2026',
  quote_expires: 'February 28, 2026',
  current_sub_end: 'March 15, 2026',
  auto_renew: true,
  notice_days: 60,
  escalation_min_pct: 4,
  extra_increase_allowed: true,
  term_months: 12,
  line_items: [
    { description: 'Platinum subscription', sku: 'KB4-PLAT', quantity: 500, list_unit_price: 80, discount_pct: 16.25, net_unit_price: 67, line_total: 33500, term_months: 12 },
  ],
  printed_line_totals: [33500],
  deal_type_evidence: ['Sub end date: March 15, 2026'],
  term_clauses: [
    { topic: 'auto_renewal', text: 'This subscription renews automatically for successive 12-month terms unless notice is given 60 days before the end of the term.' },
    { topic: 'price_increase', text: 'Renewal pricing increases by a minimum of 4%.' },
    { topic: 'auto_renewal', text: 'This subscription renews automatically for successive 12-month terms unless notice is given 60 days before the end of the term.' },
    { topic: 'made_up', text: 'Payment due net 30.' },
    { topic: 'sla', text: 'short' },
  ],
}

describe('sanitizeTermClauses', () => {
  it('deduplicates, normalises unknown topics to other, drops fragments', () => {
    const out = sanitizeTermClauses(facts.term_clauses)
    expect(out).toHaveLength(3)
    expect(out.map((c) => c.topic)).toEqual(['auto_renewal', 'price_increase', 'other'])
  })
  it('caps at 15 clauses and 400 characters', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ topic: 'other', text: `Clause number ${i} ` + 'x'.repeat(500) }))
    const out = sanitizeTermClauses(many)
    expect(out).toHaveLength(15)
    expect(out[0].text.length).toBe(400)
  })
  it('tolerates garbage', () => {
    expect(sanitizeTermClauses(undefined)).toEqual([])
    expect(sanitizeTermClauses([null, 3, 'x', { text: 4 }])).toEqual([])
  })
})

describe('buildPersistedExtract / readPersistedExtract', () => {
  it('round-trips through an output_json object', () => {
    const extract = buildPersistedExtract(facts, 'claude-haiku-4-5', new Date('2026-09-11T10:00:00Z'))
    expect(extract.version).toBe(1)
    expect(extract.extracted_at).toBe('2026-09-11T10:00:00.000Z')
    expect(extract.facts.term_clauses).toHaveLength(3)
    const back = readPersistedExtract({ vendor: 'KnowBe4', extract })
    expect(back?.facts.vendor).toBe('KnowBe4')
    expect(back?.facts.line_items?.[0].net_unit_price).toBe(67)
  })
  it('returns null when the round has no usable extract', () => {
    expect(readPersistedExtract({})).toBeNull()
    expect(readPersistedExtract({ extract: { facts: {} } })).toBeNull()
    expect(readPersistedExtract(null)).toBeNull()
  })
})

describe('factsFromOutput', () => {
  it('prefers the persisted extract', () => {
    const extract = buildPersistedExtract(facts, null)
    const f = factsFromOutput({ vendor: 'Other', snapshot: { total_commitment: '$1' }, extract }, 'New')
    expect(f.total_commitment).toBe('$33,500')
    expect(f.line_items).toHaveLength(1)
  })
  it('rebuilds the slim facts from the snapshot on legacy rounds', () => {
    const f = factsFromOutput({ vendor: 'Acme', category: 'SaaS', snapshot: { vendor_product: 'Acme / Thing', term: '24 months', total_commitment: '€10,000', billing_payment: 'Quarterly', pricing_model: 'Flat', currency: 'EUR' } }, 'Renewal')
    expect(f).toMatchObject({ vendor: 'Acme', term: '24 months', total_commitment: '€10,000', currency: 'EUR', deal_type: 'Renewal' })
    expect(f.line_items).toBeUndefined()
  })
})

describe('renderExtractForModel', () => {
  const text = renderExtractForModel(buildPersistedExtract(facts, null))
  it('is deterministic and carries lines, dates, renewal mechanics and clauses', () => {
    expect(renderExtractForModel(buildPersistedExtract(facts, null))).toBe(text)
    expect(text).toContain('Total commitment: $33,500 (USD)')
    expect(text).toContain('1. Platinum subscription | sku KB4-PLAT | qty 500 | list 80 | discount 16.25% | net unit 67 | line total 33500 | 12 months')
    expect(text).toContain('valid until February 28, 2026')
    expect(text).toContain('current subscription ends March 15, 2026')
    expect(text).toContain('auto-renews: yes; notice to cancel: 60 days; minimum renewal increase: 4%')
    expect(text).toContain('- [auto_renewal] This subscription renews automatically')
    expect(text).toContain('DEAL-TYPE EVIDENCE (verbatim): "Sub end date: March 15, 2026"')
  })
  it('says the document is not attached', () => {
    expect(text.startsWith('STRUCTURED QUOTE EXTRACT (the document itself is not attached')).toBe(true)
  })
  it('renders a single-total quote without a lines block', () => {
    const slim = renderExtractForModel(buildPersistedExtract({ vendor: 'Acme', vendor_product: 'Acme / Thing', term: 'one-time', total_commitment: '€10,000', billing_payment: 'On invoice', pricing_model: 'Flat', currency: 'EUR', deal_type: 'New purchase' }, null))
    expect(slim).not.toContain('LINE ITEMS')
    expect(slim).not.toContain('TERM CLAUSES')
    expect(slim).toContain('Term: one-time')
  })
})
