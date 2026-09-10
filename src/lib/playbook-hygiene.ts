import { topicOverlap } from '@/lib/email-asks'

/**
 * Deterministic clean-up of the model's playbook lists (2026-09-11).
 *
 * - `whats_solid` may not praise something a flag or a must-have ask attacks.
 * - When the quote has expired, leverage bullets built on its deadline are
 *   historical and are dropped.
 */

/** Drop "already solid" bullets that overlap a flag issue or a must-have ask by ≥0.5. */
export function filterSolidAgainstFlags(
  solid: string[] | null | undefined,
  flags: Array<{ issue?: unknown }> | null | undefined,
  mustHave: string[] | null | undefined,
): { kept: string[]; dropped: Array<{ bullet: string; against: string }> } {
  const kept: string[] = []
  const dropped: Array<{ bullet: string; against: string }> = []
  const targets: string[] = [
    ...(flags || []).map((f) => String(f?.issue || '')).filter(Boolean),
    ...(mustHave || []).filter((s): s is string => typeof s === 'string' && s.trim().length > 0),
  ]
  for (const bullet of solid || []) {
    if (typeof bullet !== 'string' || !bullet.trim()) continue
    const hit = targets.find((t) => topicOverlap(bullet, t) >= 0.5)
    if (hit) dropped.push({ bullet, against: hit })
    else kept.push(bullet)
  }
  return { kept, dropped }
}

const DEADLINE_LEVERAGE = /(deadline|expir|valid (until|through)|validity|quarter[- ]end|year[- ]end|end of (the )?(quarter|year|month)|fiscal|needs? (this|it) closed|close (this )?(before|by)|sign(ing)? (before|by)|time pressure|urgency)/i

/** Leverage bullets that lean on the quote's deadline, when the quote has already expired. */
export function stripDeadlineLeverage(bullets: string[] | null | undefined): { kept: string[]; dropped: string[] } {
  const kept: string[] = []
  const dropped: string[] = []
  for (const b of bullets || []) {
    if (typeof b !== 'string') continue
    if (DEADLINE_LEVERAGE.test(b)) dropped.push(b)
    else kept.push(b)
  }
  return { kept, dropped }
}
