/**
 * Single source of truth for what TermLift charges.
 *
 * Since 2026-10-22 the product is free: the analysis, the Negotiation
 * Playbook, the emails and every round cost nothing, for everyone, bounded
 * only by the technical ceilings in lib/ai-limits.ts (per-account daily and
 * monthly analyses, a global spend budget). There is no subscription, no
 * credit, no per-deal unlock — the Stripe flow was removed with this change.
 *
 * The one paid thing is the negotiation service: a share of verified savings,
 * invoiced after the signed deal, nothing if we save nothing.
 */

export const CURRENCY = 'EUR'

/** The negotiation service's fee — a percentage of verified savings, charged only when a deal closes with savings. */
export const NEGOTIATION_FEE_PERCENT = 20

/** Floor on the negotiation fee, so a €2k saving is still worth a negotiator's week. Quoted in the FAQ, invoiced after the signed deal. */
export const NEGOTIATION_FEE_MINIMUM_EUR = 500

/** Flat cap on email regenerations per round — an abuse safeguard, not a paywall. */
export const FULL_ANALYSIS_EMAIL_REGEN_LIMIT = 3

/** The free-era usage ceilings, re-exported so copy that quotes them reads from one place. */
export { NEW_DEALS_PER_DAY, NEW_DEALS_PER_MONTH } from '@/lib/ai-limits'
