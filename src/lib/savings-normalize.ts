import { parseMoney } from '@/lib/currency'

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
  dropped_reason?: 'stacked_percentage'
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

export function normalizeSavings(raw: unknown, contractTotal: number): NormalizedSavings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const must = toItems(r.must_have).map((it) => (isConditionalAsk(it.ask, it.rationale) ? { ...it, amount: null, quantified: false } : { ...it, quantified: it.amount != null }))
  const nice = toItems(r.nice_to_have).map((it) => (isConditionalAsk(it.ask, it.rationale) ? { ...it, amount: null, quantified: false } : { ...it, quantified: it.amount != null }))

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

  const total = must.reduce((s, it) => s + (it.quantified && it.amount != null ? it.amount : 0), 0)
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
