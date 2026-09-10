import { describe, it, expect } from 'vitest'
import { buildQuoteFacts } from './quote-facts'

describe('buildQuoteFacts — net before list (2026-09-11)', () => {
  it('replaces a unit_price that is really the list price with the line net price that reconciles (live KnowBe4 output)', () => {
    const f = buildQuoteFacts({ total_commitment: '$36,330', term: '24 months', term_months: 24, pricing_metric: 'per_seat_year',
      main_line: { description: 'KnowBe4 Security Awareness Training Subscription Diamond', quantity: 750, unit_price: 56.4, unit_period: 'term', line_total: 26182.5 },
      printed_line_totals: [26182.5, 10147.5],
      line_items: [
        { description: 'KnowBe4 Security Awareness Training Subscription Diamond', quantity: 750, list_unit_price: 56.4, discount_pct: 38.1, net_unit_price: 34.91, line_total: 26182.5 },
        { description: 'Compliance Plus', quantity: 750, list_unit_price: 19.57, discount_pct: 30.85, net_unit_price: 13.53, line_total: 10147.5 },
      ] })
    expect(f.unit_price).toBe(34.91)
    expect(f.checks.unit_price).toBe('verified')
    expect(f.list_unit_price).toBe(56.4)
    expect(f.lines?.length).toBe(2)
    expect(f.lines?.[1].net_unit_price).toBe(13.53)
    expect(f.notes.join(' ')).toMatch(/replaced by 34.91/)
  })

  it('derives the net from list × (1 − discount) when no net is printed', () => {
    const f = buildQuoteFacts({ total_commitment: '$26,183', term: '24 months', term_months: 24,
      main_line: { description: 'KSAT', quantity: 750, unit_price: 56.4, unit_period: 'term', line_total: 26182.5 },
      line_items: [{ description: 'KSAT', quantity: 750, list_unit_price: 56.4, discount_pct: 38.1, line_total: 26182.5 }] })
    expect(f.unit_price).toBeCloseTo(34.91, 1)
    expect(f.checks.unit_price).toBe('verified')
  })

  it('keeps a stated unit price that already reconciles', () => {
    const f = buildQuoteFacts({ total_commitment: '€16,344', term: '12 months', pricing_metric: 'per_seat_month',
      main_line: { quantity: 120, unit_price: 11.35, unit_period: 'month', line_total: 1362 }, printed_line_totals: [1362],
      line_items: [{ description: 'Enterprise', quantity: 120, list_unit_price: 15, net_unit_price: 11.35, line_total: 1362 }] })
    expect(f.unit_price).toBe(11.35)
    expect(f.list_unit_price).toBe(15)
    expect(f.notes.join(' ')).not.toMatch(/replaced/)
  })
})
