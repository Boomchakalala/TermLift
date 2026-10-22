/**
 * Abuse-prevention / cost-containment ceilings — technical safety limits,
 * NOT commercial tiers. These exist purely so no single free deal, account,
 * or anonymous IP can generate unbounded AI cost; they are never meant to be
 * marketed, and they're independent of lib/pricing.ts's commercial model.
 * Centralized here so a ceiling only ever needs changing in one place.
 */

/**
 * Hard ceiling on negotiation rounds per deal, regardless of plan. Rounds
 * belong to the deal's unlocked negotiation workspace (see
 * lib/deep-analysis-status.ts's canAccessFullAnalysis()), not to a
 * subscription tier — but a genuine negotiation is very unlikely to need
 * more than a handful of rounds, so this stays generous while still
 * bounding worst-case cost on one deal.
 */
export const MAX_ROUNDS_PER_DEAL = 6

/**
 * Anonymous /try analyses allowed per IP per rolling 24h window. Enforced
 * against ai_usage_events (see lib/ai-telemetry.ts) rather than the old
 * in-memory Map, so it actually holds across serverless cold starts/
 * multiple instances. Matches the existing product behavior (1 free
 * analysis per IP before signup) — this file doesn't change the number,
 * just makes it durable.
 */
export const TRIAL_MAX_PER_IP_PER_DAY = 1

/**
 * Free-era usage ceilings (2026-10-22: TermLift is free; the negotiation
 * service is the product). Rolling windows, not lifetime counts — a tester
 * who comes back next week is exactly who we want.
 */
/** New deals (analyses) one account can start per UTC day / per calendar month. */
export const NEW_DEALS_PER_DAY = 3
export const NEW_DEALS_PER_MONTH = 15
/** AI actions (analysis, Playbook, round, email) per account per rolling hour / per day. */
export const AI_ACTIONS_PER_HOUR = 5
export const AI_ACTIONS_PER_DAY = 20

/**
 * Global spend ceilings across every user, in USD of estimated model cost
 * (lib/ai-cost.ts). ~$0.80 per deal all-in on 2026-10 telemetry, so $15/day
 * is roughly 18 deals a day and $200/month ~250 deals. When a cap is hit the
 * app answers "at capacity" instead of spending; admins are never blocked.
 * AI_KILL_SWITCH=1 in the environment stops every paid call for non-admins.
 */
export const AI_BUDGET_DAILY_USD = 15
export const AI_BUDGET_MONTHLY_USD = 200
