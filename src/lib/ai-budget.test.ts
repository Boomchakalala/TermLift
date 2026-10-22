import { describe, it, expect } from 'vitest'
import { evaluateBudget, capacityMessage, startOfUtcDay, startOfUtcMonth } from './ai-budget'

const now = new Date('2026-10-22T15:30:00Z')

describe('evaluateBudget', () => {
  it('passes under both caps', () => {
    const s = evaluateBudget({ spentTodayUsd: 3, spentMonthUsd: 40, killSwitch: false, now, dailyCapUsd: 15, monthlyCapUsd: 200 })
    expect(s.allowed).toBe(true)
    expect(s.stop).toBeNull()
    expect(s.resetAt.toISOString()).toBe('2026-10-23T00:00:00.000Z')
  })
  it('stops at the daily cap and resets at the next UTC midnight', () => {
    const s = evaluateBudget({ spentTodayUsd: 15, spentMonthUsd: 40, killSwitch: false, now, dailyCapUsd: 15, monthlyCapUsd: 200 })
    expect(s.allowed).toBe(false)
    expect(s.stop).toBe('daily')
    expect(s.resetAt.toISOString()).toBe('2026-10-23T00:00:00.000Z')
  })
  it('the monthly cap wins over the daily one and resets on the 1st', () => {
    const s = evaluateBudget({ spentTodayUsd: 20, spentMonthUsd: 200, killSwitch: false, now, dailyCapUsd: 15, monthlyCapUsd: 200 })
    expect(s.stop).toBe('monthly')
    expect(s.resetAt.toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })
  it('kill switch stops everything regardless of spend', () => {
    const s = evaluateBudget({ spentTodayUsd: 0, spentMonthUsd: 0, killSwitch: true, now })
    expect(s.allowed).toBe(false)
    expect(s.stop).toBe('kill_switch')
  })
  it('messages exist in both languages for every stop', () => {
    for (const stop of ['daily', 'monthly', 'kill_switch'] as const) {
      const s = { ...evaluateBudget({ spentTodayUsd: 0, spentMonthUsd: 0, killSwitch: false, now }), allowed: false, stop }
      expect(capacityMessage(s, 'en').length).toBeGreaterThan(20)
      expect(capacityMessage(s, 'fr').length).toBeGreaterThan(20)
      expect(capacityMessage(s, 'en')).not.toBe(capacityMessage(s, 'fr'))
    }
  })
  it('UTC window helpers', () => {
    expect(startOfUtcDay(now).toISOString()).toBe('2026-10-22T00:00:00.000Z')
    expect(startOfUtcMonth(now).toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })
})
