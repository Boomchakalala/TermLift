import { parseMoney } from '@/lib/currency'
import { stripPastDated } from '@/lib/playbook-hygiene'

/**
 * Deterministic clean-up of the model's savings list (2026-09-11).
 *
 * 1. An ask that is conditional on facts the quote does not carry ("if
 *    headcount is below 750", "unverified", "hypothetical") keeps its text but
 *    loses its amount: `amount: null`, `quantified: false`. The UI prints
 *    "Not quantified"; the total and the target ignore it.
 * 2. A headline percentage ask ("5% discount on total contract value") is
 *    recomputed on the total NET of every other quantified, line-specific
 *    must-have ask, so stacked asks no longer double-count.
 * 3. `total` = sum of quantified must-have amounts (never the model's figure).
 */
export interface SavingsItem {
  ask: string
  amount: number | null
  rationale?: string
  /** False when the amount was removed because the ask is conditional. */
  quantified?: boolean
  /** Set when rule 2 rewrote the amount. */
  recomputed_from?: { pct: number; base: number; original: number }
  /** Why the amount was removed, when it was not the conditional-ask rule. */
  dropped_reason?: 'stacked_percentage' | 'exceeds_quote'
}

/** A printed line as lib/quote-facts.ts sanitises it — only what the savings check needs. */
export interface SavingsLine { description: string | null; line_total: number | null }

const ANY_PCT = /(\d+(?:[.,]\d+)?)\s*%/

/**
 * Recompute a percentage ask against the line it names (term total from the
 * printed lines). Used when the model's amount is impossible — a term total
 * treated as monthly and multiplied by 12 is the classic case.
 */
export function recomputeFromLines(ask: string, lines: SavingsLine[] | null | undefined, contractTotal: number): { amount: number; base: number; pct: number } | null {
  const m = ask.match(ANY_PCT)
  if (!m) return null
  const pct = parseFloat(m[1].replace(',', '.'))
  if (!(pct > 0 && pct < 100)) return null
  const askL = ask.toLowerCase()
  const hit = (lines || []).find((l) => {
    if (!l.description || !(l.line_total != null && l.line_total > 0)) return false
    const words = l.description.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^(the|and|for|per|with)$/.test(w))
    return words.length > 0 && words.filter((w) => askL.includes(w)).length >= Math.min(2, words.length)
  })
  const base = hit ? (hit.line_total as number) : headlinePct(ask) != null ? contractTotal : null
  if (base == null || !(base > 0)) return null
  return { amount: Math.round((base * pct) / 100), base, pct }
}

export interface NormalizedSavings {
  total: number
  currency?: string
  low?: number
  high?: number
  must_have: SavingsItem[]
  nice_to_have: SavingsItem[]
  [k: string]: unknown
}

const CONDITIONAL = /\b(if\b|unless\b|should\b.*\bbe\b|unverified|unconfirmed|hypothetical|assum(e|ing|ption)|headcount|actual usage|if adoption|were\b.*\bto\b)/i
const HEADLINE_PCT = /(\d+(?:[.,]\d+)?)\s*%[^.]*\b(total|contract|headline|overall|whole|entire|tcv|deal)\b/i

function amountOf(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
  const n = parseMoney(String(v)).amount
  return Number.isFinite(n) && n > 0 ? n : null
}

function toItems(list: unknown): SavingsItem[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((i) => i && typeof i === 'object' && typeof (i as { ask?: unknown }).ask === 'string')
    .map((i) => {
      const it = i as { ask: string; amount?: unknown; rationale?: unknown }
      return { ask: it.ask.trim(), amount: amountOf(it.amount), rationale: typeof it.rationale === 'string' ? it.rationale : '' }
    })
}

export function isConditionalAsk(ask: string, rationale?: string): boolean {
  return CONDITIONAL.test(ask) || (!!rationale && /\b(if|unverified|unconfirmed|hypothetical)\b/i.test(rationale) && /headcount|usage|adoption|seats?/i.test(`${ask} ${rationale}`))
}

/** The headline percentage an ask states, when it is a discount on the whole contract. */
export function headlinePct(ask: string): number | null {
  const m = ask.match(HEADLINE_PCT)
  if (!m) return null
  const pct = parseFloat(m[1].replace(',', '.'))
  return Number.isFinite(pct) && pct > 0 && pct < 100 ? pct : null
}

export function normalizeSavings(raw: unknown, contractTotal: number, lines?: SavingsLine[] | null, asOf?: string | null): NormalizedSavings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  // A concession that hinges on a date already behind the analysis date is dead: it is removed, not just unquantified.
  const alive = (it: SavingsItem) => !asOf || stripPastDated([it.ask], asOf).kept.length > 0
  const must = toItems(r.must_have).filter(alive).map((it) => (isConditionalAsk(it.ask, it.rationale) ? { ...it, amount: null, quantified: false } : { ...it, quantified: it.amount != null }))
  const nice = toItems(r.nice_to_have).filter(alive).map((it) => (isConditionalAsk(it.ask, it.rationale) ? { ...it, amount: null, quantified: false } : { ...it, quantified: it.amount != null }))

  // Rule 0: no single ask can save the whole quote or more. Such an amount is a
  // period error (a term total read as monthly, ×12). Recompute the percentage
  // against the printed line it names; if that is not possible, unquantify it.
  if (contractTotal > 0) {
    for (const it of [...must, ...nice]) {
      if (!it.quantified || it.amount == null || it.amount < contractTotal) continue
      const re = recomputeFromLines(it.ask, lines, contractTotal)
      if (re && re.amount > 0 && re.amount < contractTotal) {
        it.recomputed_from = { pct: re.pct, base: re.base, original: it.amount }
        it.amount = re.amount
      } else {
        it.amount = null
        it.quantified = false
        it.dropped_reason = 'exceeds_quote'
      }
    }
  }

  // Rule 1b: never sum two percentage discounts onto the same quoted total —
  // keep the largest headline % ask quantified, the others become unquantified.
  const headlines = must.filter((it) => it.quantified && it.amount != null && headlinePct(it.ask) != null)
  if (headlines.length > 1) {
    const keep = headlines.reduce((best, it) => ((headlinePct(it.ask) as number) > (headlinePct(best.ask) as number) ? it : best), headlines[0])
    for (const it of headlines) {
      if (it === keep) continue
      it.amount = null
      it.quantified = false
      it.dropped_reason = 'stacked_percentage'
    }
  }

  // Rule 2: headline % on the net of the line-specific quantified asks.
  if (contractTotal > 0) {
    const lineSpecific = must.filter((it) => it.quantified && it.amount != null && headlinePct(it.ask) == null).reduce((s, it) => s + (it.amount as number), 0)
    for (const it of must) {
      const pct = headlinePct(it.ask)
      if (pct == null || !it.quantified || it.amount == null) continue
      const base = Math.max(0, contractTotal - lineSpecific)
      const recomputed = Math.round((base * pct) / 100)
      if (recomputed > 0 && Math.abs(recomputed - it.amount) >= 1) {
        it.recomputed_from = { pct, base, original: it.amount }
        it.amount = recomputed
      }
    }
  }

  let total = must.reduce((s, it) => s + (it.quantified && it.amount != null ? it.amount : 0), 0)
  // The must-have total can never reach the quote: drop the largest items until it is below.
  while (contractTotal > 0 && total >= contractTotal) {
    const largest = must.filter((it) => it.quantified && it.amount != null).sort((a, b) => (b.amount as number) - (a.amount as number))[0]
    if (!largest) break
    largest.amount = null; largest.quantified = false; largest.dropped_reason = 'exceeds_quote'
    total = must.reduce((s, it) => s + (it.quantified && it.amount != null ? it.amount : 0), 0)
  }
  const out: NormalizedSavings = { ...r, must_have: must, nice_to_have: nice, total }
  // The fast pass's low/high must never exceed a total the asks no longer support.
  if (typeof out.high === 'number' && out.high > 0 && total > 0 && out.high < total) out.high = total
  if (typeof out.low === 'number' && out.low > total && total > 0) out.low = total
  return out
}

/** Sum of quantified must-have amounts — the one figure every tile and target uses. */
export function quantifiedMustHaveTotal(ps: unknown): number {
  if (!ps || typeof ps !== 'object' || Array.isArray(ps)) return 0
  const list = (ps as { must_have?: unknown }).must_have
  if (!Array.isArray(list)) return 0
  return list.reduce((s: number, it: { amount?: unknown; quantified?: unknown }) => {
    if (it?.quantified === false) return s
    const a = amountOf(it?.amount)
    return s + (a ?? 0)
  }, 0)
}
