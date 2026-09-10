import type { RenewalTerms } from '@/lib/scoring'

/**
 * Ask policy for renewal price escalation (2026-09-11).
 *
 *   ask       = CPI or 3%, whichever is lower, and no discretionary increase
 *   fallback  = a hard cap of 4% — never above the minimum the vendor already
 *               states (a vendor whose floor is 3% gets a 3% cap, not 4%)
 *
 * The model is told the policy, and this module enforces it in code: any ask,
 * fallback or savings line that proposes a cap above the ceiling has that
 * number rewritten to the ceiling. Nothing else in the sentence changes.
 */
export const UPLIFT_ASK_PCT = 3
export const UPLIFT_FALLBACK_PCT = 4

export function upliftCapCeiling(rt: RenewalTerms | null | undefined): number {
  const min = rt?.escalationMinPct
  return min != null && min > 0 && min < UPLIFT_FALLBACK_PCT ? min : UPLIFT_FALLBACK_PCT
}

export function upliftAskText(): string {
  return `Cap renewal price increases at CPI or ${UPLIFT_ASK_PCT}%, whichever is lower, and remove the vendor's right to increase beyond the cap, in the order form.`
}

export function upliftFallbackText(rt: RenewalTerms | null | undefined): string {
  const ceiling = upliftCapCeiling(rt)
  const min = rt?.escalationMinPct
  const floorNote = min != null ? ` (never above the ${min}% minimum the vendor already states)` : ''
  return `Accept a hard cap of ${ceiling}% per year with no discretionary increase${floorNote}.`
}

// "cap at 6%", "capped at 6%", "6% cap", "maximum of 6%", "not to exceed 6%", "ceiling of 6%", "6% maximum"
const CAP_BEFORE = /\b(cap(?:ped)?|maximum|max\.?|not to exceed|ceiling|no more than|limit(?:ed)?)\b([^.;%\n]{0,40}?)(\d+(?:[.,]\d+)?)\s*%/gi
const CAP_AFTER = /(\d+(?:[.,]\d+)?)\s*%\s*(?:hard\s+)?(cap|maximum|ceiling|max\.?)\b/gi

export function enforceUpliftText(text: string, ceiling: number): { text: string; changed: boolean } {
  let changed = false
  const fix = (n: string) => {
    const v = parseFloat(n.replace(',', '.'))
    if (Number.isFinite(v) && v > ceiling) { changed = true; return String(ceiling) }
    return n
  }
  let out = text.replace(CAP_BEFORE, (m, kw: string, mid: string, n: string) => `${kw}${mid}${fix(n)}%`)
  out = out.replace(CAP_AFTER, (m, n: string, kw: string) => `${fix(n)}% ${kw}`)
  return { text: out, changed }
}

type FlagLike = { what_to_ask_for?: unknown; if_they_push_back?: unknown; [k: string]: unknown }
type OutputLike = {
  red_flags?: FlagLike[]
  what_to_ask_for?: { must_have?: unknown[]; nice_to_have?: unknown[] }
  potential_savings?: { must_have?: Array<{ ask?: unknown }>; nice_to_have?: Array<{ ask?: unknown }> } | null
  [k: string]: unknown
}

/** Rewrite every cap proposal above the ceiling, in place, and return what changed. */
export function enforceUpliftPolicy<T extends OutputLike>(output: T, rt: RenewalTerms | null | undefined): { output: T; rewrites: string[] } {
  const ceiling = upliftCapCeiling(rt)
  const rewrites: string[] = []
  const fixStr = (v: unknown, where: string): unknown => {
    if (typeof v !== 'string') return v
    const r = enforceUpliftText(v, ceiling)
    if (r.changed) rewrites.push(`${where}: "${v}" → "${r.text}"`)
    return r.text
  }
  const o = { ...output } as T
  if (Array.isArray(o.red_flags)) {
    o.red_flags = o.red_flags.map((f, i) => ({ ...f, what_to_ask_for: fixStr(f.what_to_ask_for, `red_flags[${i}].what_to_ask_for`), if_they_push_back: fixStr(f.if_they_push_back, `red_flags[${i}].if_they_push_back`) }))
  }
  if (o.what_to_ask_for) {
    o.what_to_ask_for = {
      ...o.what_to_ask_for,
      must_have: (o.what_to_ask_for.must_have || []).map((a, i) => fixStr(a, `what_to_ask_for.must_have[${i}]`)),
      nice_to_have: (o.what_to_ask_for.nice_to_have || []).map((a, i) => fixStr(a, `what_to_ask_for.nice_to_have[${i}]`)),
    }
  }
  if (o.potential_savings && typeof o.potential_savings === 'object') {
    o.potential_savings = {
      ...o.potential_savings,
      must_have: (o.potential_savings.must_have || []).map((it, i) => ({ ...it, ask: fixStr(it?.ask, `potential_savings.must_have[${i}]`) })),
      nice_to_have: (o.potential_savings.nice_to_have || []).map((it, i) => ({ ...it, ask: fixStr(it?.ask, `potential_savings.nice_to_have[${i}]`) })),
    }
  }
  return { output: o, rewrites }
}
