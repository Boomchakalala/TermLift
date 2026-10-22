/**
 * Global AI spend guard — the one ceiling that keeps a free product from
 * running up the API bill. Reads the same ai_usage_events rows that
 * lib/ai-telemetry.ts writes (estimated_cost_usd per call), so the cap holds
 * across serverless instances with no extra state.
 *
 * Three stops, checked in this order:
 *   1. AI_KILL_SWITCH=1 in the environment — everything off for non-admins.
 *   2. Spend since 00:00 UTC today  ≥ AI_BUDGET_DAILY_USD.
 *   3. Spend since the 1st (UTC)    ≥ AI_BUDGET_MONTHLY_USD.
 *
 * Admins always pass. Routes call guardAiSpend() right before the first
 * paid model call and return its response when it is not null.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { AI_BUDGET_DAILY_USD, AI_BUDGET_MONTHLY_USD } from '@/lib/ai-limits'

export type BudgetStop = 'kill_switch' | 'daily' | 'monthly'

export interface BudgetStatus {
  allowed: boolean
  stop: BudgetStop | null
  spentTodayUsd: number
  spentMonthUsd: number
  dailyCapUsd: number
  monthlyCapUsd: number
  /** When the binding limit lifts (next UTC midnight, or the 1st of next month). */
  resetAt: Date
  killSwitch: boolean
}

export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}
export function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/** Pure decision, so it can be unit-tested without a database. */
export function evaluateBudget(input: {
  spentTodayUsd: number
  spentMonthUsd: number
  killSwitch: boolean
  now?: Date
  dailyCapUsd?: number
  monthlyCapUsd?: number
}): BudgetStatus {
  const now = input.now ?? new Date()
  const dailyCapUsd = input.dailyCapUsd ?? AI_BUDGET_DAILY_USD
  const monthlyCapUsd = input.monthlyCapUsd ?? AI_BUDGET_MONTHLY_USD
  const nextDay = new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000)
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const base = { spentTodayUsd: input.spentTodayUsd, spentMonthUsd: input.spentMonthUsd, dailyCapUsd, monthlyCapUsd, killSwitch: input.killSwitch }
  if (input.killSwitch) return { ...base, allowed: false, stop: 'kill_switch', resetAt: nextDay }
  if (input.spentMonthUsd >= monthlyCapUsd) return { ...base, allowed: false, stop: 'monthly', resetAt: nextMonth }
  if (input.spentTodayUsd >= dailyCapUsd) return { ...base, allowed: false, stop: 'daily', resetAt: nextDay }
  return { ...base, allowed: true, stop: null, resetAt: nextDay }
}

/** Sums today's and this month's estimated cost from ai_usage_events. Fails open (allowed) if the table can't be read. */
export async function checkAiBudget(now = new Date()): Promise<BudgetStatus> {
  const killSwitch = process.env.AI_KILL_SWITCH === '1' || process.env.AI_KILL_SWITCH === 'true'
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('ai_usage_events')
      .select('estimated_cost_usd, created_at')
      .gte('created_at', startOfUtcMonth(now).toISOString())
    if (error) throw error
    const dayStart = startOfUtcDay(now).getTime()
    let spentTodayUsd = 0
    let spentMonthUsd = 0
    for (const r of data || []) {
      const c = Number(r.estimated_cost_usd) || 0
      spentMonthUsd += c
      if (new Date(r.created_at).getTime() >= dayStart) spentTodayUsd += c
    }
    return evaluateBudget({ spentTodayUsd, spentMonthUsd, killSwitch, now })
  } catch (err) {
    console.error('[ai-budget] could not read spend; failing open:', err)
    return evaluateBudget({ spentTodayUsd: 0, spentMonthUsd: 0, killSwitch, now })
  }
}

export function capacityMessage(status: BudgetStatus, locale: string = 'en'): string {
  const fr = locale === 'fr'
  if (status.stop === 'kill_switch') {
    return fr
      ? 'Les analyses sont en pause pour maintenance. Vos dossiers sont intacts — réessayez un peu plus tard.'
      : 'Analyses are paused for maintenance. Your deals are safe — try again a little later.'
  }
  if (status.stop === 'monthly') {
    return fr
      ? 'TermLift a atteint sa capacité gratuite du mois. Vos dossiers sont intacts — ça repart le 1er.'
      : 'TermLift has hit its free capacity for this month. Your deals are safe — it resets on the 1st.'
  }
  return fr
    ? 'TermLift a atteint sa capacité gratuite du jour. Vos dossiers sont intacts — ça repart à minuit UTC.'
    : 'TermLift is at capacity for today. Your deals are safe — the free budget resets at midnight UTC.'
}

/**
 * One call per paid route. Returns a 503 response to send back when the
 * budget is spent (never for admins), otherwise null and the route goes on.
 */
export async function guardAiSpend(isAdmin: boolean, locale: string = 'en'): Promise<NextResponse | null> {
  if (isAdmin) return null
  const status = await checkAiBudget()
  if (status.allowed) return null
  return NextResponse.json(
    { error: capacityMessage(status, locale), capacity: true, stop: status.stop, resetAt: status.resetAt.toISOString() },
    { status: 503, headers: { 'Retry-After': String(Math.max(60, Math.round((status.resetAt.getTime() - Date.now()) / 1000))) } },
  )
}
