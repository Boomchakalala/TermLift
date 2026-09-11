/**
 * Playbook enrichment of the quick-analysis flags (2026-09-11).
 *
 * The quick analysis decides the flag list and the score; both are final. The
 * Playbook's model call receives those flags as an authoritative list and may
 * only fill in, per flag, the concrete ask and the fallback. This helper applies
 * that in code whatever the model returned: same rows, same order, same
 * severity / category / issue / why — only `what_to_ask_for` and
 * `if_they_push_back` can change, and never on a rule-backed flag whose ask is
 * policy (auto-renewal notice, escalation cap; see lib/ask-policy.ts).
 */
import { topicOverlap } from '@/lib/email-asks'

export interface FlagRow {
  type?: string
  severity?: string
  score_category?: string
  issue?: string
  why_it_matters?: string
  what_to_ask_for?: string
  if_they_push_back?: string
  source_rule?: string
  [k: string]: unknown
}

export interface PlaybookFlag {
  index?: number
  issue?: string
  what_to_ask_for?: string
  if_they_push_back?: string
  [k: string]: unknown
}

export interface AttachResult<T extends FlagRow> {
  flags: T[]
  /** How many quick flags received a Playbook ask. */
  enriched: number
  /** Playbook rows that matched no quick flag (dropped — the Playbook never adds rows). */
  unmatched: number
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** True when the ask on this flag is set by policy, not by the model. */
export function isPolicyFlag(flag: FlagRow): boolean {
  const rule = String(flag.source_rule || '')
  return /(^|\+)(escalation|auto_renew)\./.test(rule)
}

/**
 * Match each Playbook row to one quick flag: by `index` when the model echoed
 * it, else by position when the lists have the same length, else by issue
 * wording. Copy the ask and fallback onto that flag. Everything else is kept.
 */
export function attachPlaybookAsks<T extends FlagRow>(quickFlags: T[], playbookFlags: PlaybookFlag[] | null | undefined): AttachResult<T> {
  const out = quickFlags.map((f) => ({ ...f }))
  const rows = Array.isArray(playbookFlags) ? playbookFlags : []
  const taken = new Set<number>()
  let enriched = 0
  let unmatched = 0
  const samePosition = rows.length === out.length

  rows.forEach((row, pos) => {
    let idx = -1
    if (typeof row.index === 'number' && Number.isInteger(row.index) && row.index >= 0 && row.index < out.length && !taken.has(row.index)) idx = row.index
    else if (samePosition && !taken.has(pos)) idx = pos
    else {
      const issue = text(row.issue)
      if (issue) {
        let best = -1, bestScore = 0
        out.forEach((f, i) => {
          if (taken.has(i)) return
          const s = topicOverlap(issue, text(f.issue))
          if (s > bestScore) { best = i; bestScore = s }
        })
        if (bestScore >= 0.5) idx = best
      }
    }
    if (idx < 0) { unmatched++; return }
    taken.add(idx)
    const target = out[idx]
    if (isPolicyFlag(target)) return
    const ask = text(row.what_to_ask_for)
    const fallback = text(row.if_they_push_back)
    if (!ask && !fallback) return
    if (ask) target.what_to_ask_for = ask
    if (fallback) target.if_they_push_back = fallback
    enriched++
  })

  return { flags: out, enriched, unmatched }
}

/** The block the Playbook prompt receives: the flags it must keep, numbered. */
export function renderExistingFlagsForPrompt(flags: FlagRow[]): string {
  if (!flags.length) return 'EXISTING RED FLAGS (authoritative): none. The quick analysis found no red flag; return "red_flags": []. Do not add any.'
  const lines = flags.map((f, i) => `${i}. [${String(f.severity || 'medium').toUpperCase()} / ${f.score_category || 'terms'}] ${text(f.issue)}${text(f.why_it_matters) ? ` — ${text(f.why_it_matters)}` : ''}${isPolicyFlag(f) ? ' (ask fixed by policy; return it unchanged)' : ''}`)
  return `EXISTING RED FLAGS (authoritative — the quick analysis already decided the flag list and the score, and both are FINAL):
${lines.join('\n')}

For "red_flags" return EXACTLY ${flags.length} entries, in this order, each with "index" (the number above) and the same type, severity, score_category, issue and why_it_matters. Your work on each flag is ONLY "what_to_ask_for" (the concrete ask, with the number or clause) and "if_they_push_back" (the fallback). Do not add, drop, merge, split, re-rank or re-grade a flag. Anything else worth raising goes into watchItems, the asks, or the savings — never into red_flags.`
}
