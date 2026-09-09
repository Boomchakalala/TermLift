import { describe, it, expect } from 'vitest'
import { roundAnchor } from './deal-metrics'

describe('roundAnchor — the clean number to say out loud', () => {
  it('rounds to the nearest 100 under 20k, 500 under 200k, 1,000 above', () => {
    expect(roundAnchor(13879)).toBe(13900)
    expect(roundAnchor(13849)).toBe(13800)
    expect(roundAnchor(46655)).toBe(46500)
    expect(roundAnchor(46750)).toBe(47000)
    expect(roundAnchor(1_234_567)).toBe(1_235_000)
  })
  it('never invents a number from nothing', () => {
    expect(roundAnchor(0)).toBe(0)
    expect(roundAnchor(-5)).toBe(0)
    expect(roundAnchor(NaN)).toBe(0)
  })
})
