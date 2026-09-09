/**
 * Display-layer status for a deal: one badge naming the stage, one optional
 * secondary line naming who or where. Pure mapping over already-derived
 * fields (stage, mode, closed/won/lost, waitingOnClient, roundCount) — it
 * adds no state and changes no gating. The ladder names (`ladder.*`) stay
 * for the landing, pricing and the rail; rows and the deal header use these.
 */
import type { DealStage, NegotiationMode } from '@/lib/deal-stage'

export type DealStatusKey = 'analyzed' | 'playbook' | 'negotiating' | 'won' | 'lost' | 'closed'

export interface DealStatusInput {
  stage: DealStage
  mode: NegotiationMode
  closed: boolean
  won: boolean
  /** status === 'closed_lost'. Every other closed sub-status reads "Closed". */
  lost?: boolean
  /** TermLift negotiation is waiting on the user. */
  waitingOnClient?: boolean
  roundCount?: number
}

export interface DealStatusSecondary {
  /** i18n key under `status.*`. */
  key: string
  values?: Record<string, string | number>
  /** Urgent: rendered amber and semibold ("Reply needed"). */
  attention?: boolean
}

export interface DealStatusDisplay {
  key: DealStatusKey
  /** i18n key under `status.*` for the badge label. */
  labelKey: string
  secondary: DealStatusSecondary | null
}

export const STATUS_LABEL_KEY: Record<DealStatusKey, string> = {
  analyzed: 'status.analyzed',
  playbook: 'status.playbookReady',
  negotiating: 'status.negotiating',
  won: 'status.won',
  lost: 'status.lost',
  closed: 'status.closed',
}

export function dealStatusDisplay(r: DealStatusInput): DealStatusDisplay {
  const done = (key: DealStatusKey, secondary: DealStatusSecondary | null = null): DealStatusDisplay =>
    ({ key, labelKey: STATUS_LABEL_KEY[key], secondary })

  if (r.closed) return done(r.won ? 'won' : r.lost ? 'lost' : 'closed')
  if (r.stage === 'negotiate') {
    if (r.waitingOnClient) return done('negotiating', { key: 'status.replyNeeded', attention: true })
    if (r.mode === 'termlift') return done('negotiating', { key: 'status.termlift' })
    if ((r.roundCount ?? 0) > 1) return done('negotiating', { key: 'status.round', values: { n: r.roundCount as number } })
    return done('negotiating')
  }
  return done(r.stage === 'full' ? 'playbook' : 'analyzed')
}
