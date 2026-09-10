// ─────────────────────────────────────────────────────────────────────────────
// Deterministic quote scoring.
//
// The LLM no longer returns numeric scores. It returns a structured *extraction*
// of the quote's facts (fees, cancellation/payment terms, vendor rights, TBD line
// items, leverage factors). computeScores() turns that extraction into
// pricing / terms / leverage / overall scores using fixed, auditable rules.
//
// Same input ALWAYS produces the same output — no randomness, no clock, no I/O.
// Every point movement is recorded as a Deduction so the UI can render the
// breakdown ("7% administration charge  −14").
// ─────────────────────────────────────────────────────────────────────────────

export type FeeType = 'admin' | 'processing' | 'gratuity' | 'tax' | 'other'

export interface Fee {
  name: string
  type: FeeType
  /** Fee as a percentage of subtotal, when expressed that way. */
  percentage: number | null
  /** Fee as an absolute amount, when expressed that way. */
  dollarAmount: number | null
  isAvoidable: boolean
  isDisclosedAsNonService: boolean
}

export interface CancellationTerms {
  /** Human-readable refund schedule / tiers (for display, not scoring). */
  refundSchedule: string | null
  /** True if the buyer is already inside a cancellation/penalty window. */
  buyerInsideWindow: boolean
  /**
   * Percentage the vendor retains if the buyer cancels inside the window.
   * 100 = fully non-refundable, 0/null = no retention. Drives the one-sided
   * cancellation deduction deterministically.
   */
  retentionPctInsideWindow: number | null
  forceMajeurePresent: boolean
  rescheduleOption: boolean
  rescheduleFeePct: number | null
}

export interface PaymentTerms {
  depositPct: number | null
  balanceDueDaysBeforeDelivery: number | null
  achOffered: boolean
  netTerms: number | null
}

export interface VendorRights {
  unilateralSubstitution: boolean
  mandatoryMarketing: boolean
  /** Whether the buyer receives reciprocal value for mandatory obligations. */
  reciprocalValue: boolean
}

export interface TbdLineItem {
  description: string
  dollarAmount: number
}

export interface LeverageFactors {
  competingQuoteInHand: boolean
  daysToDeadline: number | null
  soleSource: boolean
  dealSizeSignificant: boolean
  buyerInsidePenaltyWindow: boolean
}

/**
 * Renewal mechanics as fields (2026-09-11). Null = not stated in the document.
 * Seeded from the extraction call's own fields when it read them, else from
 * the analysis call's extraction block; both are literal reads, never inferred.
 */
export interface RenewalTerms {
  autoRenew: boolean | null
  noticeDays: number | null
  escalationMinPct: number | null
  escalationCapPct: number | null
  extraIncreaseAllowed: boolean | null
}

/** Dates printed on the quote, ISO `YYYY-MM-DD` when parseable, else the printed string. */
export interface QuoteDates {
  created: string | null
  /** Quote validity / signing deadline. */
  expires: string | null
  /** End date of a current subscription the quote mentions (renewal signal). */
  currentSubEnd: string | null
}

/** Everything computeScores() needs. The persisted extraction is a superset. */
export interface ExtractionResult {
  /** Total contract value, from the verified financial facts. */
  contractTotal: number
  /** Pre-fee subtotal if known; defaults to contractTotal. */
  subtotal?: number
  /** Whether pricing is broken out line-by-line. */
  pricingItemized: boolean
  fees: Fee[]
  cancellationTerms: CancellationTerms
  paymentTerms: PaymentTerms
  vendorRights: VendorRights
  tbdLineItems: TbdLineItem[]
  leverageFactors: LeverageFactors
  renewalTerms?: RenewalTerms
  quoteDates?: QuoteDates
}

export interface ScoreOptions {
  /** Server date (`YYYY-MM-DD`). When the quote's expiry is before it, the deadline carries no leverage either way. */
  asOf?: string
  /** HIGH-severity red flags in the `terms` category (LLM + code). Caps Terms at 75 (one) / 65 (two or more). */
  highTermsFlagCount?: number
}

export const EMPTY_RENEWAL_TERMS: RenewalTerms = { autoRenew: null, noticeDays: null, escalationMinPct: null, escalationCapPct: null, extraIncreaseAllowed: null }
export const EMPTY_QUOTE_DATES: QuoteDates = { created: null, expires: null, currentSubEnd: null }

export interface Deduction {
  category: 'pricing' | 'terms' | 'leverage'
  label: string
  /** Negative for a deduction, positive for an addition. */
  points: number
}

export interface ScoreResult {
  pricing: number
  terms: number
  leverage: number
  overall: number
  deductions: Deduction[]
}

// ── constants ───────────────────────────────────────────────────────────────
const FEE_STACK_CAP = 40
const TBD_ITEM_CAP = 15
const FLOOR = 5
const LEVERAGE_NEUTRAL = 50
const LEVERAGE_MIN = 5
const LEVERAGE_MAX = 95
const WEIGHTS = { pricing: 0.4, terms: 0.35, leverage: 0.25 }

// ── helpers ─────────────────────────────────────────────────────────────────
function fmtPct(pct: number): string {
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`
}

function sumPoints(deductions: Deduction[], category: Deduction['category']): number {
  return deductions.filter((d) => d.category === category).reduce((s, d) => s + d.points, 0)
}

// ── dates ───────────────────────────────────────────────────────────────────
/** `YYYY-MM-DD` from most printed date styles, else null. Pure: no clock. */
export function toIsoDate(raw: unknown): string | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s || /^(not[_ ]stated|unknown|n\/a|none)$/i.test(s)) return null
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  // 11/01/2026 or 11-01-2026: ambiguous day/month; treat as D/M/Y when the first part exceeds 12.
  const dmy = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/)
  if (dmy) {
    const a = parseInt(dmy[1], 10), b = parseInt(dmy[2], 10)
    const [d, m] = a > 12 ? [a, b] : [b, a]
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${dmy[3]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  // Date.parse gives LOCAL midnight for a printed date; format the local components so the
  // calendar day never shifts with the server's timezone offset.
  const t = Date.parse(s.replace(/(\d+)(st|nd|rd|th)\b/g, '$1'))
  if (Number.isFinite(t)) {
    const d = new Date(t)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return null
}

/** True when `expires` is a real date strictly before `asOf` (both `YYYY-MM-DD`). */
export function isExpired(expires: string | null | undefined, asOf: string | null | undefined): boolean {
  const e = toIsoDate(expires)
  const a = toIsoDate(asOf)
  return !!e && !!a && e < a
}

// ── main ────────────────────────────────────────────────────────────────────
export function computeScores(extraction: ExtractionResult, options: ScoreOptions = {}): ScoreResult {
  const deductions: Deduction[] = []
  const contractTotal = extraction.contractTotal > 0 ? extraction.contractTotal : 0
  const subtotal = extraction.subtotal && extraction.subtotal > 0 ? extraction.subtotal : contractTotal

  // ─── PRICING (start 100) ───────────────────────────────────────────────────
  // Avoidable / non-service fees: each deducts 2x its percentage of subtotal.
  // The whole fee stack is capped at -40.
  let feeStack = 0
  for (const fee of extraction.fees || []) {
    if (!(fee.isAvoidable || fee.isDisclosedAsNonService)) continue

    let pct = fee.percentage
    if ((pct == null || Number.isNaN(pct)) && fee.dollarAmount != null && subtotal > 0) {
      pct = (fee.dollarAmount / subtotal) * 100
    }
    if (pct == null || !(pct > 0)) continue

    let ded = 2 * pct
    if (feeStack + ded > FEE_STACK_CAP) ded = FEE_STACK_CAP - feeStack // clamp the stack
    if (ded <= 0) break

    feeStack += ded
    deductions.push({ category: 'pricing', label: `${fmtPct(pct)} ${fee.name}`, points: -Math.round(ded) })
    if (feeStack >= FEE_STACK_CAP) break
  }

  // TBD line items: each deducts min(15, dollarAmount / contractTotal * 100).
  for (const item of extraction.tbdLineItems || []) {
    if (!(item.dollarAmount > 0) || contractTotal <= 0) continue
    const ded = Math.min(TBD_ITEM_CAP, (item.dollarAmount / contractTotal) * 100)
    if (ded <= 0) continue
    deductions.push({ category: 'pricing', label: `TBD: ${item.description}`, points: -Math.round(ded) })
  }

  // Pricing not itemized: -10.
  if (!extraction.pricingItemized) {
    deductions.push({ category: 'pricing', label: 'Pricing not itemized', points: -10 })
  }

  const pricing = Math.max(FLOOR, 100 + sumPoints(deductions, 'pricing'))

  // ─── TERMS (start 100) ──────────────────────────────────────────────────────
  const c = extraction.cancellationTerms
  if (c?.buyerInsideWindow && c.retentionPctInsideWindow != null) {
    if (c.retentionPctInsideWindow >= 100) {
      deductions.push({ category: 'terms', label: 'One-sided cancellation: 100% retained inside window', points: -25 })
    } else if (c.retentionPctInsideWindow > 0) {
      deductions.push({ category: 'terms', label: 'Partial-retention cancellation inside window', points: -15 })
    }
  }
  if (c && !c.forceMajeurePresent) {
    deductions.push({ category: 'terms', label: 'No force majeure clause', points: -10 })
  }

  const v = extraction.vendorRights
  if (v?.unilateralSubstitution) {
    deductions.push({ category: 'terms', label: 'Vendor can substitute unilaterally', points: -10 })
  }
  if (v?.mandatoryMarketing && !v.reciprocalValue) {
    deductions.push({ category: 'terms', label: 'Mandatory obligations with no reciprocal value', points: -10 })
  }

  const p = extraction.paymentTerms
  if (p && p.depositPct != null && p.depositPct > 40 && p.balanceDueDaysBeforeDelivery != null && p.balanceDueDaysBeforeDelivery > 7) {
    deductions.push({ category: 'terms', label: 'Deposit >40% with balance due early', points: -10 })
  }

  // Renewal mechanics (fields, not prose — see RenewalTerms).
  const rt = extraction.renewalTerms
  if (rt?.autoRenew && rt.noticeDays != null && rt.noticeDays >= 90) {
    deductions.push({ category: 'terms', label: `Auto-renewal with ${rt.noticeDays}-day notice window`, points: -15 })
  }
  if (rt && rt.escalationMinPct != null && rt.escalationCapPct == null) {
    deductions.push({ category: 'terms', label: `Renewal uplift of at least ${fmtPct(rt.escalationMinPct)} with no cap`, points: -20 })
  }
  if (rt?.extraIncreaseAllowed) {
    deductions.push({ category: 'terms', label: 'Vendor may raise renewal pricing beyond the stated increase', points: -10 })
  }

  let terms = Math.max(FLOOR, 100 + sumPoints(deductions, 'terms'))

  // HIGH-severity terms flags cap the bar so a serious clause the extractor
  // could not express as a field still moves the score. Recorded as a
  // deduction so the bar always reconciles with its list.
  const highTerms = options.highTermsFlagCount ?? 0
  const termsCap = highTerms >= 2 ? 65 : highTerms === 1 ? 75 : null
  if (termsCap != null && terms > termsCap) {
    deductions.push({ category: 'terms', label: highTerms >= 2 ? `${highTerms} high-severity terms issues (cap 65)` : '1 high-severity terms issue (cap 75)', points: termsCap - terms })
    terms = termsCap
  }

  // ─── LEVERAGE (start 50, neutral) ───────────────────────────────────────────
  const l = extraction.leverageFactors
  if (l?.competingQuoteInHand) deductions.push({ category: 'leverage', label: 'Competing quote in hand', points: 20 })
  if (l?.dealSizeSignificant) deductions.push({ category: 'leverage', label: 'Deal size significant for vendor', points: 10 })
  if (l?.buyerInsidePenaltyWindow) deductions.push({ category: 'leverage', label: 'Buyer inside penalty window', points: -20 })
  if (l?.soleSource) deductions.push({ category: 'leverage', label: 'Sole-source vendor', points: -15 })
  // An expired quote carries no deadline leverage either way: the dates are historical.
  const expired = isExpired(extraction.quoteDates?.expires, options.asOf)
  if (!expired && l?.daysToDeadline != null) {
    if (l.daysToDeadline > 30) deductions.push({ category: 'leverage', label: 'Over 30 days to deadline', points: 10 })
    else if (l.daysToDeadline < 14) deductions.push({ category: 'leverage', label: 'Under 14 days to deadline', points: -10 })
  }

  const leverage = Math.min(
    LEVERAGE_MAX,
    Math.max(LEVERAGE_MIN, LEVERAGE_NEUTRAL + sumPoints(deductions, 'leverage')),
  )

  // ─── OVERALL (weighted) ─────────────────────────────────────────────────────
  const overall = Math.round(pricing * WEIGHTS.pricing + terms * WEIGHTS.terms + leverage * WEIGHTS.leverage)

  return { pricing, terms, leverage, overall, deductions }
}

// ── label band ───────────────────────────────────────────────────────────────
/** Qualitative label for the overall score band (mirrors the legacy thresholds). */
export function scoreLabel(overall: number): string {
  // Stored for reference/admin tooling; the deal page renders scoreHeadline() from lib/deal-metrics (localised).
  if (overall >= 80) return 'Solid quote — small gains still on the table'
  if (overall >= 65) return 'Decent quote — push on a few points'
  if (overall >= 45) return 'Real leverage — negotiate before signing'
  if (overall >= 25) return 'Weak quote — serious issues to fix first'
  return 'Don’t sign this as it stands'
}

// ── extraction normalizer ─────────────────────────────────────────────────────
function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}
function toBool(v: unknown, dflt: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (v == null) return dflt
  if (typeof v === 'string') return /^(true|yes|y|1)$/i.test(v.trim())
  return dflt
}

/**
 * Coerce the LLM's loosely-typed `extraction` object into a strict ExtractionResult.
 * Defaults are conservative — when a fact is missing we assume the benign value
 * (force majeure present, reciprocal value, pricing itemized) so absent data never
 * invents a deduction. contractTotal comes from the verified financial facts, not the LLM.
 */
export function normalizeExtraction(raw: any, contractTotal: number): ExtractionResult {
  const r = raw || {}
  const ct = r.cancellationTerms || {}
  const pt = r.paymentTerms || {}
  const vr = r.vendorRights || {}
  const lf = r.leverageFactors || {}
  const validType = (t: unknown): FeeType =>
    (['admin', 'processing', 'gratuity', 'tax', 'other'] as const).includes(t as FeeType) ? (t as FeeType) : 'other'

  return {
    contractTotal: Number.isFinite(contractTotal) && contractTotal > 0 ? contractTotal : 0,
    subtotal: toNum(r.subtotal) ?? undefined,
    pricingItemized: toBool(r.pricingItemized, true),
    fees: Array.isArray(r.fees)
      ? r.fees.map((f: any) => ({
          name: String(f?.name || 'fee'),
          type: validType(f?.type),
          percentage: toNum(f?.percentage),
          dollarAmount: toNum(f?.dollarAmount),
          isAvoidable: toBool(f?.isAvoidable, false),
          isDisclosedAsNonService: toBool(f?.isDisclosedAsNonService, false),
        }))
      : [],
    cancellationTerms: {
      refundSchedule: ct.refundSchedule != null ? String(ct.refundSchedule) : null,
      buyerInsideWindow: toBool(ct.buyerInsideWindow, false),
      retentionPctInsideWindow: toNum(ct.retentionPctInsideWindow),
      forceMajeurePresent: toBool(ct.forceMajeurePresent, true),
      rescheduleOption: toBool(ct.rescheduleOption, false),
      rescheduleFeePct: toNum(ct.rescheduleFeePct),
    },
    paymentTerms: {
      depositPct: toNum(pt.depositPct),
      balanceDueDaysBeforeDelivery: toNum(pt.balanceDueDaysBeforeDelivery),
      achOffered: toBool(pt.achOffered, false),
      netTerms: toNum(pt.netTerms),
    },
    vendorRights: {
      unilateralSubstitution: toBool(vr.unilateralSubstitution, false),
      mandatoryMarketing: toBool(vr.mandatoryMarketing, false),
      reciprocalValue: toBool(vr.reciprocalValue, true),
    },
    tbdLineItems: Array.isArray(r.tbdLineItems)
      ? r.tbdLineItems
          .map((t: any) => ({ description: String(t?.description || 'TBD item'), dollarAmount: toNum(t?.dollarAmount) ?? 0 }))
          .filter((t: TbdLineItem) => t.dollarAmount > 0)
      : [],
    leverageFactors: {
      competingQuoteInHand: toBool(lf.competingQuoteInHand, false),
      daysToDeadline: toNum(lf.daysToDeadline),
      soleSource: toBool(lf.soleSource, false),
      dealSizeSignificant: toBool(lf.dealSizeSignificant, false),
      buyerInsidePenaltyWindow: toBool(lf.buyerInsidePenaltyWindow, false),
    },
    renewalTerms: normalizeRenewalTerms(r.renewalTerms),
    quoteDates: normalizeQuoteDates(r.quoteDates),
  }
}

/** Tri-state boolean: true/false when stated, null when the document is silent. */
function toBoolOrNull(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (v == null || v === '') return null
  if (typeof v === 'string') {
    if (/^(true|yes|y|1)$/i.test(v.trim())) return true
    if (/^(false|no|n|0)$/i.test(v.trim())) return false
  }
  return null
}

export function normalizeRenewalTerms(raw: unknown): RenewalTerms {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pct = (v: unknown) => { const n = toNum(v); return n != null && n >= 0 && n <= 100 ? n : null }
  const days = (v: unknown) => { const n = toNum(v); return n != null && n >= 0 && n <= 365 ? Math.round(n) : null }
  return {
    autoRenew: toBoolOrNull(r.autoRenew),
    noticeDays: days(r.noticeDays),
    escalationMinPct: pct(r.escalationMinPct),
    escalationCapPct: pct(r.escalationCapPct),
    extraIncreaseAllowed: toBoolOrNull(r.extraIncreaseAllowed),
  }
}

export function normalizeQuoteDates(raw: unknown): QuoteDates {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const keep = (v: unknown) => toIsoDate(v) ?? (typeof v === 'string' && v.trim() && !/^(not[_ ]stated|unknown|n\/a|none)$/i.test(v.trim()) ? v.trim().slice(0, 40) : null)
  return { created: keep(r.created), expires: keep(r.expires), currentSubEnd: keep(r.currentSubEnd) }
}

/**
 * Seed the renewal/date fields from the extraction call's own reads (schema A)
 * when the analysis call left them null. The dedicated extraction is the more
 * literal read, so its non-null values win.
 */
export function seedFromFacts(extraction: ExtractionResult, facts: {
  auto_renew?: unknown; notice_days?: unknown; escalation_min_pct?: unknown; escalation_cap_pct?: unknown; extra_increase_allowed?: unknown
  quote_created?: unknown; quote_expires?: unknown; current_sub_end?: unknown; signing_deadline?: unknown
} | null | undefined): ExtractionResult {
  if (!facts) return extraction
  const fromFacts = normalizeRenewalTerms({
    autoRenew: facts.auto_renew, noticeDays: facts.notice_days, escalationMinPct: facts.escalation_min_pct,
    escalationCapPct: facts.escalation_cap_pct, extraIncreaseAllowed: facts.extra_increase_allowed,
  })
  const dates = normalizeQuoteDates({ created: facts.quote_created, expires: facts.quote_expires ?? facts.signing_deadline, currentSubEnd: facts.current_sub_end })
  const cur = extraction.renewalTerms ?? EMPTY_RENEWAL_TERMS
  const curDates = extraction.quoteDates ?? EMPTY_QUOTE_DATES
  return {
    ...extraction,
    renewalTerms: {
      autoRenew: fromFacts.autoRenew ?? cur.autoRenew,
      noticeDays: fromFacts.noticeDays ?? cur.noticeDays,
      escalationMinPct: fromFacts.escalationMinPct ?? cur.escalationMinPct,
      escalationCapPct: fromFacts.escalationCapPct ?? cur.escalationCapPct,
      extraIncreaseAllowed: fromFacts.extraIncreaseAllowed ?? cur.extraIncreaseAllowed,
    },
    quoteDates: {
      created: dates.created ?? curDates.created,
      expires: dates.expires ?? curDates.expires,
      currentSubEnd: dates.currentSubEnd ?? curDates.currentSubEnd,
    },
  }
}

/**
 * Merge the Playbook's extraction over the fast pass's. A stated value from
 * the deeper read replaces a null or default from the fast read; `contractTotal`
 * always comes from the verified facts and never changes.
 */
export function mergeExtractions(fast: ExtractionResult, deep: ExtractionResult | null | undefined): ExtractionResult {
  if (!deep) return fast
  const pick = <T>(a: T, b: T): T => (b == null ? a : b)
  const boolStated = (a: boolean, b: boolean, dflt: boolean) => (b !== dflt ? b : a)
  return {
    contractTotal: fast.contractTotal,
    subtotal: pick(fast.subtotal, deep.subtotal),
    pricingItemized: boolStated(fast.pricingItemized, deep.pricingItemized, true),
    fees: deep.fees.length ? deep.fees : fast.fees,
    cancellationTerms: {
      refundSchedule: pick(fast.cancellationTerms.refundSchedule, deep.cancellationTerms.refundSchedule),
      buyerInsideWindow: fast.cancellationTerms.buyerInsideWindow || deep.cancellationTerms.buyerInsideWindow,
      retentionPctInsideWindow: pick(fast.cancellationTerms.retentionPctInsideWindow, deep.cancellationTerms.retentionPctInsideWindow),
      forceMajeurePresent: boolStated(fast.cancellationTerms.forceMajeurePresent, deep.cancellationTerms.forceMajeurePresent, true),
      rescheduleOption: fast.cancellationTerms.rescheduleOption || deep.cancellationTerms.rescheduleOption,
      rescheduleFeePct: pick(fast.cancellationTerms.rescheduleFeePct, deep.cancellationTerms.rescheduleFeePct),
    },
    paymentTerms: {
      depositPct: pick(fast.paymentTerms.depositPct, deep.paymentTerms.depositPct),
      balanceDueDaysBeforeDelivery: pick(fast.paymentTerms.balanceDueDaysBeforeDelivery, deep.paymentTerms.balanceDueDaysBeforeDelivery),
      achOffered: fast.paymentTerms.achOffered || deep.paymentTerms.achOffered,
      netTerms: pick(fast.paymentTerms.netTerms, deep.paymentTerms.netTerms),
    },
    vendorRights: {
      unilateralSubstitution: fast.vendorRights.unilateralSubstitution || deep.vendorRights.unilateralSubstitution,
      mandatoryMarketing: fast.vendorRights.mandatoryMarketing || deep.vendorRights.mandatoryMarketing,
      reciprocalValue: boolStated(fast.vendorRights.reciprocalValue, deep.vendorRights.reciprocalValue, true),
    },
    tbdLineItems: deep.tbdLineItems.length ? deep.tbdLineItems : fast.tbdLineItems,
    leverageFactors: {
      competingQuoteInHand: fast.leverageFactors.competingQuoteInHand || deep.leverageFactors.competingQuoteInHand,
      daysToDeadline: pick(fast.leverageFactors.daysToDeadline, deep.leverageFactors.daysToDeadline),
      soleSource: fast.leverageFactors.soleSource || deep.leverageFactors.soleSource,
      dealSizeSignificant: fast.leverageFactors.dealSizeSignificant || deep.leverageFactors.dealSizeSignificant,
      buyerInsidePenaltyWindow: fast.leverageFactors.buyerInsidePenaltyWindow || deep.leverageFactors.buyerInsidePenaltyWindow,
    },
    renewalTerms: {
      autoRenew: pick(fast.renewalTerms?.autoRenew ?? null, deep.renewalTerms?.autoRenew ?? null),
      noticeDays: pick(fast.renewalTerms?.noticeDays ?? null, deep.renewalTerms?.noticeDays ?? null),
      escalationMinPct: pick(fast.renewalTerms?.escalationMinPct ?? null, deep.renewalTerms?.escalationMinPct ?? null),
      escalationCapPct: pick(fast.renewalTerms?.escalationCapPct ?? null, deep.renewalTerms?.escalationCapPct ?? null),
      extraIncreaseAllowed: pick(fast.renewalTerms?.extraIncreaseAllowed ?? null, deep.renewalTerms?.extraIncreaseAllowed ?? null),
    },
    quoteDates: {
      created: pick(fast.quoteDates?.created ?? null, deep.quoteDates?.created ?? null),
      expires: pick(fast.quoteDates?.expires ?? null, deep.quoteDates?.expires ?? null),
      currentSubEnd: pick(fast.quoteDates?.currentSubEnd ?? null, deep.quoteDates?.currentSubEnd ?? null),
    },
  }
}

/** Count of HIGH-severity flags in the terms category — the input to the Terms cap. */
export function countHighTermsFlags(flags: Array<{ severity?: unknown; score_category?: unknown }> | null | undefined): number {
  return (flags || []).filter((f) => String(f?.severity || '').toLowerCase() === 'high' && String(f?.score_category || '').toLowerCase() === 'terms').length
}
