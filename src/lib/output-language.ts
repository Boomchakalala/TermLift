/**
 * Language of GENERATED content (analysis, playbook, emails, round deltas).
 * Static UI strings use next-intl; this module only answers three questions:
 *
 *   1. Which locale was a stored output generated in?  (`outputLocale`)
 *   2. Which language does a deal speak?               (`dealLocale` — Round 1's)
 *   3. Which strings in an output are prose that a translation may touch,
 *      and which are facts/enums that must never change? (`collectTranslatable`,
 *      `applyTranslations`)
 *
 * Pure: no I/O, no model calls. The model call lives in lib/claude/translate-output.ts.
 */

export type OutputLocale = 'en' | 'fr'
export const OUTPUT_LOCALES: readonly OutputLocale[] = ['en', 'fr'] as const

export function normalizeLocale(value: unknown): OutputLocale {
  return value === 'fr' ? 'fr' : 'en'
}

// ── 1. Locale of a stored output ─────────────────────────────────────────────

const FR_MARKERS = /\b(le|la|les|des|une|est|pour|avec|vous|votre|sur|pas|sont|dans|cette|ce|qui|que|au|aux|du)\b/gi
const FR_ACCENTS = /[éèêàçùâîôû]/g

/**
 * Cheap French detector for legacy outputs that carry no `generated_locale`.
 * Looks at the verdict and a few other prose fields only; defaults to English
 * (almost every historical deal is English). Never throws on odd shapes.
 */
export function detectLocaleFromProse(text: string): OutputLocale {
  if (!text) return 'en'
  const sample = text.slice(0, 1200)
  const words = (sample.match(/[A-Za-zÀ-ÿ']+/g) || []).length
  if (words < 6) return 'en'
  const markers = (sample.match(FR_MARKERS) || []).length
  const accents = (sample.match(FR_ACCENTS) || []).length
  // French prose: ~1 marker word per 6 words, plus accents. English: markers ≈ 0.
  return markers / words >= 0.08 && (accents > 0 || markers >= 6) ? 'fr' : 'en'
}

function proseSample(output: unknown): string {
  const o = output as Record<string, unknown> | null | undefined
  if (!o || typeof o !== 'object') return ''
  const parts: unknown[] = [
    o.verdict, o.score_label, o.score_rationale, o.price_insight,
    (o.quick_read as Record<string, unknown> | undefined)?.conclusion,
    ...((o.assumptions as unknown[]) || []).slice(0, 2),
    ...(((o.red_flags as Array<Record<string, unknown>>) || []).slice(0, 2).map((f) => f?.issue)),
  ]
  return parts.filter((p): p is string => typeof p === 'string').join(' ')
}

/** Locale an output was generated in: the stored flag, else a safe guess from its prose. */
export function outputLocale(output: unknown): OutputLocale {
  const o = output as Record<string, unknown> | null | undefined
  if (o && typeof o === 'object' && (o.generated_locale === 'en' || o.generated_locale === 'fr')) return o.generated_locale
  return detectLocaleFromProse(proseSample(output))
}

// ── 2. The deal's language ───────────────────────────────────────────────────

interface RoundLike { round_number: number; output_json?: unknown }

/**
 * A deal speaks the language its Round 1 was generated in. Every later
 * generation on that deal (Playbook, emails, rounds, close summary) uses this,
 * not the UI cookie, so a user switching the UI never makes a deal drift.
 */
export function dealLocale(rounds: RoundLike[] | null | undefined): OutputLocale {
  if (!rounds || rounds.length === 0) return 'en'
  const first = [...rounds].sort((a, b) => a.round_number - b.round_number)[0]
  return outputLocale(first?.output_json)
}

// ── 3. What a translation may touch ──────────────────────────────────────────

/**
 * Keys whose string values are facts, codes or identifiers — never translated.
 * Subtrees listed here are skipped entirely.
 */
const SKIP_KEYS = new Set([
  // identity / codes
  'id', 'deal_id', 'round_id', 'user_id', 'type', 'severity', 'score_category', 'verdict_type', 'category',
  'posture', 'status', 'provenance', 'schema_version', 'model_version', 'generated_locale', 'email_recommended_tone',
  'walkAwayFlexibility', 'benchmarkUsed', 'generatedAt', 'source', 'method', 'version', 'kind', 'tone', 'key',
  // money, dates, names — facts the rest of the app parses or matches on
  'currency', 'total_commitment', 'amount', 'total', 'renewal_date', 'signing_deadline', 'term', 'deal_type',
  'billing_payment', 'vendor', 'vendor_product', 'vendor_name', 'product_name', 'sku', 'title',
  // leverage levels
  'price_leverage', 'terms_leverage', 'structural_leverage', 'risk_leverage', 'ambiguity_leverage', 'savings_confidence',
])
const SKIP_SUBTREES = new Set([
  'snapshot', 'extraction', 'quote_facts', 'benchmark_input', 'market_benchmark', 'market_benchmark_query',
  'email_context', 'classification', 'vendor_offer', 'extracted_data', 'clamped',
])

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/
const ENUM_CAPS = /^[A-Z0-9_ ]+$/
const ENUM_SNAKE = /^[a-z0-9_]+$/

/** True when a string is prose worth translating rather than a code, number, date or name token. */
export function isProseValue(value: string): boolean {
  const s = value.trim()
  if (s.length < 3) return false
  if (!/[A-Za-zÀ-ÿ]{3}/.test(s)) return false           // no real word
  if (ISO_DATE.test(s)) return false
  if (ENUM_CAPS.test(s) || ENUM_SNAKE.test(s)) return false // HIGH, cash_flow, user_confirmed
  return true
}

export interface TranslatableString { path: string; value: string }

/** Every prose string in an output with its JSON path ("red_flags.0.issue"). Order is stable. */
export function collectTranslatable(output: unknown): TranslatableString[] {
  const out: TranslatableString[] = []
  const walk = (node: unknown, path: string, key: string | null) => {
    if (typeof node === 'string') {
      if (key !== null && SKIP_KEYS.has(key)) return
      if (isProseValue(node)) out.push({ path, value: node })
      return
    }
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, path ? `${path}.${i}` : String(i), key)); return }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (SKIP_SUBTREES.has(k)) continue
        walk(v, path ? `${path}.${k}` : k, k)
      }
    }
  }
  walk(output, '', null)
  return out
}

/**
 * Returns a deep copy of `output` with the given paths replaced by their
 * translations. Everything else (numbers, booleans, enums, arrays, order,
 * unknown keys) is byte-for-byte the original. Missing paths are ignored.
 */
export function applyTranslations<T>(output: T, translations: Record<string, string>): T {
  const clone = JSON.parse(JSON.stringify(output)) as T
  for (const [path, value] of Object.entries(translations)) {
    const parts = path.split('.')
    let node: unknown = clone
    for (const p of parts.slice(0, -1)) {
      if (node === null || typeof node !== 'object') { node = null; break }
      node = (node as Record<string, unknown>)[p]
    }
    if (node && typeof node === 'object') (node as Record<string, unknown>)[parts.at(-1) as string] = value
  }
  return clone
}
