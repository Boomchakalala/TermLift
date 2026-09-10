// ─────────────────────────────────────────────────────────────────────────────
// Candidate asks for the "What do you want to push on?" selector.
//
// Pure logic shared by the server (initial email generation defaults) and the
// client (checkbox panel) so the default selection is identical in both places.
// Sources: the negotiation playbook PUSH FOR items (must_have + nice_to_have)
// plus red-flag asks not already covered by a playbook item (deduped by topic).
// ─────────────────────────────────────────────────────────────────────────────

export interface CandidateAsk {
  label: string
  savings: number | null
  severity: 'high' | 'medium' | 'low' | null
  /** Code rule behind the flag this ask came from (lib/claude/code-flags.ts), when any. */
  rule?: string | null
  /** Score category of the flag this ask came from, when any. */
  category?: 'pricing' | 'terms' | 'leverage' | null
  /** The flag's fallback position (`if_they_push_back`), when the ask came from a flag. */
  fallback?: string | null
}

const STOP = new Set(['the', 'a', 'an', 'to', 'from', 'of', 'on', 'for', 'and', 'or', 'at', 'in', 'with', 'by', 'your', 'our', 'their', 'this', 'that', 'it', 'is', 'are', 'be', 'we', 'you'])

function tokens(s: string): Set<string> {
  return new Set(
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9% ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  )
}

/** Topic similarity 0-1 by shared significant tokens (Szymkiewicz–Simpson). */
export function topicOverlap(a: string, b: string): number {
  const A = tokens(a)
  const B = tokens(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  A.forEach((w) => { if (B.has(w)) inter++ })
  return inter / Math.min(A.size, B.size)
}

const sevRank = (s: string | null) => (s === 'high' ? 3 : s === 'medium' ? 2 : s === 'low' ? 1 : 0)

export function buildCandidateAsks(output: any): CandidateAsk[] {
  const must: string[] = output?.what_to_ask_for?.must_have || []
  const nice: string[] = output?.what_to_ask_for?.nice_to_have || []
  const redFlags: any[] = output?.red_flags || []
  const psMust: any[] = output?.potential_savings?.must_have || []
  const psNice: any[] = output?.potential_savings?.nice_to_have || []
  const pushFor = [...must, ...nice]

  // Savings for an ask: prefer the parallel potential_savings entry, else best topic match.
  const savingsFor = (label: string, list: any[], idx: number): number | null => {
    if (list[idx] && typeof list[idx].amount === 'number') return list[idx].amount
    let best: { amt: number; ov: number } | null = null
    for (const it of list) {
      if (typeof it?.amount !== 'number') continue
      const ov = topicOverlap(label, it.ask || '')
      if (ov > 0.4 && (!best || ov > best.ov)) best = { amt: it.amount, ov }
    }
    return best ? best.amt : null
  }

  const candidates: CandidateAsk[] = []
  must.forEach((label, i) => candidates.push({ label, savings: savingsFor(label, psMust, i), severity: null }))
  nice.forEach((label, i) => candidates.push({ label, savings: savingsFor(label, psNice, i), severity: null }))

  // Red-flag asks not already represented by a playbook item; attach severity where they are.
  for (const f of redFlags) {
    const ask = f?.what_to_ask_for
    if (!ask || typeof ask !== 'string') continue
    const sev = f?.severity ? (String(f.severity).toLowerCase() as CandidateAsk['severity']) : null
    const rule = typeof f?.source_rule === 'string' ? f.source_rule : null
    const category = (f?.score_category === 'terms' || f?.score_category === 'pricing' || f?.score_category === 'leverage') ? f.score_category as CandidateAsk['category'] : null
    const fallback = typeof f?.if_they_push_back === 'string' && f.if_they_push_back.trim() ? f.if_they_push_back.trim() : null
    const covered = pushFor.some((p) => topicOverlap(p, ask) >= 0.5)
    if (covered) {
      const match = candidates.find((c) => topicOverlap(c.label, ask) >= 0.5)
      if (match && !match.severity && sev) match.severity = sev
      if (match && rule && !match.rule) match.rule = rule
      if (match && category && !match.category) match.category = category
      if (match && fallback && !match.fallback) match.fallback = fallback
      // Uplift and notice asks are policy: the rule's wording replaces the playbook's.
      if (match && rule && /escalation|auto_renew/.test(rule)) match.label = ask
      continue
    }
    candidates.push({ label: ask, savings: null, severity: sev, rule, category, fallback })
  }

  // Dedupe identical labels.
  const seen = new Set<string>()
  return candidates.filter((c) => {
    const key = c.label.trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Top 2-3 asks: HIGH severity first, then largest savings. Returns the ask labels. */
export function defaultSelectedLabels(candidates: CandidateAsk[]): string[] {
  const ranked = [...candidates].sort((a, b) => {
    const sv = sevRank(b.severity) - sevRank(a.severity)
    if (sv !== 0) return sv
    return (b.savings || 0) - (a.savings || 0)
  })
  return ranked.slice(0, Math.min(3, candidates.length)).map((c) => c.label)
}

export function getCanOffer(output: any): string[] {
  return output?.negotiation_plan?.trades_you_can_offer || []
}

// ─────────────────────────────────────────────────────────────────────────────
// Email ask selection, in code (2026-09-11, policy v2). For every deal:
//
//   1. process reopen line, only when the quote has expired
//   2. the target price (the deal's single stored target_price)
//   3. rule-backed TERM asks — uplift cap, notice window — at most two
//   4. commercial SHAPE asks (seat cut, add-on discount parity, ...) stay in the
//      playbook; they reach the email only as the justification for the target
//      when they are what the target is built from
//
// Round 1 therefore carries at most: reopen line, target, two term asks.
// ─────────────────────────────────────────────────────────────────────────────

export type AskReason = 'refreshed_quote' | 'target_price' | 'term' | 'shape'

export interface SelectedAsk {
  label: string
  reason: AskReason
  savings: number | null
  rule?: string | null
  /** Fallback wording for a term ask, voiced only as "if X isn't possible, Y". */
  fallback?: string | null
}

export interface EmailAskSelection {
  /** What the email raises, in order. */
  asks: SelectedAsk[]
  /** The must-have asks the target is built from (names only, no amounts) — justification for the target, never separate asks. */
  justification: string[]
  /** Everything else: stays in the playbook, never reaches the email. */
  playbookOnly: string[]
}

const TERM_RULE = /escalation|auto_renew/
const termRank = (c: CandidateAsk) => (c.rule && /escalation/.test(c.rule) ? 0 : c.rule && /auto_renew/.test(c.rule) ? 1 : 2)

/** A term ask: backed by a renewal rule, or a HIGH flag in the terms category. */
export function isTermAsk(c: CandidateAsk): boolean {
  if (c.rule && TERM_RULE.test(c.rule)) return true
  return c.category === 'terms' && c.severity === 'high'
}

export function selectEmailAsks(output: any, opts: { quoteExpired?: boolean; expiredOn?: string | null; targetPrice?: number | null; formatMoney?: (n: number) => string; maxTermAsks?: number } = {}): EmailAskSelection {
  const maxTerm = opts.maxTermAsks ?? 2
  const fmt = opts.formatMoney ?? ((n: number) => String(n))
  const candidates = buildCandidateAsks(output)

  const asks: SelectedAsk[] = []
  const seen: string[] = []
  const take = (label: string, reason: AskReason, savings: number | null, rule?: string | null, fallback?: string | null) => {
    const key = label.trim().toLowerCase()
    if (seen.some((k) => k === key || topicOverlap(k, key) >= 0.6)) return false
    seen.push(key)
    asks.push({ label, reason, savings, rule: rule ?? null, fallback: fallback ?? null })
    return true
  }

  // 1. process reopen — one line, only when the quote has expired
  if (opts.quoteExpired) {
    take(`Ask for a refreshed quote that keeps the printed pricing and discounts${opts.expiredOn ? ` (the quote expired on ${opts.expiredOn})` : ''}`, 'refreshed_quote', null)
  }

  // 2. the target price — the one number the email lands on
  if (typeof opts.targetPrice === 'number' && opts.targetPrice > 0) {
    take(`Target total: ${fmt(opts.targetPrice)}`, 'target_price', null)
  }

  // 3. rule-backed term asks, uplift before notice, at most two
  const terms = candidates.filter(isTermAsk).sort((a, b) => termRank(a) - termRank(b) || (b.savings || 0) - (a.savings || 0))
  let termCount = 0
  for (const c of terms) {
    if (termCount >= maxTerm) break
    if (take(c.label, 'term', c.savings, c.rule, c.fallback)) termCount++
  }

  // 4. shape asks stay in the playbook; quantified ones explain the target
  const psMust: any[] = output?.potential_savings?.must_have || []
  const justification = psMust
    .filter((it) => it?.quantified !== false && typeof it?.amount === 'number' && it.amount > 0 && typeof it?.ask === 'string')
    .map((it) => String(it.ask))
  const playbookOnly = candidates
    .filter((c) => !seen.some((k) => k === c.label.trim().toLowerCase() || topicOverlap(k, c.label) >= 0.6))
    .map((c) => c.label)

  return { asks, justification, playbookOnly }
}
