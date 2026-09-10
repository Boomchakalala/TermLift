import type { QuoteClassificationType } from '../schemas'
import type { ExtractedFacts } from './extract'
import { termToMonths } from '@/lib/benchmark/normalize'

/**
 * Guard between the Haiku classifier and everything that consumes its output.
 *
 * The classifier used to receive "(see attached document)" with nothing
 * attached for PDF uploads and answered "Unable to classify without access to
 * the attached document" with a 0-0% savings frame, and that answer was
 * stored and used. The routes now hand it the extracted text; this module is
 * the safety net: a classification that says it could not read the document
 * is rejected and rebuilt from the extraction call's own facts.
 */

const UNREADABLE = /\b(unable|cannot|can't|could not|couldn't|not able|no access|without access|not provided|no document|no quote|not visible|not attached|missing document|insufficient information|no content)\b/i

export function isUnreadableClassification(c: QuoteClassificationType | null | undefined): boolean {
  if (!c) return true
  const s = c.savings_strategy
  if (UNREADABLE.test(s?.rationale || '')) return true
  // A zero-zero savings frame is never a real read of a commercial quote.
  if ((s?.target_percent_min ?? 0) <= 0 && (s?.target_percent_max ?? 0) <= 0) return true
  return false
}

type QuoteType = QuoteClassificationType['quote_type']
type Bracket = QuoteClassificationType['deal_size_bracket']
type Approach = QuoteClassificationType['savings_strategy']['approach']

/** quote_type from the extraction's free-text category / product / pricing model. */
export function quoteTypeFromCategory(category: string | undefined, product?: string, pricingModel?: string): QuoteType {
  const s = `${category || ''} ${product || ''} ${pricingModel || ''}`.toLowerCase()
  if (/(saas|software|subscription|licen[cs]e|platform|cloud service|per[- ]seat|per[- ]user|security awareness|crm|\bit\b security|identity|endpoint)/.test(s)) return 'saas'
  if (/(telecom|bandwidth|hosting|infrastructure|compute|storage|usage[- ]based|per[- ]gb|data ?center)/.test(s)) return 'usage_based_infra'
  if (/(managed (it|service)|support contract|outsourc)/.test(s)) return 'managed_services'
  if (/(staffing|recruit|placement|\beor\b|employer of record|contractor management)/.test(s)) return 'staffing'
  if (/(media buy|advertis|sponsorship|\bpr\b|campaign)/.test(s)) return 'media'
  if (/(insurance|coverage|policy|broker)/.test(s)) return 'insurance'
  if (/(shipping|freight|courier|logistic|delivery)/.test(s)) return 'logistics'
  if (/(lease|leasing|finance agreement)/.test(s)) return 'leasing'
  if (/(hardware|equipment|device|supplies|inventory|physical)/.test(s)) return 'product_hardware'
  if (/(construction|renovat|remodel|architect|building work|structural)/.test(s)) return 'construction'
  if (/(hotel|venue|travel|accommodation)/.test(s)) return 'travel'
  if (/(conference|wedding|trade show|event|launch)/.test(s)) return 'event_project'
  if (/(garage|mechanic|\bmot\b|vehicle service|body ?work|car repair)/.test(s)) return 'garage'
  if (/(gardening|plumbing|cleaning|painting|moving|pest)/.test(s)) return 'household'
  return 'professional_services'
}

export function bracketFromTotal(amount: number): Bracket {
  if (!(amount > 0)) return 'medium'
  if (amount < 1_000) return 'micro'
  if (amount < 10_000) return 'small'
  if (amount < 50_000) return 'medium'
  if (amount < 250_000) return 'large'
  return 'enterprise'
}

const RECURRING_TYPES = new Set<QuoteType>(['saas', 'usage_based_infra', 'managed_services', 'staffing', 'insurance', 'leasing'])

/** The savings guideline rows of CLASSIFICATION_PROMPT, as code. */
export function savingsRange(quoteType: QuoteType, bracket: Bracket, recurring: boolean, renewal: boolean): { min: number; max: number; approach: Approach } {
  const big = bracket === 'medium' || bracket === 'large' || bracket === 'enterprise'
  let r: { min: number; max: number; approach: Approach }
  switch (quoteType) {
    case 'saas': r = recurring && renewal ? { min: 15, max: 25, approach: 'competitive_leverage' } : recurring && big ? { min: 10, max: 20, approach: 'volume_discount' } : { min: 5, max: 15, approach: 'package_discount' }; break
    case 'professional_services': r = big ? { min: 10, max: 20, approach: 'scope_optimization' } : { min: 5, max: 15, approach: 'package_discount' }; break
    case 'product_hardware': r = { min: 5, max: 15, approach: 'volume_discount' }; break
    case 'household': r = bracket === 'micro' ? { min: 5, max: 10, approach: 'competitive_leverage' } : { min: 5, max: 15, approach: 'package_discount' }; break
    case 'event_project': r = { min: 5, max: 15, approach: 'package_discount' }; break
    case 'construction': r = big ? { min: 10, max: 20, approach: 'line_item_reduction' } : { min: 5, max: 10, approach: 'package_discount' }; break
    case 'staffing': r = { min: 5, max: 15, approach: 'competitive_leverage' }; break
    case 'travel': r = { min: 5, max: 15, approach: 'package_discount' }; break
    case 'media': r = { min: 10, max: 20, approach: 'volume_discount' }; break
    case 'usage_based_infra': r = { min: 10, max: 20, approach: 'volume_discount' }; break
    case 'managed_services': r = { min: 5, max: 15, approach: 'scope_optimization' }; break
    case 'insurance': r = { min: 5, max: 15, approach: 'competitive_leverage' }; break
    case 'logistics': r = { min: 5, max: 15, approach: 'volume_discount' }; break
    case 'leasing': r = { min: 5, max: 10, approach: 'competitive_leverage' }; break
    default: r = { min: 5, max: 15, approach: 'package_discount' }
  }
  // "Renewal with incumbent = add 5% to range" — applied once, and only when the
  // saas renewal row above did not already price it in.
  if (renewal && !(quoteType === 'saas' && recurring)) r = { ...r, min: r.min + 5, max: r.max + 5 }
  return r
}

/** Deterministic classification from the extraction call's facts. Used when Haiku could not read the document. */
export function classificationFromFacts(facts: ExtractedFacts, dealType: 'New' | 'Renewal', totalAmount: number): QuoteClassificationType {
  const quote_type = quoteTypeFromCategory(facts.category, facts.vendor_product, facts.pricing_model)
  const months = termToMonths(facts.term)
  const recurring = RECURRING_TYPES.has(quote_type) || (months != null && months >= 1) || /subscription|recurring|per (seat|user|month|year)|monthly|annual/i.test(`${facts.pricing_model || ''} ${facts.billing_payment || ''}`)
  const renewal = dealType === 'Renewal' || /renew/i.test(facts.deal_type || '')
  const deal_size_bracket = bracketFromTotal(totalAmount)
  const range = savingsRange(quote_type, deal_size_bracket, recurring, renewal)
  return {
    quote_type,
    deal_size_bracket,
    recurring,
    leverage_level: renewal ? 'high' : 'medium',
    audience: 'business',
    savings_strategy: {
      target_percent_min: range.min,
      target_percent_max: range.max,
      approach: range.approach,
      rationale: `Derived in code from the extracted facts (${quote_type}, ${deal_size_bracket}, ${recurring ? 'recurring' : 'one-time'}${renewal ? ', renewal' : ''}); the classifier could not read the document.`,
    },
  }
}

/** The classification to use: the model's when it actually read the quote, else one rebuilt from the facts. */
export function resolveClassification(model: QuoteClassificationType | null | undefined, facts: ExtractedFacts, dealType: 'New' | 'Renewal', totalAmount: number): { classification: QuoteClassificationType; replaced: boolean } {
  if (model && !isUnreadableClassification(model)) return { classification: model, replaced: false }
  return { classification: classificationFromFacts(facts, dealType, totalAmount), replaced: true }
}
