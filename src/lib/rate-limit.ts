import { createClient } from '@/lib/supabase/server'
import { AI_ACTIONS_PER_DAY, AI_ACTIONS_PER_HOUR, NEW_DEALS_PER_DAY, NEW_DEALS_PER_MONTH } from '@/lib/ai-limits'

export interface RateLimitConfig {
  hourlyLimit: number
  dailyLimit: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  resetAt: Date
  message?: string
}

// One abuse ceiling for every account — there are no tiers. Admins bypass at the caller.
const LIMITS: RateLimitConfig = {
  hourlyLimit: AI_ACTIONS_PER_HOUR,
  dailyLimit: AI_ACTIONS_PER_DAY,
}

export interface NewDealQuotaResult {
  allowed: boolean
  usedToday: number
  usedThisMonth: number
  dailyLimit: number
  monthlyLimit: number
  resetAt: Date
  message?: string
}

/**
 * New deals per account on rolling windows (UTC day, calendar month). Replaces the
 * old lifetime "4 free quick analyses": the product is free, this only bounds cost.
 */
export async function checkNewDealQuota(userId: string, locale: string = 'en'): Promise<NewDealQuotaResult> {
  const supabase = await createClient()
  const now = new Date()
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const nextDay = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const [{ count: usedToday }, { count: usedThisMonth }] = await Promise.all([
    supabase.from('deals').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', dayStart.toISOString()),
    supabase.from('deals').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', monthStart.toISOString()),
  ])
  const fr = locale === 'fr'
  const base = { usedToday: usedToday || 0, usedThisMonth: usedThisMonth || 0, dailyLimit: NEW_DEALS_PER_DAY, monthlyLimit: NEW_DEALS_PER_MONTH }
  if (base.usedThisMonth >= NEW_DEALS_PER_MONTH) {
    return { ...base, allowed: false, resetAt: nextMonth, message: fr
      ? `Vous avez lancé ${base.usedThisMonth} analyses ce mois-ci — la limite gratuite est de ${NEW_DEALS_PER_MONTH} par mois. Ça repart le 1er.`
      : `You've started ${base.usedThisMonth} analyses this month — the free limit is ${NEW_DEALS_PER_MONTH} a month. It resets on the 1st.` }
  }
  if (base.usedToday >= NEW_DEALS_PER_DAY) {
    return { ...base, allowed: false, resetAt: nextDay, message: fr
      ? `Vous avez lancé ${base.usedToday} analyses aujourd'hui — la limite gratuite est de ${NEW_DEALS_PER_DAY} par jour. Ça repart à minuit UTC.`
      : `You've started ${base.usedToday} analyses today — the free limit is ${NEW_DEALS_PER_DAY} a day. It resets at midnight UTC.` }
  }
  return { ...base, allowed: true, resetAt: nextDay }
}

export async function checkRateLimit(userId: string): Promise<RateLimitResult> {
  const supabase = await createClient()
  const now = new Date()

  const limits = LIMITS

  // Count analyses in the last hour
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
  const { count: hourlyCount } = await supabase
    .from('rounds')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', oneHourAgo.toISOString())

  // Count analyses today
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const { count: dailyCount } = await supabase
    .from('rounds')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', startOfDay.toISOString())

  // Check hourly limit
  if ((hourlyCount || 0) >= limits.hourlyLimit) {
    const resetAt = new Date(oneHourAgo.getTime() + 60 * 60 * 1000)
    return {
      allowed: false,
      remaining: 0,
      limit: limits.hourlyLimit,
      resetAt,
      message: `Hourly limit of ${limits.hourlyLimit} analyses reached. Resets at ${resetAt.toLocaleTimeString()}.`
    }
  }

  // Check daily limit
  if ((dailyCount || 0) >= limits.dailyLimit) {
    const resetAt = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000)
    return {
      allowed: false,
      remaining: 0,
      limit: limits.dailyLimit,
      resetAt,
      message: `Daily limit of ${limits.dailyLimit} analyses reached. Resets at ${resetAt.toLocaleDateString()}.`
    }
  }

  // Calculate remaining (use the more restrictive one)
  const hourlyRemaining = limits.hourlyLimit - (hourlyCount || 0)
  const dailyRemaining = limits.dailyLimit - (dailyCount || 0)
  const remaining = Math.min(hourlyRemaining, dailyRemaining)

  return {
    allowed: true,
    remaining,
    limit: limits.dailyLimit,
    resetAt: new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000),
  }
}

export async function getUserUsage(userId: string): Promise<{
  hourlyUsed: number
  dailyUsed: number
  hourlyLimit: number
  dailyLimit: number
}> {
  const supabase = await createClient()
  const now = new Date()

  const limits = LIMITS

  // Count hourly usage
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
  const { count: hourlyUsed } = await supabase
    .from('rounds')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', oneHourAgo.toISOString())

  // Count daily usage
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const { count: dailyUsed } = await supabase
    .from('rounds')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', startOfDay.toISOString())

  return {
    hourlyUsed: hourlyUsed || 0,
    dailyUsed: dailyUsed || 0,
    hourlyLimit: limits.hourlyLimit,
    dailyLimit: limits.dailyLimit,
  }
}
