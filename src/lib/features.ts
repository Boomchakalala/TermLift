/**
 * Product switches. One place, booleans only, so parking or reviving a
 * surface is a one-line change and never a hunt through the tree.
 */

/**
 * "TermLift negotiates" — the human negotiation service (20% of verified
 * savings). Parked 2026-10-22: nothing is for sale while we look for users.
 * Off hides every public and in-app mention (landing band and step 4, pricing
 * card, Home button, deal hand-over cards, /negotiate pages, help FAQ entries,
 * sitemap). The request flow, the admin desk and the terms section stay in
 * the code; an existing request still shows its status on the deal. Flip to
 * true to bring it all back.
 */
export const NEGOTIATION_SERVICE_ENABLED = false
