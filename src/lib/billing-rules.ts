/**
 * Pure billing rules for the Negotiation Playbook. No I/O: the server
 * (lib/billing.ts) gathers the facts, this decides. The commercial model is
 * lib/pricing.ts; this file only orders its rules.
 *
 *   admin                         → free (admin)
 *   already paid for this deal    → included (purchased)
 *   early access on               → free (early access)
 *   no Playbook ever on account   → free (first one)     [FIRST_DEEP_ANALYSIS_FREE]
 *   an unassigned credit exists   → included (credit)    [bought from the new-deal gate]
 *   otherwise                     → payment due
 */
import { DEEP_ANALYSIS_PRICE_EUR, FIRST_DEEP_ANALYSIS_FREE, isEarlyAccess } from '@/lib/pricing'

export type PlaybookAccessKind = 'admin' | 'purchased' | 'early_access' | 'first_free' | 'credit' | 'due'

export interface PlaybookAccess {
  kind: PlaybookAccessKind
  /** Whether the user can build the Playbook now without paying. */
  granted: boolean
  /** Whole euros, list price. */
  priceEur: number
}

export interface PlaybookFacts {
  isAdmin: boolean
  /** A paid purchase row is attached to this deal. */
  purchasedForDeal: boolean
  /** The account has at least one completed Playbook or one purchase. */
  hasAnyPlaybook: boolean
  /** A paid purchase row with no deal attached. */
  hasUnassignedCredit: boolean
  now?: Date
}

export function playbookAccess(f: PlaybookFacts): PlaybookAccess {
  const price = DEEP_ANALYSIS_PRICE_EUR
  const grant = (kind: PlaybookAccessKind): PlaybookAccess => ({ kind, granted: true, priceEur: price })
  if (f.isAdmin) return grant('admin')
  if (f.purchasedForDeal) return grant('purchased')
  if (isEarlyAccess(f.now)) return grant('early_access')
  if (FIRST_DEEP_ANALYSIS_FREE && !f.hasAnyPlaybook) return grant('first_free')
  if (f.hasUnassignedCredit) return grant('credit')
  return { kind: 'due', granted: false, priceEur: price }
}

/**
 * Creating a deal past the free quick-analysis quota: the deal is a Playbook
 * deal, so it needs the same access as a Playbook (admins and early access
 * excepted by the caller's quota check already). A first-free account may
 * still create it for free.
 */
export function newDealNeedsPayment(f: PlaybookFacts): boolean {
  return !playbookAccess({ ...f, purchasedForDeal: false }).granted
}
