import { parseMoney, detectCurrency, convertCurrency, SUPPORTED_CURRENCIES, type Currency } from './currency'

// ─────────────────────────────────────────────────────────────────────────────
// Pure aggregation for the vendors list + header. Currencies are never converted;
// totals are kept per-currency and rendered like "€42K + $18K".
// ─────────────────────────────────────────────────────────────────────────────

export interface DealLite {
  id: string
  vendor_id: string | null
  status: string | null
  savings_amount: number | null
  final_total: number | null
  updated_at: string
  created_at: string
  closed_at?: string | null
  vendor?: string | null
  close_summary?: string | null
  close_notes?: string | null
  rounds?: Array<{ output_json: any; round_number: number }>
}

export function latestOutput(deal: DealLite): any {
  const rounds = deal.rounds || []
  if (!rounds.length) return null
  return [...rounds].sort((a, b) => b.round_number - a.round_number)[0]?.output_json || null
}

export function dealCurrency(deal: DealLite): string {
  const o = latestOutput(deal)
  const tc = o?.snapshot?.total_commitment || ''
  return o?.snapshot?.currency || detectCurrency(tc) || 'EUR'
}

export interface VendorRow {
  id: string
  name: string
  aliases: string[]
  dealCount: number
  totalsByCurrency: Record<string, number>
  savingsByCurrency: Record<string, number>
  /** Converted into the account's base currency (see sumInBase); set by the page, absent in tests. */
  totalBase?: number
  savingsBase?: number
  avgScore: number | null
  lastActivity: string | null
}

function pushDeal(map: Map<string, DealLite[]>, key: string, deal: DealLite) {
  const arr = map.get(key)
  if (arr) arr.push(deal)
  else map.set(key, [deal])
}

export function aggregateVendors(
  vendors: Array<{ id: string; canonical_name: string; aliases: string[] }>,
  deals: DealLite[],
): VendorRow[] {
  const byVendor = new Map<string, DealLite[]>()
  for (const d of deals) if (d.vendor_id) pushDeal(byVendor, d.vendor_id, d)

  const rows = vendors.map((v): VendorRow => {
    const ds = byVendor.get(v.id) || []
    const totalsByCurrency: Record<string, number> = {}
    const savingsByCurrency: Record<string, number> = {}
    let scoreSum = 0
    let scoreCount = 0
    let lastActivity: string | null = null

    for (const d of ds) {
      const o = latestOutput(d)
      const cur = dealCurrency(d)
      const tc = o?.snapshot?.total_commitment
      if (tc) {
        const amt = parseMoney(String(tc)).amount
        if (amt > 0) totalsByCurrency[cur] = (totalsByCurrency[cur] || 0) + amt
      }
      if (d.status === 'closed_won' && d.savings_amount && d.savings_amount > 0) {
        savingsByCurrency[cur] = (savingsByCurrency[cur] || 0) + d.savings_amount
      }
      const sc = o?.score
      if (typeof sc === 'number') { scoreSum += sc; scoreCount++ }
      if (!lastActivity || new Date(d.updated_at) > new Date(lastActivity)) lastActivity = d.updated_at
    }

    return {
      id: v.id,
      name: v.canonical_name,
      aliases: v.aliases || [],
      dealCount: ds.length,
      totalsByCurrency,
      savingsByCurrency,
      avgScore: scoreCount ? Math.round(scoreSum / scoreCount) : null,
      lastActivity,
    }
  })

  rows.sort((a, b) => new Date(b.lastActivity || 0).getTime() - new Date(a.lastActivity || 0).getTime())
  return rows
}

// ── currency display (no conversion) ─────────────────────────────────────────
const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', CAD: 'C$', AUD: 'A$' }
export function currencySymbol(code: string): string { return SYMBOL[code] || `${code} ` }

export function compactMoney(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1000)}K`
  return String(Math.round(n))
}

/**
 * One number in the account's base currency, converted with the same live
 * rates Home uses. Falls back to the unconverted sum if rates are unavailable.
 */
export async function sumInBase(map: Record<string, number>, base: Currency): Promise<number> {
  let total = 0
  for (const [cur, amount] of Object.entries(map)) {
    if (!(amount > 0)) continue
    const from = (SUPPORTED_CURRENCIES as readonly string[]).includes(cur) ? (cur as Currency) : detectCurrency(cur)
    if (from === base) { total += amount; continue }
    try { total += await convertCurrency(amount, from, base) } catch { total += amount }
  }
  return Math.round(total)
}

/** "€42K + $18K" across currencies, or "—" when empty. */
export function formatTotals(map: Record<string, number>): string {
  const parts = Object.entries(map)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([cur, v]) => `${currencySymbol(cur)}${compactMoney(v)}`)
  return parts.length ? parts.join(' + ') : '—'
}

// ── concession ledger (from close_summary.wins on won deals) ─────────────────
function parseCloseSummary(cs: unknown): any {
  if (!cs) return null
  if (typeof cs === 'object') return cs
  try { return JSON.parse(cs as string) } catch { return null }
}

export interface Concession {
  description: string
  impact: string | null
  category?: string
  dealId: string
  dealName: string
  date: string | null
}

export function concessionsFromDeals(deals: DealLite[]): Concession[] {
  const out: Concession[] = []
  for (const d of deals) {
    if (d.status !== 'closed_won') continue
    const wins = parseCloseSummary(d.close_summary)?.wins
    if (!Array.isArray(wins)) continue
    const dealName = d.vendor || latestOutput(d)?.vendor || 'Deal'
    const date = d.closed_at || d.updated_at || null
    for (const w of wins) {
      if (!w?.description) continue
      out.push({ description: String(w.description), impact: w.financial_impact || null, category: w.category, dealId: d.id, dealName, date })
    }
  }
  out.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
  return out
}

// ── fee patterns (from each deal's extraction, chronological) ────────────────
export interface FeeRatePoint { monthLabel: string; pct: number | null; amount: number | null }
export interface FeePattern { name: string; points: FeeRatePoint[]; rising: boolean }

export function hasAnyExtraction(deals: DealLite[]): boolean {
  return deals.some((d) => Array.isArray(latestOutput(d)?.extraction?.fees))
}

export function feePatternsFromDeals(deals: DealLite[]): FeePattern[] {
  const sorted = [...deals].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const groups = new Map<string, { name: string; points: FeeRatePoint[] }>()
  for (const d of sorted) {
    const fees = latestOutput(d)?.extraction?.fees
    if (!Array.isArray(fees)) continue
    const monthLabel = new Date(d.created_at).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    for (const f of fees) {
      const name = String(f?.name || f?.type || 'fee')
      const key = name.toLowerCase()
      const g = groups.get(key) || { name, points: [] }
      g.points.push({
        monthLabel,
        pct: typeof f?.percentage === 'number' ? f.percentage : null,
        amount: typeof f?.dollarAmount === 'number' ? f.dollarAmount : null,
      })
      groups.set(key, g)
    }
  }
  const comparable = (p: FeeRatePoint) => p.pct ?? p.amount ?? null
  return [...groups.values()].map((g) => {
    const first = comparable(g.points[0])
    const last = comparable(g.points[g.points.length - 1])
    const rising = g.points.length > 1 && first != null && last != null && last > first
    return { name: g.name, points: g.points, rising }
  })
}
