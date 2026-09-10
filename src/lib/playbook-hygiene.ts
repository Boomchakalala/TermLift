import { topicOverlap } from '@/lib/email-asks'
import { isExpired, toIsoDate } from '@/lib/scoring'

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

// ── 2026-09-11 policy v2 ─────────────────────────────────────────────────────

const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`
const DATE_PATTERNS: RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  new RegExp(String.raw`\b${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b`, 'gi'),
  new RegExp(String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+${MONTH}\s+\d{4}\b`, 'gi'),
  /\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}\b/g,
]

/** Every date printed in a string, as ISO `YYYY-MM-DD`. */
export function datesIn(text: string): string[] {
  const out: string[] = []
  for (const re of DATE_PATTERNS) for (const m of String(text || '').match(re) || []) { const iso = toIsoDate(m); if (iso) out.push(iso) }
  return out
}

/**
 * Concessions, asks or leverage that hinge on a date already behind the
 * analysis date ("sign by January 15, 2026") are dead: drop them.
 */
export function stripPastDated(items: string[] | null | undefined, asOf: string | null | undefined): { kept: string[]; dropped: string[] } {
  const kept: string[] = []
  const dropped: string[] = []
  const today = toIsoDate(asOf)
  for (const it of items || []) {
    if (typeof it !== 'string') continue
    const past = !!today && datesIn(it).some((d) => isExpired(d, today))
    if (past) dropped.push(it)
    else kept.push(it)
  }
  return { kept, dropped }
}

const LONGER_TERM = /\b(longer|extended?|extension of the|multi[- ]?year|(?:3|three|4|four|5|five)[- ]year|(?:36|48|60)[- ]month)\b[^.]*\b(term|commitment|contract|agreement|deal)\b|\b(extend|lengthen)\w*\s+(the\s+)?(term|commitment|contract)\b|\bcommit(?:ting|ment)? to (?:a )?(?:longer|multi[- ]?year)\b/i

/**
 * A longer contract term is only on the table when the person opted in
 * (negotiation_preferences.contract_term_strategy === 'push_longer').
 */
export function stripLongerTermOffers(items: string[] | null | undefined, optedIn: boolean): { kept: string[]; dropped: string[] } {
  const kept: string[] = []
  const dropped: string[] = []
  for (const it of items || []) {
    if (typeof it !== 'string') continue
    if (!optedIn && LONGER_TERM.test(it)) dropped.push(it)
    else kept.push(it)
  }
  return { kept, dropped }
}

export function longerTermOptedIn(prefs: { contract_term_strategy?: string | null } | null | undefined): boolean {
  return prefs?.contract_term_strategy === 'push_longer'
}
