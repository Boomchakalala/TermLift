import { describe, it, expect } from 'vitest'
import { formatTotals, compactMoney, aggregateVendors, type DealLite } from './vendor-aggregate'

describe('formatTotals (per-currency, never converts)', () => {
  it('shows mixed currencies as "€42K + $18K", largest first', () => {
    expect(formatTotals({ USD: 18000, EUR: 42000 })).toBe('€42K + $18K')
  })
  it('single currency', () => {
    expect(formatTotals({ EUR: 24150 })).toBe('€24K')
  })
  it('empty -> dash', () => {
    expect(formatTotals({})).toBe('—')
  })
})

describe('compactMoney', () => {
  it('K and M and raw', () => {
    expect(compactMoney(42000)).toBe('42K')
    expect(compactMoney(1_500_000)).toBe('1.5M')
    expect(compactMoney(850)).toBe('850')
  })
})

describe('aggregateVendors', () => {
  const round = (tc: string, cur: string, score: number) => ({ output_json: { score, snapshot: { total_commitment: tc, currency: cur } }, round_number: 1 })
  const deal = (over: Partial<DealLite>): DealLite => ({
    id: Math.random().toString(36), vendor_id: 'v1', status: 'in_progress', savings_amount: null, final_total: null,
    updated_at: '2026-05-01', created_at: '2026-05-01', rounds: [round('€10,000', 'EUR', 70)], ...over,
  })

  it('keeps totals per-currency and averages scores', () => {
    const deals = [
      deal({ rounds: [round('€10,000', 'EUR', 80)] }),
      deal({ rounds: [round('$5,000', 'USD', 60)], status: 'closed_won', savings_amount: 1000 }),
    ]
    const [row] = aggregateVendors([{ id: 'v1', canonical_name: 'Acme', aliases: [] }], deals)
    expect(row.dealCount).toBe(2)
    expect(row.totalsByCurrency).toEqual({ EUR: 10000, USD: 5000 })
    expect(row.savingsByCurrency).toEqual({ USD: 1000 }) // realized savings only on won deals
    expect(row.avgScore).toBe(70)
    expect(formatTotals(row.totalsByCurrency)).toBe('€10K + $5K')
  })
})

describe('aggregateVendors — frozen savings (verification.savings_frozen)', () => {
  const round = (tc: string, cur: string) => ({ output_json: { score: 70, snapshot: { total_commitment: tc, currency: cur } }, round_number: 1 })
  const base = (over: Partial<DealLite>): DealLite => ({
    id: Math.random().toString(36), vendor_id: 'v1', status: 'closed_won', savings_amount: 1000, final_total: null,
    updated_at: '2026-05-01', created_at: '2026-05-01', rounds: [round('$5,000', 'USD')], ...over,
  })
  it('splits won savings into frozen-in-base and still-to-convert', () => {
    const deals = [
      base({ verification: { savings_frozen: { amount: 920, currency: 'EUR' } } }), // frozen at close
      base({ savings_amount: 500 }),                                       // closed before the migration
      base({ status: 'in_progress', savings_amount: 300 }),                // not won: no savings at all
    ]
    const [row] = aggregateVendors([{ id: 'v1', canonical_name: 'Acme', aliases: [] }], deals)
    expect(row.savingsByCurrency).toEqual({ USD: 1500 })      // display split keeps every won deal in its own currency
    expect(row.savingsFrozenByBase).toEqual({ EUR: 920 })
    expect(row.savingsLiveByCurrency).toEqual({ USD: 500 })
  })
})
