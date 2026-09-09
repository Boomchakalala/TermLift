import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { deriveNegotiationFlow } from './negotiation-flow'
import { canAccessFullAnalysis, dealHasFullAnalysis } from './deep-analysis-status'

const quick = { snapshot: { total_commitment: '€100,000' }, deep_analysis_status: 'idle' as const }
const running = { ...quick, deep_analysis_status: 'running' as const }
const full = { ...quick, deep_analysis_status: 'done' as const, negotiation_plan: { trades_you_can_offer: ['x'] } }
const fullEmailed = { ...full, email_drafts: { neutral: { subject: 's', body: 'Dear vendor…' } } }
// A vendor reply is analysed at quick depth: Round 2+ outputs carry no deep sections and an 'idle' status.
// The deal's entitlement comes from Round 1, where Full Analysis ran.
const reply = { ...quick, deep_analysis_status: 'idle' as const, round_delta: { headline: 'moved' } }
const replyEmailed = { ...reply, email_drafts: { neutral: { subject: 's', body: 'Counter…' } } }
const dealId = 'd1'
const states = (f: ReturnType<typeof deriveNegotiationFlow>) => f.steps.map((s) => `${s.key}:${s.state}`)

describe('deriveNegotiationFlow — one dominant next action per state', () => {
  it('A. quick analysis only → Unlock Full Analysis; strategy is the current step, rounds are upcoming', () => {
    const f = deriveNegotiationFlow({ dealId, status: 'in_progress', rounds: [{ round_number: 1, output_json: quick }] })
    expect(f.phase).toBe('quick')
    expect(f.next.key).toBe('unlock_full')
    expect(f.next.cta.en).toBe('Get the Negotiation Playbook')
    expect(f.next.href).toBe('#deep-analysis')
    expect(states(f)).toEqual(['analysis:done', 'strategy:current', 'round_1:next', 'round_2:next', 'outcome:next'])
    expect(f.next.offerClose).toBe(false)
  })

  it('A2. Full Analysis running → a waiting state, still no email or round actions', () => {
    const f = deriveNegotiationFlow({ dealId, status: 'in_progress', rounds: [{ round_number: 1, output_json: running }] })
    expect(f.phase).toBe('full_running')
    expect(f.next.key).toBe('full_running')
  })

  it('B. Full Analysis complete, no Round 1 → Prepare Round 1', () => {
    const f = deriveNegotiationFlow({ dealId, status: 'in_progress', rounds: [{ round_number: 1, output_json: full }] })
    expect(f.phase).toBe('full')
    expect(f.next.key).toBe('prepare_round_1')
    expect(f.next.href).toBe('#email-section')
    expect(states(f)).toEqual(['analysis:done', 'strategy:done', 'round_1:current', 'round_2:next', 'outcome:next'])
  })

  it('C/D. Round 1 generated (or regenerated) → send it, then add the vendor response', () => {
    const f = deriveNegotiationFlow({ dealId, status: 'in_progress', rounds: [{ round_number: 1, output_json: fullEmailed }] })
    expect(f.phase).toBe('round_emailed')
    expect(f.next.key).toBe('send_and_upload')
    expect(f.next.round).toBe(1)
    expect(f.next.href).toBe('#add-round')
    expect(f.next.offerClose).toBe(true)
    // Round 1 stays the current step until the vendor's reply is recorded as Round 2.
    expect(states(f)).toEqual(['analysis:done', 'strategy:done', 'round_1:current', 'round_2:next', 'outcome:next'])
  })

  it('E. vendor response recorded as Round 2 → review and generate the Round 2 counter', () => {
    const f = deriveNegotiationFlow({ dealId, status: 'in_progress', rounds: [{ round_number: 1, output_json: fullEmailed }, { round_number: 2, output_json: reply }] })
    expect(f.phase).toBe('vendor_replied')
    expect(f.next.key).toBe('generate_counter')
    expect(f.next.round).toBe(2)
    expect(f.next.cta.en).toBe('Generate Round 2 counter')
    expect(states(f)).toEqual(['analysis:done', 'strategy:done', 'round_1:done', 'round_2:current', 'round_3:next', 'outcome:next'])
  })

  it('F. Round 2 counter generated → send it, then add the next response; a Round 3 slot is shown', () => {
    const f = deriveNegotiationFlow({ dealId, status: 'in_progress', rounds: [{ round_number: 1, output_json: fullEmailed }, { round_number: 2, output_json: replyEmailed }] })
    expect(f.phase).toBe('round_emailed')
    expect(f.next.round).toBe(2)
    expect(states(f)).toEqual(['analysis:done', 'strategy:done', 'round_1:done', 'round_2:current', 'round_3:next', 'outcome:next'])
  })

  it('G. a later round never implies the negotiation is limited to two rounds', () => {
    const rounds = [1, 2, 3, 4].map((n) => ({ round_number: n, output_json: n === 4 ? reply : n === 1 ? fullEmailed : replyEmailed }))
    const f = deriveNegotiationFlow({ dealId, status: 'in_progress', rounds })
    expect(f.next.key).toBe('generate_counter')
    expect(f.next.round).toBe(4)
    expect(f.steps.filter((s) => s.round).map((s) => s.round)).toEqual([1, 2, 3, 4, 5])
    expect(f.steps.find((s) => s.key === 'round_4')?.state).toBe('current')
    expect(f.steps.find((s) => s.key === 'round_5')?.state).toBe('next')
  })

  it('H. closed deal → view outcome; rounds recorded are done, no upcoming round is invented', () => {
    const won = deriveNegotiationFlow({ dealId, status: 'closed_won', rounds: [{ round_number: 1, output_json: fullEmailed }, { round_number: 2, output_json: replyEmailed }] })
    expect(won.phase).toBe('closed')
    expect(won.next.key).toBe('view_outcome')
    expect(won.next.href).toBe('/app/deal/d1/outcome')
    expect(states(won)).toEqual(['analysis:done', 'strategy:done', 'round_1:done', 'round_2:done', 'outcome:current'])
    const lost = deriveNegotiationFlow({ dealId, status: 'closed_lost', rounds: [{ round_number: 1, output_json: quick }] })
    expect(lost.next.href).toBe('#rounds')
    expect(lost.next.offerClose).toBe(false)
  })

  it('TermLift negotiates → open the negotiation; no self-serve round actions', () => {
    const f = deriveNegotiationFlow({ dealId, status: 'in_progress', rounds: [{ round_number: 1, output_json: full }], negotiationRequestStatus: 'negotiating', negotiationPageHref: '/app/negotiations/x' })
    expect(f.phase).toBe('termlift')
    expect(f.next.key).toBe('open_negotiation')
    expect(f.next.href).toBe('/app/negotiations/x')
    expect(f.steps.map((s) => s.key)).toEqual(['analysis', 'strategy', 'termlift', 'outcome'])
  })

  it('never offers Round 2 or email actions before Full Analysis exists', () => {
    for (const rounds of [[{ round_number: 1, output_json: quick }], [{ round_number: 1, output_json: running }]]) {
      const f = deriveNegotiationFlow({ dealId, status: 'in_progress', rounds })
      expect(['unlock_full', 'full_running']).toContain(f.next.key)
      expect(f.steps.filter((s) => s.round).every((s) => s.state === 'next')).toBe(true)
    }
  })

  it('a legacy deal analysed before the fast/deep split (no status field, real playbook) counts as Full Analysis', () => {
    const legacy = { snapshot: {}, negotiation_plan: { trades_you_can_offer: ['a'] }, watchItems: [] }
    expect(deriveNegotiationFlow({ dealId, status: 'in_progress', rounds: [{ round_number: 1, output_json: legacy }] }).phase).toBe('full')
  })
})

describe('gated actions are enforced by the API, not the page', () => {
  it('a quick-only round is not entitled to Full Analysis features', () => {
    expect(canAccessFullAnalysis(quick)).toBe(false)
    expect(canAccessFullAnalysis(running)).toBe(false)
    expect(canAccessFullAnalysis(full)).toBe(true)
  })

  it('entitlement is per deal: a quick-depth Round 2 inherits Round 1’s Full Analysis, a quick-only deal has none', () => {
    expect(dealHasFullAnalysis([{ output_json: fullEmailed }, { output_json: reply }])).toBe(true)
    expect(dealHasFullAnalysis([{ output_json: quick }])).toBe(false)
    expect(dealHasFullAnalysis([{ output_json: quick }, { output_json: reply }])).toBe(false)
    expect(dealHasFullAnalysis(null)).toBe(false)
  })

  it('the round and email routes check canAccessFullAnalysis before doing anything (direct API calls cannot bypass the page)', () => {
    const round = fs.readFileSync('src/app/api/deal/[dealId]/round/route.ts', 'utf8')
    const email = fs.readFileSync('src/app/api/deal/regenerate-emails/route.ts', 'utf8')
    expect(round).toMatch(/!dealHasFullAnalysis\(previousRounds\)/)
    expect(round.indexOf('dealHasFullAnalysis(')).toBeLessThan(round.indexOf('analyzeDeal('))
    expect(email).toMatch(/!dealHasFullAnalysis\(dealRounds\)/)
    expect(email.indexOf('dealHasFullAnalysis(')).toBeLessThan(email.indexOf("action: 'email_regenerate'"))
    // The flow module itself gates nothing: it only reads state.
    const flow = fs.readFileSync('src/lib/negotiation-flow.ts', 'utf8')
    expect(flow).not.toMatch(/fetch\(|supabase/)
  })
})
