import { describe, expect, it } from 'vitest'
import { createTimer, serverTimingHeader } from './timings'

describe('createTimer', () => {
  it('records stages, accumulates repeats and reports a total', async () => {
    let clock = 1000
    const timer = createTimer(() => clock)
    await timer.time('parse_ms', async () => { clock += 120 })
    await timer.time('extract_ms', async () => { clock += 4300 })
    await timer.time('parse_ms', async () => { clock += 30 })
    timer.mark('assemble_ms', 12)
    expect(timer.t).toEqual({ parse_ms: 150, extract_ms: 4300, assemble_ms: 12 })
    expect(timer.done()).toEqual({ parse_ms: 150, extract_ms: 4300, assemble_ms: 12, total_ms: 4450 })
  })
  it('still records the stage when it throws', async () => {
    let clock = 0
    const timer = createTimer(() => clock)
    await expect(timer.time('flags_ms', async () => { clock += 50; throw new Error('boom') })).rejects.toThrow('boom')
    expect(timer.t.flags_ms).toBe(50)
  })
})

describe('serverTimingHeader', () => {
  it('formats stages for the Server-Timing header', () => {
    expect(serverTimingHeader({ parse_ms: 120, extract_ms: 4300.4, total_ms: 4450 })).toBe('parse;dur=120, extract;dur=4300, total;dur=4450')
  })
})
