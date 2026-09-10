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
    const covered = pushFor.some((p) => topicOverlap(p, ask) >= 0.5)
    if (covered) {
      const match = candidates.find((c) => topicOverlap(c.label, ask) >= 0.5)
      if (match && !match.severity && sev) match.severity = sev
      continue
    }
    candidates.push({ label: ask, savings: null, severity: sev })
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
