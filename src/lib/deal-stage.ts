/**
 * The product ladder. Every deal is at exactly one stage; the same four names
 * appear on the landing page, pricing, the /try result, Home (stage column)
 * and the deal page (stage rail). Stage is DERIVED from existing data — this
 * file adds no schema and changes no gating.
 *
 * 2026-09-04: "TermLift negotiates" is no longer a stage. It is a MODE of the
 * Negotiate stage (you do it, or TermLift does it for you) and an add-on
 * commercially. A user who negotiated themselves never "skipped" anything.
 */
import { hasDeepContent } from '@/lib/deep-analysis-status'

export type DealStage = 'quick' | 'full' | 'negotiate' | 'closed'
export type NegotiationMode = 'self' | 'termlift' | null

export const STAGE_ORDER: DealStage[] = ['quick', 'full', 'negotiate', 'closed']

/** i18n key (under `ladder.*`) for each stage's label. */
export const STAGE_LABEL_KEY: Record<DealStage, string> = {
  quick: 'ladder.quick',
  full: 'ladder.full',
  negotiate: 'ladder.negotiate',
  closed: 'ladder.closed',
}

/** Label key for a stage chip, mode-aware: "Negotiating · TermLift" when TermLift runs it. */
export function stageChipKey(stage: DealStage, mode: NegotiationMode): string {
  if (stage === 'negotiate' && mode === 'termlift') return 'ladder.negotiateTermlift'
  return STAGE_LABEL_KEY[stage]
}

export function stageIndex(stage: DealStage): number {
  return STAGE_ORDER.indexOf(stage)
}

/** Minimal shape needed to derive a stage — works for deals rows joined with rounds. */
export interface StageInput {
  status?: string | null
  rounds?: Array<{ round_number: number; output_json?: unknown }> | null
  /** Any open TermLift negotiation request on this deal (status not closed_*). */
  negotiationRequestStatus?: string | null
}

/** A generated email lives inside the round's output_json (no separate column) — same signal DealScrollView uses. */
function hasGeneratedEmail(output: unknown): boolean {
  const o = output as { email_drafts?: { neutral?: { body?: unknown } } } | null | undefined
  return !!o?.email_drafts?.neutral?.body
}

/**
 * closed_*                              → closed
 * open negotiation_request              → negotiate (mode: termlift)
 * ≥2 rounds OR an email was generated   → negotiate (mode: self)
 * latest round has deep content         → full
 * otherwise                             → quick
 */
export function deriveDealStage(d: StageInput): DealStage {
  if (d.status?.startsWith('closed_')) return 'closed'
  const nr = d.negotiationRequestStatus
  if (nr && !nr.startsWith('closed_')) return 'negotiate'
  const rounds = [...(d.rounds || [])].sort((a, b) => b.round_number - a.round_number)
  const latest = rounds[0]
  const emailed = rounds.some((r) => hasGeneratedEmail(r.output_json))
  if (rounds.length >= 2 || emailed) return 'negotiate'
  if (latest && hasDeepContent(latest.output_json)) return 'full'
  return 'quick'
}

/** Who is running the negotiation, when the deal is (or was) in the Negotiate stage. */
export function deriveNegotiationMode(d: StageInput): NegotiationMode {
  const nr = d.negotiationRequestStatus
  if (nr) return 'termlift'
  const rounds = d.rounds || []
  if (rounds.length >= 2 || rounds.some((r) => hasGeneratedEmail(r.output_json))) return 'self'
  return null
}
