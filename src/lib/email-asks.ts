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
    const covered = pushFor.some((p) => topicOverlap(p, ask) >= 0.5)
    if (covered) {
      const match = candidates.find((c) => topicOverlap(c.label, ask) >= 0.5)
      if (match && !match.severity && sev) match.severity = sev
      if (match && rule && !match.rule) match.rule = rule
      // The uplift ask is policy (CPI or 3%, fallback 4%): the rule's wording replaces the playbook's.
      if (match && rule && /escalation/.test(rule)) match.label = ask
      continue
    }
    candidates.push({ label: ask, savings: null, severity: sev, rule })
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
// Email ask selection, in code (2026-09-11). The regenerate-emails route used
// to hand the model an undeduped dump of every ask and let it "pick 3-4". Now:
//
//   1. an expired quote → "refreshed quote" is always the first ask
//   2. every HIGH-severity flag ask, most money first
//   3. then the largest quantified must-have asks
//   4. cap 3; a generic headline-discount ask ("5% off the total") ranks last
//      and, when it misses the cap, is passed as a stretch mention
// ─────────────────────────────────────────────────────────────────────────────

export interface SelectedAsk {
  label: string
  /** Why it made the cut — surfaced in the prompt so the model keeps the order. */
  reason: 'refreshed_quote' | 'high_flag' | 'must_have'
  savings: number | null
}

export interface EmailAskSelection {
  asks: SelectedAsk[]
  /** Must-haves that missed the cap — mentioned only if natural, never as conditions. */
  stretch: string[]
}

const HEADLINE_DISCOUNT = /^\s*(?:an?\s+)?(?:additional\s+)?\d+(?:[.,]\d+)?\s*%\s*(?:discount|reduction|off)\b/i

/** A bare "X% off the total" ask with no line-specific reason. */
export function isGenericDiscountAsk(label: string): boolean {
  return HEADLINE_DISCOUNT.test(label) && /\b(total|contract|headline|overall|whole|entire|deal|commitment)\b/i.test(label)
}

export function selectEmailAsks(output: any, opts: { quoteExpired?: boolean; expiredOn?: string | null; cap?: number } = {}): EmailAskSelection {
  const cap = opts.cap ?? 3
  const candidates = buildCandidateAsks(output)
  // Quantified amounts only: an ask normalised to `quantified: false` carries no money.
  const psMust: any[] = output?.potential_savings?.must_have || []
  const quantified = new Map<string, number>()
  for (const it of psMust) if (it?.quantified !== false && typeof it?.amount === 'number' && it.amount > 0) quantified.set(String(it.ask).trim().toLowerCase(), it.amount)
  const savingsOf = (c: CandidateAsk): number | null => {
    const direct = quantified.get(c.label.trim().toLowerCase())
    if (direct != null) return direct
    if (c.savings != null && psMust.some((it) => it?.quantified === false && topicOverlap(String(it.ask), c.label) >= 0.5)) return null
    return c.savings
  }

  const picked: SelectedAsk[] = []
  const seen = new Set<string>()
  const take = (label: string, reason: SelectedAsk['reason'], savings: number | null) => {
    const key = label.trim().toLowerCase()
    if (seen.has(key) || picked.length >= cap) return
    if ([...seen].some((k) => topicOverlap(k, key) >= 0.6)) return
    seen.add(key)
    picked.push({ label, reason, savings })
  }

  if (opts.quoteExpired) {
    take(`A refreshed quote that keeps the printed pricing and discounts as the starting point${opts.expiredOn ? ` (the quote expired on ${opts.expiredOn})` : ''}`, 'refreshed_quote', null)
  }

  // HIGH asks: the ones a code rule stands behind first (uncapped uplift, then the notice window —
  // the largest renewal exposures), then the rest by money. With a cap of 3 these are the ones that must survive.
  const ruleRank = (r?: string | null) => (!r ? 3 : /escalation/.test(r) ? 0 : /auto_renew/.test(r) ? 1 : 2)
  const highs = candidates.filter((c) => c.severity === 'high').sort((a, b) => (ruleRank(a.rule) - ruleRank(b.rule)) || ((savingsOf(b) || 0) - (savingsOf(a) || 0)))
  for (const c of highs) take(c.label, 'high_flag', savingsOf(c))

  const musts: string[] = output?.what_to_ask_for?.must_have || []
  const rest = candidates
    .filter((c) => c.severity !== 'high' && musts.includes(c.label))
    .map((c) => ({ c, s: savingsOf(c), generic: isGenericDiscountAsk(c.label) }))
    .sort((a, b) => (a.generic === b.generic ? (b.s || 0) - (a.s || 0) : a.generic ? 1 : -1))
  for (const { c, s } of rest) take(c.label, 'must_have', s)

  const stretch = musts.filter((m) => !seen.has(m.trim().toLowerCase()) && ![...seen].some((k) => topicOverlap(k, m) >= 0.5))
  return { asks: picked, stretch }
}
