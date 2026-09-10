import { describe, it, expect } from 'vitest'
import { applyVoiceGuard } from './email-guard'

describe('applyVoiceGuard', () => {
  it('rewrites forbidden playbook phrasing and keeps the target figure', () => {
    const r = applyVoiceGuard('We would like to land at $33,848 for the full term. The expired quote is the starting point. Please confirm the contract terms before Friday. This is the main blocker on our side.')
    expect(r.body).toBe('We would like to get to $33,848 for the full term. The expired quote is the basis. This is the main points on our side.')
    expect(r.body).not.toMatch(/land at|starting point|blocker|confirm the contract terms/)
    expect(r.changed.length).toBe(4)
  })

  it('leaves a clean email alone', () => {
    const body = 'Hi Daan,\n\nThanks for the proposal. Once those points are agreed, we can sign.\n\nBest regards,\n[Your Name]'
    expect(applyVoiceGuard(body).body).toBe(body)
  })
})
