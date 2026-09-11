/**
 * The persisted quote extract (2026-09-11 perf split).
 *
 * The document is read by the model exactly once, in the extraction call. Its
 * validated output — lines, totals, units, dates, deal type, renewal mechanics
 * and the verbatim term clauses — is stored on the round as
 * `output_json.extract`. Every later step on the same deal (flags, Playbook,
 * rescoring, emails, regenerate) reads this JSON and the stored text; nothing
 * sends the PDF/image to the model again.
 *
 * Pure functions only. No model calls here.
 */
import type { ExtractedFacts } from '@/lib/claude/extract'

export const EXTRACT_VERSION = 1 as const

export interface PersistedExtract {
  version: typeof EXTRACT_VERSION
  extracted_at: string
  /** Which model produced the facts (for audits; never used to branch). */
  model: string | null
  /** The extraction call's output after code validation (total normalised, line-sum reconciled). */
  facts: ExtractedFacts
}

export type TermClause = { topic: string; text: string }

const TOPICS = new Set(['auto_renewal', 'termination', 'price_increase', 'payment', 'commitment', 'validity', 'sla', 'liability', 'exclusivity', 'data_exit', 'discount', 'other'])

/** Clauses the model copied, tidied: short, deduplicated, topic normalised, at most 15. */
export function sanitizeTermClauses(raw: unknown): TermClause[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: TermClause[] = []
  for (const item of raw) {
    const r = (item && typeof item === 'object' ? item : {}) as { topic?: unknown; text?: unknown }
    const text = typeof r.text === 'string' ? r.text.replace(/\s+/g, ' ').trim().slice(0, 400) : ''
    if (text.length < 8) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const topic = typeof r.topic === 'string' && TOPICS.has(r.topic) ? r.topic : 'other'
    out.push({ topic, text })
    if (out.length >= 15) break
  }
  return out
}

/** Build the record stored on the round from the validated facts. */
export function buildPersistedExtract(facts: ExtractedFacts, model: string | null, now = new Date()): PersistedExtract {
  return {
    version: EXTRACT_VERSION,
    extracted_at: now.toISOString(),
    model,
    facts: { ...facts, term_clauses: sanitizeTermClauses(facts.term_clauses) },
  }
}

/** The stored extract on a round's output, when it has one. */
export function readPersistedExtract(output: unknown): PersistedExtract | null {
  const o = (output && typeof output === 'object' ? output : {}) as { extract?: unknown }
  const e = o.extract as Partial<PersistedExtract> | null | undefined
  if (!e || typeof e !== 'object' || !e.facts || typeof e.facts !== 'object') return null
  const facts = e.facts as ExtractedFacts
  if (!facts.vendor || !facts.total_commitment) return null
  return { version: EXTRACT_VERSION, extracted_at: String(e.extracted_at || ''), model: e.model ?? null, facts }
}

/**
 * The extraction facts a later step should work from: the persisted extract when
 * the round has one, else (rounds analysed before 2026-09-11) the same slim
 * rebuild from the snapshot the Playbook route always used.
 */
export function factsFromOutput(output: unknown, fallbackDealType: string): ExtractedFacts {
  const stored = readPersistedExtract(output)
  if (stored) return stored.facts
  const o = (output || {}) as { vendor?: string; category?: string; description?: string; contact_name?: string; snapshot?: Record<string, string | undefined> }
  const s = o.snapshot || {}
  return {
    vendor: o.vendor || '',
    vendor_product: s.vendor_product || o.vendor || '',
    category: o.category,
    description: o.description,
    term: s.term || '',
    total_commitment: s.total_commitment || '',
    billing_payment: s.billing_payment || '',
    pricing_model: s.pricing_model || '',
    currency: s.currency || 'USD',
    deal_type: s.deal_type || fallbackDealType,
    contact_name: o.contact_name,
    renewal_date: s.renewal_date,
    signing_deadline: s.signing_deadline,
    quote_number: s.quote_number,
    quote_created: s.quote_created,
    quote_expires: s.quote_expires,
    current_sub_end: s.current_sub_end,
  }
}

const fmtNum = (n: unknown): string => (typeof n === 'number' && Number.isFinite(n) ? String(n) : '')

/**
 * The document view a later model call receives INSTEAD of the file or the full
 * quote text: a compact, deterministic rendering of the extract. Same input →
 * same text, so the Playbook prompt is stable across runs and cacheable.
 */
export function renderExtractForModel(extract: PersistedExtract): string {
  const f = extract.facts
  const lines: string[] = []
  lines.push('STRUCTURED QUOTE EXTRACT (the document itself is not attached; this extract is the only view of it)')
  lines.push(`Vendor: ${f.vendor}`)
  if (f.vendor_product) lines.push(`Product / service: ${f.vendor_product}`)
  if (f.category) lines.push(`Category: ${f.category}`)
  if (f.description) lines.push(`Description: ${f.description}`)
  lines.push(`Total commitment: ${f.total_commitment}${f.currency ? ` (${f.currency})` : ''}`)
  if (f.term) lines.push(`Term: ${f.term}${f.term_months ? ` (${f.term_months} months)` : ''}`)
  if (f.billing_payment) lines.push(`Billing / payment: ${f.billing_payment}`)
  if (f.pricing_model) lines.push(`Pricing model: ${f.pricing_model}${f.pricing_metric ? ` [${f.pricing_metric}]` : ''}`)
  lines.push(`Deal type as printed: ${f.deal_type || 'not stated'}`)
  if (f.contact_name) lines.push(`Vendor contact (first name): ${f.contact_name}`)

  const dates: string[] = []
  if (f.quote_number) dates.push(`quote number ${f.quote_number}`)
  if (f.quote_created) dates.push(`issued ${f.quote_created}`)
  if (f.quote_expires) dates.push(`valid until ${f.quote_expires}`)
  else if (f.signing_deadline) dates.push(`signing deadline ${f.signing_deadline}`)
  if (f.renewal_date) dates.push(`renewal date ${f.renewal_date}`)
  if (f.current_sub_end) dates.push(`current subscription ends ${f.current_sub_end}`)
  if (dates.length) lines.push(`Dates: ${dates.join('; ')}`)

  const renewal: string[] = []
  if (typeof f.auto_renew === 'boolean') renewal.push(`auto-renews: ${f.auto_renew ? 'yes' : 'no'}`)
  if (typeof f.notice_days === 'number') renewal.push(`notice to cancel: ${f.notice_days} days`)
  if (typeof f.escalation_min_pct === 'number') renewal.push(`minimum renewal increase: ${f.escalation_min_pct}%`)
  if (typeof f.escalation_cap_pct === 'number') renewal.push(`renewal increase cap: ${f.escalation_cap_pct}%`)
  if (typeof f.extra_increase_allowed === 'boolean') renewal.push(`vendor may increase beyond the stated %: ${f.extra_increase_allowed ? 'yes' : 'no'}`)
  if (renewal.length) lines.push(`Renewal mechanics: ${renewal.join('; ')}`)

  const items = Array.isArray(f.line_items) ? f.line_items : []
  if (items.length) {
    lines.push('')
    lines.push('LINE ITEMS (as printed; qty × list → discount → net unit → line total; term months when the line states its own)')
    items.forEach((li, i) => {
      const parts = [
        `${i + 1}. ${li.description || 'line'}`,
        li.sku ? `sku ${li.sku}` : '',
        fmtNum(li.quantity) ? `qty ${fmtNum(li.quantity)}` : '',
        fmtNum(li.list_unit_price) ? `list ${fmtNum(li.list_unit_price)}` : '',
        fmtNum(li.discount_pct) ? `discount ${fmtNum(li.discount_pct)}%` : '',
        fmtNum(li.net_unit_price) ? `net unit ${fmtNum(li.net_unit_price)}` : '',
        fmtNum(li.line_total) ? `line total ${fmtNum(li.line_total)}` : '',
        fmtNum(li.term_months) ? `${fmtNum(li.term_months)} months` : '',
      ].filter(Boolean)
      lines.push(parts.join(' | '))
    })
  } else if (f.main_line && (f.main_line.description || f.main_line.line_total != null)) {
    const m = f.main_line
    lines.push('')
    lines.push(`MAIN LINE: ${[m.description, fmtNum(m.quantity) && `qty ${fmtNum(m.quantity)}`, fmtNum(m.unit_price) && `unit ${fmtNum(m.unit_price)}${m.unit_period ? `/${m.unit_period}` : ''}`, fmtNum(m.list_unit_price) && `list ${fmtNum(m.list_unit_price)}`, fmtNum(m.line_total) && `line total ${fmtNum(m.line_total)}`].filter(Boolean).join(' | ')}`)
  }
  if (Array.isArray(f.printed_line_totals) && f.printed_line_totals.length) {
    lines.push(`Printed line totals: ${f.printed_line_totals.map(fmtNum).filter(Boolean).join(', ')}`)
  }

  const clauses = sanitizeTermClauses(f.term_clauses)
  if (clauses.length) {
    lines.push('')
    lines.push('TERM CLAUSES (verbatim from the document)')
    clauses.forEach((c) => lines.push(`- [${c.topic}] ${c.text}`))
  }
  const evidence = Array.isArray(f.deal_type_evidence) ? f.deal_type_evidence.filter((s) => typeof s === 'string' && s.trim()) : []
  if (evidence.length) {
    lines.push('')
    lines.push(`DEAL-TYPE EVIDENCE (verbatim): ${evidence.map((e) => `"${e.trim()}"`).join('; ')}`)
  }
  return lines.join('\n')
}
