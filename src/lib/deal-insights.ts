/**
 * Server-side aggregation for the Home page: stat strip + Insights tab.
 * Ported from the former /app/dashboard page, on top of deal-metrics so every
 * figure agrees with the deal list.
 */
import { convertCurrency, fetchRates, type Currency } from '@/lib/currency'
import {
  type DealLike, getAchievedSavings, getCategory, getDealCurrency, getFrozenSavingsBase, getLatestOutput, getPotentialSavings, getRedFlagCount,
  getRenewalDate, getScore, getTotalAmount, getVendorName, isClosed, isWon,
} from '@/lib/deal-metrics'

export interface EnrichedDeal {
  deal: DealLike
  vendor: string
  category: string
  amount: number          // in base currency
  potential: number       // in base currency
  achieved: number        // in base currency
  flags: number
  score?: number
  renewal: Date | null
  closed: boolean
  won: boolean
  /** The single biggest ask from the analysis (must-have first), if any. */
  topAsk: { ask: string; amount: number } | null
  /** Red-flag types on the latest round, as the analysis wrote them ("Commercial", "Renewal"…). */
  flagTypes: string[]
}

export interface Insights {
  baseCurrency: Currency
  totalSpend: number
  savingsAchieved: number
  savingsIdentified: number
  dealCount: number
  activeCount: number
  closedCount: number
  wonCount: number
  winRate: number
  avgScore: number | null
  /** achieved ÷ identified-at-time — how much of what was found got captured (won deals only). */
  captureRate: number | null
  avgDaysToClose: number | null
  categories: Array<{ name: string; spend: number; count: number; saved: number; potential: number }>
  categoryScores: Array<{ name: string; score: number; count: number }>
  topSuppliers: Array<{ name: string; spend: number; count: number; saved: number; potential: number; dealId: string }>
  monthly: Array<{ key: string; label: string; amount: number }>
  /** Savings over the last 6 months: won savings by close month, potential by creation month, plus the running total of saved. */
  savingsMonthly: Array<{ key: string; label: string; saved: number; potential: number; cumulative: number }>
  renewals: Array<{ id: string; vendor: string; date: Date; daysOut: number; amount: number; saved: number; won: boolean }>
  topWins: Array<{ id: string; vendor: string; category: string; saved: number }>
  closedDeals: Array<{ id: string; vendor: string; category: string; original: number; final: number; saved: number; pct: number; closedAt: string; won: boolean }>
  /** Active deals that need a nudge: stale (no update ≥ 7 days) or heavy on flags. */
  attention: Array<{ id: string; vendor: string; daysSinceUpdate: number; flags: number; reason: 'stale' | 'flags' }>
  /** Active deals ranked by money still on the table, each with the one ask that unlocks most of it. */
  opportunities: Array<{ id: string; vendor: string; category: string; potential: number; ask: string | null; askAmount: number | null; flags: number }>
  /** Flag types that recur across active deals, and how many deals carry each. */
  recurringFlags: Array<{ type: string; deals: number; flags: number }>
  scoreBuckets: Array<{ key: '0' | '40' | '60' | '80'; count: number }>
  nextRenewal: { id: string; vendor: string; date: Date; daysOut: number } | null
}

async function toBase(amount: number, from: Currency, base: Currency, convert: boolean): Promise<number> {
  if (!convert || amount === 0 || from === base) return amount
  try {
    return await convertCurrency(amount, from, base)
  } catch {
    return amount
  }
}

/** `convert: false` skips live FX (demo data, tests). */
export async function enrichDeals(deals: DealLike[], baseCurrency: Currency, convert = true): Promise<EnrichedDeal[]> {
  if (convert && deals.length) {
    // Warm the rate cache once so concurrent conversions share one snapshot.
    try { await fetchRates() } catch { /* fall back to unconverted amounts */ }
  }
  return Promise.all(
    deals.map(async (deal) => {
      const cur = getDealCurrency(deal)
      const out = getLatestOutput(deal) as {
        potential_savings?: { must_have?: Array<{ ask?: string; amount?: number }>; nice_to_have?: Array<{ ask?: string; amount?: number }> }
        red_flags?: Array<{ type?: string }>
      }
      const asks = [...(out.potential_savings?.must_have || []), ...(out.potential_savings?.nice_to_have || [])]
        .filter((a) => a?.ask && typeof a.amount === 'number' && a.amount > 0)
        .sort((a, b) => (b.amount || 0) - (a.amount || 0))
      // Won deals carry their savings frozen in the base currency from the day they closed; only
      // deals frozen in another base (or never frozen) are converted at today's rate.
      const frozen = getFrozenSavingsBase(deal, baseCurrency)
      const [amount, potential, achieved, topAskAmount] = await Promise.all([
        toBase(getTotalAmount(deal), cur, baseCurrency, convert),
        toBase(getPotentialSavings(deal), cur, baseCurrency, convert),
        frozen != null ? Promise.resolve(frozen) : toBase(getAchievedSavings(deal), cur, baseCurrency, convert),
        asks[0] ? toBase(Number(asks[0].amount), cur, baseCurrency, convert) : Promise.resolve(0),
      ])
      return {
        deal,
        vendor: getVendorName(deal),
        category: getCategory(deal),
        amount, potential, achieved,
        flags: getRedFlagCount(deal),
        score: getScore(deal),
        renewal: getRenewalDate(deal),
        closed: isClosed(deal),
        won: isWon(deal),
        topAsk: asks[0] ? { ask: String(asks[0].ask), amount: topAskAmount } : null,
        flagTypes: (out.red_flags || []).map((f) => String(f?.type || '').trim()).filter(Boolean),
      }
    }),
  )
}

export function computeInsights(rows: EnrichedDeal[], baseCurrency: Currency, now = new Date()): Insights {
  const closed = rows.filter((r) => r.closed)
  const won = closed.filter((r) => r.won)
  const active = rows.filter((r) => !r.closed)
  const scored = rows.filter((r) => r.score != null)

  // categories
  const catMap = new Map<string, { spend: number; count: number; saved: number; potential: number; scoreSum: number; scoreN: number }>()
  for (const r of rows) {
    const e = catMap.get(r.category) || { spend: 0, count: 0, saved: 0, potential: 0, scoreSum: 0, scoreN: 0 }
    e.spend += r.amount; e.count++; e.saved += r.achieved; e.potential += r.closed ? 0 : r.potential
    if (r.score != null) { e.scoreSum += r.score; e.scoreN++ }
    catMap.set(r.category, e)
  }
  const categories = [...catMap.entries()].map(([name, v]) => ({ name, spend: v.spend, count: v.count, saved: v.saved, potential: v.potential })).sort((a, b) => b.spend - a.spend).slice(0, 6)
  const categoryScores = [...catMap.entries()].filter(([, v]) => v.scoreN > 0).map(([name, v]) => ({ name, score: Math.round(v.scoreSum / v.scoreN), count: v.scoreN })).sort((a, b) => a.score - b.score)

  // suppliers
  const supMap = new Map<string, { spend: number; count: number; saved: number; potential: number; dealId: string }>()
  for (const r of rows) {
    const e = supMap.get(r.vendor) || { spend: 0, count: 0, saved: 0, potential: 0, dealId: r.deal.id }
    e.spend += r.amount; e.count++; e.saved += r.achieved; e.potential += r.closed ? 0 : r.potential
    supMap.set(r.vendor, e)
  }
  const topSuppliers = [...supMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.spend - a.spend).slice(0, 5)

  // monthly
  const monthMap = new Map<string, { label: string; amount: number }>()
  for (const r of rows) {
    const d = new Date(r.deal.created_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const e = monthMap.get(key) || { label: d.toLocaleDateString('en-US', { month: 'short' }), amount: 0 }
    e.amount += r.amount
    monthMap.set(key, e)
  }
  const monthly = [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([key, v]) => ({ key, ...v }))

  // savings over time: a fixed 6-month window ending now, so empty months still show
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const savMap = new Map<string, { label: string; saved: number; potential: number }>()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    savMap.set(monthKey(d), { label: d.toLocaleDateString('en-US', { month: 'short' }), saved: 0, potential: 0 })
  }
  for (const r of won) {
    const k = monthKey(new Date(r.deal.closed_at || r.deal.updated_at))
    const e = savMap.get(k); if (e) e.saved += r.achieved
  }
  for (const r of active) {
    const k = monthKey(new Date(r.deal.created_at))
    const e = savMap.get(k); if (e) e.potential += r.potential
  }
  // Wins closed before the window still count towards the running total.
  const windowStart = [...savMap.keys()][0]
  let cumulative = won.filter((r) => monthKey(new Date(r.deal.closed_at || r.deal.updated_at)) < windowStart).reduce((s, r) => s + r.achieved, 0)
  const savingsMonthly = [...savMap.entries()].map(([key, v]) => { cumulative += v.saved; return { key, ...v, cumulative } })

  // renewals
  const renewals = rows
    .filter((r) => r.renewal && r.renewal.getTime() > now.getTime())
    .map((r) => ({
      id: r.deal.id, vendor: r.vendor, date: r.renewal as Date,
      daysOut: Math.max(0, Math.floor(((r.renewal as Date).getTime() - now.getTime()) / 86400000)),
      amount: r.amount, saved: r.achieved, won: r.won,
    }))
    .sort((a, b) => a.daysOut - b.daysOut)

  // wins + closed table
  const topWins = [...won].filter((r) => r.achieved > 0).sort((a, b) => b.achieved - a.achieved).slice(0, 3)
    .map((r) => ({ id: r.deal.id, vendor: r.vendor, category: r.category, saved: r.achieved }))
  const closedDeals = [...closed]
    .sort((a, b) => new Date(b.deal.closed_at || b.deal.updated_at).getTime() - new Date(a.deal.closed_at || a.deal.updated_at).getTime())
    .slice(0, 8)
    .map((r) => ({
      id: r.deal.id, vendor: r.vendor, category: r.category, original: r.amount, final: r.amount - r.achieved, saved: r.achieved,
      pct: r.amount > 0 ? (r.achieved / r.amount) * 100 : 0, closedAt: r.deal.closed_at || r.deal.updated_at, won: r.won,
    }))

  // attention: stale or flag-heavy active deals
  const attention = active
    .map((r) => ({ r, days: Math.floor((now.getTime() - new Date(r.deal.updated_at).getTime()) / 86400000) }))
    .filter(({ r, days }) => days >= 7 || r.flags >= 3)
    .sort((a, b) => b.r.flags - a.r.flags || b.days - a.days)
    .slice(0, 4)
    .map(({ r, days }) => ({ id: r.deal.id, vendor: r.vendor, daysSinceUpdate: days, flags: r.flags, reason: (r.flags >= 3 ? 'flags' : 'stale') as 'flags' | 'stale' }))

  // opportunities: active deals by money on the table, each with its biggest ask
  const opportunities = active
    .filter((r) => r.potential > 0)
    .sort((a, b) => b.potential - a.potential)
    .slice(0, 4)
    .map((r) => ({ id: r.deal.id, vendor: r.vendor, category: r.category, potential: r.potential, ask: r.topAsk?.ask ?? null, askAmount: r.topAsk?.amount ?? null, flags: r.flags }))

  // recurring flags: which flag types show up across active deals
  const flagMap = new Map<string, { deals: Set<string>; flags: number }>()
  for (const r of active) {
    for (const ty of r.flagTypes) {
      const key = ty.toLowerCase()
      const e = flagMap.get(key) || { deals: new Set<string>(), flags: 0 }
      e.deals.add(r.deal.id)
      e.flags++
      flagMap.set(key, e)
    }
  }
  const recurringFlags = [...flagMap.entries()]
    .map(([key, v]) => ({ type: key.replace(/\b\w/g, (c) => c.toUpperCase()), deals: v.deals.size, flags: v.flags }))
    .sort((a, b) => b.deals - a.deals || b.flags - a.flags)
    .slice(0, 6)

  // score buckets
  const bucket = (lo: number, hi: number) => scored.filter((r) => (r.score as number) >= lo && (r.score as number) < hi).length
  const scoreBuckets: Insights['scoreBuckets'] = [
    { key: '0', count: bucket(0, 40) }, { key: '40', count: bucket(40, 60) }, { key: '60', count: bucket(60, 80) }, { key: '80', count: bucket(80, 101) },
  ]

  // performance
  const wonWithPotential = won.filter((r) => r.potential > 0)
  const captureRate = wonWithPotential.length
    ? Math.round((wonWithPotential.reduce((s, r) => s + r.achieved, 0) / wonWithPotential.reduce((s, r) => s + r.potential, 0)) * 100)
    : null
  const avgDaysToClose = closed.length
    ? Math.round(closed.reduce((s, r) => s + Math.max(1, (new Date(r.deal.closed_at || r.deal.updated_at).getTime() - new Date(r.deal.created_at).getTime()) / 86400000), 0) / closed.length)
    : null

  return {
    baseCurrency,
    totalSpend: rows.reduce((s, r) => s + r.amount, 0),
    savingsAchieved: won.reduce((s, r) => s + r.achieved, 0),
    savingsIdentified: active.reduce((s, r) => s + r.potential, 0),
    dealCount: rows.length,
    activeCount: active.length,
    closedCount: closed.length,
    wonCount: won.length,
    winRate: closed.length ? Math.round((won.length / closed.length) * 100) : 0,
    avgScore: scored.length ? Math.round(scored.reduce((s, r) => s + (r.score as number), 0) / scored.length) : null,
    captureRate,
    avgDaysToClose,
    categories,
    categoryScores,
    topSuppliers,
    monthly,
    savingsMonthly,
    renewals: renewals.slice(0, 5),
    topWins,
    closedDeals,
    attention,
    opportunities,
    recurringFlags,
    scoreBuckets,
    nextRenewal: renewals[0] ? { id: renewals[0].id, vendor: renewals[0].vendor, date: renewals[0].date, daysOut: renewals[0].daysOut } : null,
  }
}
