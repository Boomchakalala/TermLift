import { describe, expect, it } from 'vitest'
import { dealStatusDisplay } from './deal-status-display'

const base = { closed: false, won: false, lost: false, waitingOnClient: false, roundCount: 1 } as const

describe('dealStatusDisplay — the nine mapping rows', () => {
  it('quick analysis only → Analyzed, no secondary', () => {
    expect(dealStatusDisplay({ ...base, stage: 'quick', mode: null })).toMatchObject({ key: 'analyzed', secondary: null })
  })
  it('playbook ready, no negotiation → Playbook ready', () => {
    expect(dealStatusDisplay({ ...base, stage: 'full', mode: null })).toMatchObject({ key: 'playbook', secondary: null })
  })
  it('self-run round 1 → Negotiating with no round line', () => {
    expect(dealStatusDisplay({ ...base, stage: 'negotiate', mode: 'self', roundCount: 1 })).toMatchObject({ key: 'negotiating', secondary: null })
  })
  it('self-run round 2 → Negotiating + Round 2', () => {
    expect(dealStatusDisplay({ ...base, stage: 'negotiate', mode: 'self', roundCount: 2 })).toMatchObject({
      key: 'negotiating', secondary: { key: 'status.round', values: { n: 2 } },
    })
  })
  it('TermLift negotiating → Negotiating + TermLift handling', () => {
    expect(dealStatusDisplay({ ...base, stage: 'negotiate', mode: 'termlift', roundCount: 3 })).toMatchObject({
      key: 'negotiating', secondary: { key: 'status.termlift' },
    })
  })
  it('TermLift waiting on the client → Reply needed, flagged as attention, beats the round', () => {
    expect(dealStatusDisplay({ ...base, stage: 'negotiate', mode: 'termlift', waitingOnClient: true, roundCount: 3 })).toMatchObject({
      key: 'negotiating', secondary: { key: 'status.replyNeeded', attention: true },
    })
  })
  it('closed won → Won', () => {
    expect(dealStatusDisplay({ ...base, stage: 'closed', mode: 'self', closed: true, won: true })).toMatchObject({ key: 'won', secondary: null })
  })
  it('closed lost → Lost', () => {
    expect(dealStatusDisplay({ ...base, stage: 'closed', mode: 'self', closed: true, lost: true })).toMatchObject({ key: 'lost', secondary: null })
  })
  it('closed for any other reason (paused, inferred, broker margin) → Closed', () => {
    expect(dealStatusDisplay({ ...base, stage: 'closed', mode: 'termlift', closed: true })).toMatchObject({ key: 'closed', secondary: null })
  })
  it('a closed deal never shows a negotiation secondary line', () => {
    expect(dealStatusDisplay({ ...base, stage: 'closed', mode: 'termlift', closed: true, won: true, waitingOnClient: true, roundCount: 4 }).secondary).toBeNull()
  })
})
