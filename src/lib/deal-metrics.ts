/**
 * The ONE place that reads numbers out of a deal + its rounds.
 *
 * Before the redesign this logic was copy-pasted (with drift) in six files:
 * app/page, deal/[id]/page, AnalysisResultView, DealListClient, settings, dashboard.
 * Every screen now reads the same figure for the same deal.
 */
import { detectCurrency, formatCurrency, parseMoney, type Currency } from '@/lib/currency'
import type { VendorOffer } from '@/lib/vendor-offer'
import { snapTarget } from '@/lib/deal-target'

/** The analysis JSON is loosely typed across schema versions — read defensively. */
interface LooseOutput {
  vendor?: unknown
  category?: unknown
  score?: unknown
  red_flags?: unknown[]
  priority_points?: unknown[]
  potential_savings?: unknown
  /** The deal's single stored target (lib/deal-target.ts), snapped. */
  target_price?: unknown
  snapshot?: { total_commitment?: unknown; currency?: unknown; deal_type?: unknown; renewal_date?: unknown }
  commercial_facts?: { supplier?: unknown; total_value?: unknown; currency?: unknown }
}
interface SavingsItem { amount?: unknown; annual_impact?: unknown; confidence?: unknown }
interface SavingsObject { must_have?: SavingsItem[]; total?: unknown; optimistic_ceiling?: unknown; low?: unknown; high?: unknown }

// Loose input types — deals arrive from several Supabase selects with different shapes.
export interface RoundLike {
  id?: string
  round_number: number
  output_json?: unknown
  status?: string
  created_at?: string
  /** Round 2+: the vendor's offer with provenance (lib/vendor-offer.ts); present only on selects that ask for it. */
  vendor_offer?: VendorOffer | null
}
export interface DealLike {
  id: string
  vendor?: string | null
  title?: string | null
  deal_type?: string | null
  status?: string | null
  savings_amount?: number | null
  savings_percent?: number | null
  closed_at?: string | null
  created_at: string
  updated_at: string
  rounds?: RoundLike[] | null
}

const str = (v: unknown): string => (v == null ? '' : String(v))

export function getLatestRound(deal: DealLike): RoundLike | null {
  if (!deal.rounds || deal.rounds.length === 0) return null
  return [...deal.rounds].sort((a, b) => b.round_number - a.round_number)[0]
}

export function getLatestOutput(deal: DealLike): LooseOutput {
  const o = getLatestRound(deal)?.output_json
  return o && typeof o === 'object' ? (o as LooseOutput) : {}
}

/** "€12,500", "12.5K", "€8k–€12k", "12,500 saved" → number. Range → midpoint. */
export function parseSavingsAmount(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return v
  const s = String(v)
  const km = s.match(/([\d.,\s]+)\s*([KkMm])\b/)
  if (km) {
    const num = parseFloat(km[1].replace(/[\s,]/g, ''))
    return km[2].toUpperCase() === 'K' ? num * 1000 : num * 1000000
  }
  const range = s.match(/([\d.,\s]+)[-–—]\s*([\d.,\s]+)/)
  if (range) {
    const p = (x: string) => parseFloat(x.replace(/[€$£¥\s]/g, '').replace(/,/g, ''))
    const a = p(range[1]), b = p(range[2])
    if (!isNaN(a) && !isNaN(b) && a > 0 && b > 0) return (a + b) / 2
    if (!isNaN(a) && a > 0) return a
  }
  return parseMoney(s).amount
}

/**
 * Potential savings for a deal, from whichever shape the analysis produced:
 *  - { must_have: [{amount}] }        (current)
 *  - { total }                         (older)
 *  - { optimistic_ceiling }            (older still)
 *  - [ {annual_impact, confidence} ]   (legacy array; low-confidence items excluded)
 */
export function getPotentialSavings(deal: DealLike): number {
  const out = getLatestOutput(deal)
  // One stored target per deal (lib/deal-target.ts): the savings figure is quote − target_price, nothing else.
  const tp = out.target_price
  if (typeof tp === 'number' && tp > 0) {
    const total = parseMoney(getTotalCommitment(deal) || '0').amount
    const snapped = total > 0 ? snapTarget(tp, total) : tp
    if (total > snapped) return Math.round((total - snapped) * 100) / 100
  }
  const ps = out.potential_savings
  if (!ps) return 0
  if (Array.isArray(ps)) {
    const items = ps as SavingsItem[]
    const hasConf = items.some((i) => i.confidence)
    const kept = hasConf ? items.filter((i) => i.confidence !== 'low') : items
    return kept.reduce((s, i) => s + parseSavingsAmount(i.annual_impact), 0)
  }
  if (typeof ps !== 'object') return parseSavingsAmount(ps)
  const o = ps as SavingsObject
  if (o.must_have) return o.must_have.reduce((s, i) => s + parseSavingsAmount(i.amount), 0)
  if (o.total !== undefined) return parseSavingsAmount(o.total)
  if (o.optimistic_ceiling !== undefined) return parseSavingsAmount(o.optimistic_ceiling)
  return 0
}

export function getSavingsRange(deal: DealLike): { low: number; high: number } | null {
  const ps = getLatestOutput(deal).potential_savings as SavingsObject | undefined
  if (ps && typeof ps === 'object' && typeof ps.low === 'number' && typeof ps.high === 'number') return { low: ps.low, high: ps.high }
  return null
}

export function getAchievedSavings(deal: DealLike): number {
  return deal.savings_amount && deal.savings_amount > 0 ? deal.savings_amount : 0
}

export function getRedFlagCount(deal: DealLike): number {
  const o = getLatestOutput(deal)
  return o.red_flags?.length || o.priority_points?.length || 0
}

export type FlagSeverity = 'high' | 'medium' | 'low'

/**
 * Severity of one red flag. The model-assigned value is authoritative; older
 * deals without one fall back to the largest € amount mentioned in
 * why_it_matters (≥5k high, ≥1k medium). Used by the deal header tile AND the
 * flags accordion so they can never disagree.
 */
export function getFlagSeverity(flag: { severity?: unknown; why_it_matters?: unknown }): FlagSeverity {
  const assigned = String(flag.severity || '').toLowerCase()
  if (assigned === 'high' || assigned === 'medium' || assigned === 'low') return assigned
  const amounts = String(flag.why_it_matters || '').match(/[$€£]([\d,]+)/g)
  const max = amounts ? Math.max(...amounts.map((s) => parseInt(s.replace(/[^\d]/g, ''), 10) || 0)) : 0
  return max >= 5000 ? 'high' : max >= 1000 ? 'medium' : 'low'
}

export function getScore(deal: DealLike): number | undefined {
  const s = getLatestOutput(deal).score
  return typeof s === 'number' ? s : undefined
}

/** Vendor display name. The AI `title` can be "Vendor | Type | Date" — keep only the vendor segment. */
export function getVendorName(deal: DealLike): string {
  const o = getLatestOutput(deal)
  const raw = deal.vendor || str(o.vendor) || str(o.commercial_facts?.supplier) || deal.title || 'Deal'
  return String(raw).split('|')[0].trim() || 'Deal'
}

export function getTotalCommitment(deal: DealLike): string {
  const o = getLatestOutput(deal)
  if (o.snapshot?.total_commitment) return str(o.snapshot.total_commitment)
  if (o.commercial_facts?.total_value) return `${str(o.commercial_facts.total_value)} ${str(o.commercial_facts.currency)}`.trim()
  return ''
}

export function getTotalAmount(deal: DealLike): number {
  return parseMoney(getTotalCommitment(deal) || '0').amount
}

export function getDealCurrency(deal: DealLike): Currency {
  const explicit = str(getLatestOutput(deal).snapshot?.currency)
  if (explicit) return detectCurrency(explicit)
  return detectCurrency(getTotalCommitment(deal) || '')
}

/**
 * The deal's type for chips and lists. The STORED type wins (chosen on the form,
 * suggested by inference, or switched from the "Looks like a renewal" banner);
 * the model's free-text `snapshot.deal_type` is only a fallback for rows that
 * predate the selector. The snapshot card still shows what the document said.
 */
export function getDealType(deal: DealLike): string | undefined {
  if (deal.deal_type === 'Renewal') return 'Renewal'
  if (deal.deal_type === 'New') return 'New purchase'
  const fromOutput = str(getLatestOutput(deal).snapshot?.deal_type)
  return fromOutput || undefined
}

export function getRenewalDate(deal: DealLike): Date | null {
  const raw = str(getLatestOutput(deal).snapshot?.renewal_date)
  if (!raw || raw === 'not_stated') return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

/** Superset of every keyword list that existed across the old copies. */
export function normalizeCategory(raw: string | undefined | null): string {
  const lower = (raw || '').toLowerCase()
  if (!lower) return 'Other'
  // Software is split into the buckets an IT buyer actually budgets by. The
  // specific checks run before the generic SaaS catch-all on purpose.
  if (/(crm|\bsales\b|salesforce|hubspot|pipedrive)/.test(lower)) return 'CRM & Sales'
  if (/(security|identity|\bsso\b|\biam\b|cyber|okta|endpoint|firewall|antivirus)/.test(lower)) return 'Security & Identity'
  if (/(devops|developer|dev tool|source control|ci\/cd|\bgit|atlassian|jira)/.test(lower)) return 'Developer Tools & DevOps'
  if (/(infrastructure|monitoring|observability|hosting|server|\bapm\b|\bcdn\b|database|compute|\baws\b|azure|\bgcp\b|data ?center|cloud)/.test(lower)) return 'Infrastructure & Cloud'
  if (/(signature|e-?sign|document|contract management)/.test(lower)) return 'Documents & E-signature'
  if (/(analytics|business intelligence|\bbi\b|data (platform|warehouse|lake))/.test(lower)) return 'Data & Analytics'
  if (/(collaboration|productivity|workspace|microsoft 365|office 365|communication|messaging|\bchat\b|meeting|video|e-?mail|wiki|project management)/.test(lower)) return 'Collaboration & Productivity'
  if (/(saas|software|platform|tool|\bapp\b|subscription|licen[cs]e)/.test(lower)) return 'Other software'
  if (/(marketing|advertising|agency|media|seo|content)/.test(lower)) return 'Marketing & Advertising'
  if (/(consult|professional|advisory|accounting|staffing|design|freelance|landscap|tree)/.test(lower)) return 'Professional Services'
  if (/(office|supplies|facilities|cleaning|maintenance|furniture)/.test(lower)) return 'Office & Facilities'
  if (/(\bit\b|network|telecom|hardware|equipment)/.test(lower)) return 'Hardware & Telecom'
  if (/(logistics|shipping|delivery|courier|freight|warehouse)/.test(lower)) return 'Logistics & Delivery'
  if (/(legal|finance|insurance|banking|audit|compliance)/.test(lower)) return 'Legal & Finance'
  if (/(event|hospitality|catering|venue|travel|hotel)/.test(lower)) return 'Events & Hospitality'
  return 'Other'
}

export function getCategory(deal: DealLike): string {
  const o = getLatestOutput(deal)
  return normalizeCategory(str(o.category) || str(o.snapshot?.deal_type))
}

export function isClosed(deal: DealLike): boolean {
  return !!deal.status?.startsWith('closed_')
}
export function isWon(deal: DealLike): boolean {
  return deal.status === 'closed_won'
}

export function fmtMoney(amount: number, currency: Currency): string {
  return formatCurrency(Math.round(amount), currency)
}

/**
 * A clean number to say out loud. Used only for the quick-stage "≈ target"
 * tile and the anchor an email states; the analysis itself keeps exact
 * figures so every ask still adds up. Nearest 100 under 20k, nearest 500
 * under 200k, nearest 1,000 above.
 */
export function roundAnchor(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  const step = amount < 20_000 ? 100 : amount < 200_000 ? 500 : 1_000
  return Math.round(amount / step) * step
}

/** €12.4k / €1.2M — for tiles and chart labels. */
export function fmtCompact(n: number, currency: Currency): string {
  const sym = formatCurrency(0, currency).replace(/[\d.,\s]/g, '') || '€'
  if (n >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${sym}${Math.round(n / 1000)}k`
  if (n >= 1_000) return `${sym}${(n / 1000).toFixed(1)}k`
  return `${sym}${Math.round(n)}`
}

/**
 * The verdict headline for a score band. Replaces the stored `score_label`
 * ("Low risk, minor improvements possible"), which named a band without saying
 * what to do. Same language as the Insights score buckets: solid / push harder /
 * real leverage / push back.
 */
export function scoreHeadline(score: number, locale: string): string {
  const fr = locale === 'fr'
  if (score >= 80) return fr ? 'Devis solide — quelques gains encore possibles' : 'Solid quote — small gains still on the table'
  if (score >= 65) return fr ? 'Devis correct — quelques points à pousser' : 'Decent quote — push on a few points'
  if (score >= 45) return fr ? 'Vrai levier — négociez avant de signer' : 'Real leverage — negotiate before signing'
  if (score >= 25) return fr ? 'Devis faible — des problèmes sérieux à régler' : 'Weak quote — serious issues to fix first'
  return fr ? 'Ne signez pas en l’état' : 'Don’t sign this as it stands'
}
