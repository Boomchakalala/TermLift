/**
 * Single source of truth for TermLift's commercial model. Everything that
 * quotes a price, a limit or a fee reads from here — no literals elsewhere.
 *
 * The model (decided 2026-09-06):
 *   Step 1  Quick analysis      free, FREE_ANALYSIS_LIMIT per account (+1 anonymous per IP per day on /try)
 *   Step 2  Deep Analysis       one-time, per deal — DEEP_ANALYSIS_PRICE_EUR
 *                               · free while EARLY_ACCESS is on (dated)
 *                               · the first Deep Analysis on any account is always free
 *   Step 3  Negotiate yourself  included with Deep Analysis
 *   Add-on  TermLift negotiates NEGOTIATION_FEE_PERCENT of verified savings, NEGOTIATION_FEE_MINIMUM_EUR minimum
 *
 * There is no subscription. The old Starter / Essentials / Pro / Business tiers
 * and their Stripe subscription flow were removed on 2026-09-06; `profiles.plan`
 * is a dead column that nothing reads any more.
 */

export const CURRENCY = 'EUR'

/** Quick analyses per account, lifetime. Deep Analysis, emails and rounds on existing deals never count. */
export const FREE_ANALYSIS_LIMIT = 4

/** Deep Analysis list price, one-time per deal. */
export const DEEP_ANALYSIS_PRICE_EUR = 29

/**
 * Early access: every Deep Analysis is free until this date (inclusive).
 * Extend the date or flip `enabled` — nothing else needs to change. While it
 * is on, nothing charges and the free quick-analysis limit does not block new
 * deals either (a new deal past the limit *is* a Deep Analysis, and those are
 * free right now).
 */
export const EARLY_ACCESS = {
  enabled: true,
  until: '2026-09-30',
} as const

/** The first Deep Analysis on any account stays free after early access. */
export const FIRST_DEEP_ANALYSIS_FREE = true

/** The negotiation service's fee — a percentage of verified savings, charged only when a deal closes with savings. */
export const NEGOTIATION_FEE_PERCENT = 20

/** Floor on the negotiation fee, so a €2k saving is still worth a negotiator's week. Quoted in the FAQ, invoiced after the signed deal. */
export const NEGOTIATION_FEE_MINIMUM_EUR = 500

/** Flat cap on email regenerations per round — an abuse safeguard, not a paywall. */
export const FULL_ANALYSIS_EMAIL_REGEN_LIMIT = 3

/** Kept for existing imports; Deep Analysis is priced now. */
export const FULL_ANALYSIS_PRICE = {
  amount: DEEP_ANALYSIS_PRICE_EUR,
  currency: CURRENCY,
  unit: 'per_deal' as const,
} as const

export function isEarlyAccess(now: Date = new Date()): boolean {
  if (!EARLY_ACCESS.enabled) return false
  return now.toISOString().slice(0, 10) <= EARLY_ACCESS.until
}

/** "30 September 2026" / "30 septembre 2026" */
export function earlyAccessUntilLabel(locale: string = 'en'): string {
  const d = new Date(EARLY_ACCESS.until + 'T12:00:00Z')
  return d.toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** "€29" */
export function deepAnalysisPriceLabel(): string {
  return `€${DEEP_ANALYSIS_PRICE_EUR}`
}

/**
 * One sentence for gates and cards: what Deep Analysis costs right now.
 * EN: "€29 per deal · free during early access until 30 September 2026."
 */
export function deepAnalysisPriceNote(locale: string = 'en', access?: 'first_free' | 'due' | 'credit' | 'purchased'): string {
  const fr = locale === 'fr'
  const price = deepAnalysisPriceLabel()
  // Per-deal notes once the server has decided (lib/billing-rules.ts).
  if (access === 'purchased' || access === 'credit') return fr ? 'Inclus · déjà réglé pour ce dossier.' : 'Included · already paid for this deal.'
  if (access === 'first_free') return fr ? `${price} par dossier · votre premier Plan est offert.` : `${price} per deal · your first Playbook is free.`
  if (access === 'due') return fr ? `${price} par dossier · paiement par carte via Stripe, facture par e-mail.` : `${price} per deal · paid by card via Stripe, invoice by email.`
  if (isEarlyAccess()) {
    return fr
      ? `${price} par dossier · gratuit pendant l'accès anticipé jusqu'au ${earlyAccessUntilLabel('fr')}.`
      : `${price} per deal · free during early access until ${earlyAccessUntilLabel('en')}.`
  }
  return fr
    ? `${price} par dossier${FIRST_DEEP_ANALYSIS_FREE ? ' · la première est offerte' : ''}.`
    : `${price} per deal${FIRST_DEEP_ANALYSIS_FREE ? ' · your first one is free' : ''}.`
}

/**
 * Server-side quota check for creating a new analysis (new deal, imported
 * trial, or a new round). Admins are checked by the caller, not here.
 */
export function checkFreeQuota(usageCount: number): { allowed: boolean; message?: string } {
  if (usageCount < FREE_ANALYSIS_LIMIT) return { allowed: true }
  // Past the free quick analyses a new deal is a Deep Analysis — free while early access is on.
  if (isEarlyAccess()) return { allowed: true }
  return {
    allowed: false,
    message: `You've used your ${FREE_ANALYSIS_LIMIT} free quick analyses. Each further deal comes with the Negotiation Playbook at ${deepAnalysisPriceLabel()}, paid by card when you start it from New analysis.`,
  }
}
