// One-off: freeze savings_base for won deals closed before migration 20261022.
// Uses the account's base currency and today's open.er-api rate (there is no
// historical rate for the close date), stamps savings_frozen_at = now.
//
//   node scripts/backfill-savings-base.mjs          dry run
//   node scripts/backfill-savings-base.mjs --write  apply
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const write = process.argv.includes('--write')

// Same detection as lib/currency.ts detectCurrency.
function detectCurrency(text) {
  if (!text) return 'EUR'
  const u = text.toUpperCase()
  if (u.includes('EUR') || text.includes('€')) return 'EUR'
  if (u.includes('GBP') || text.includes('£')) return 'GBP'
  if (u.includes('CAD') || u.includes('C$')) return 'CAD'
  if (u.includes('AUD') || u.includes('A$')) return 'AUD'
  if (u.includes('CHF')) return 'CHF'
  if (u.includes('JPY') || text.includes('¥')) return 'JPY'
  if (u.includes('USD') || text.includes('$')) return 'USD'
  return 'EUR'
}

const ratesRes = await fetch('https://open.er-api.com/v6/latest/USD')
const { rates } = await ratesRes.json()
const convert = (amount, from, to) => {
  if (from === to) return amount
  const usd = from === 'USD' ? amount : amount / rates[from]
  return Math.round((to === 'USD' ? usd : usd * rates[to]) * 100) / 100
}

const { data: deals, error } = await db.from('deals')
  .select('id, user_id, status, savings_amount, savings_base, savings_base_currency, closed_at, rounds(output_json, round_number)')
  .eq('status', 'closed_won').gt('savings_amount', 0).is('savings_base', null)
if (error) { console.error(error); process.exit(1) }
const { data: profiles } = await db.from('profiles').select('id, base_currency').in('id', [...new Set(deals.map((d) => d.user_id))])
const baseOf = new Map(profiles.map((p) => [p.id, p.base_currency || 'EUR']))

console.log(`${deals.length} won deals without a frozen figure`)
const now = new Date().toISOString()
for (const d of deals) {
  const first = [...(d.rounds || [])].sort((a, b) => (a.round_number || 0) - (b.round_number || 0))[0]
  const snap = first?.output_json?.snapshot || {}
  const cur = detectCurrency(String(snap.currency || snap.total_commitment || ''))
  const base = baseOf.get(d.user_id) || 'EUR'
  const inBase = convert(d.savings_amount, cur, base)
  const fx = Math.round((inBase / d.savings_amount) * 1e6) / 1e6
  console.log(`${d.id}  ${cur} ${d.savings_amount} -> ${base} ${inBase}  (rate ${fx})  closed ${String(d.closed_at).slice(0, 10)}`)
  if (write) {
    const { error: e } = await db.from('deals').update({ savings_base: inBase, savings_base_currency: base, savings_fx_rate: fx, savings_frozen_at: now }).eq('id', d.id)
    if (e) console.error('  update failed:', e.message)
  }
}
console.log(write ? 'written' : 'dry run — rerun with --write')
