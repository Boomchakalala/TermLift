// One-off: freeze savings for won deals closed before 2026-10-22, into
// deals.verification.savings_frozen (see lib/verification.ts FrozenSavings).
// Uses the account's base currency and today's open.er-api rate (there is no
// historical rate for the close date), stamps frozen_at = now.
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
  .select('id, user_id, status, savings_amount, verification, final_total_provenance, closed_at, rounds(output_json, round_number)')
  .eq('status', 'closed_won').gt('savings_amount', 0)
if (error) { console.error(error); process.exit(1) }
const todo = deals.filter((d) => !d.verification?.savings_frozen)
const { data: profiles } = await db.from('profiles').select('id, base_currency').in('id', [...new Set(todo.map((d) => d.user_id))])
const baseOf = new Map((profiles || []).map((p) => [p.id, p.base_currency || 'EUR']))

console.log(`${deals.length} won deals, ${todo.length} without a frozen figure`)
const now = new Date().toISOString()
for (const d of todo) {
  const first = [...(d.rounds || [])].sort((a, b) => (a.round_number || 0) - (b.round_number || 0))[0]
  const snap = first?.output_json?.snapshot || {}
  const cur = detectCurrency(String(snap.currency || snap.total_commitment || ''))
  const base = baseOf.get(d.user_id) || 'EUR'
  const amount = convert(d.savings_amount, cur, base)
  const fx = Math.round((amount / d.savings_amount) * 1e6) / 1e6
  const hasRecord = !!d.verification
  console.log(`${d.id}  ${cur} ${d.savings_amount} -> ${base} ${amount}  (rate ${fx})  closed ${String(d.closed_at).slice(0, 10)}${hasRecord ? '' : '  [no verification record: will create a minimal one]'}`)
  if (write) {
    const verification = { ...(d.verification || { version: 1, tier: d.final_total_provenance || 'user_confirmed', method: d.final_total_provenance === 'document_verified' ? 'final_document_extract' : 'user_entry', verified_at: d.closed_at || now, confirmed_total: null, currency: cur, document: null, extracted_total: null, matched: null }), savings_frozen: { amount, currency: base, fx_rate: fx, frozen_at: now } }
    const { error: e } = await db.from('deals').update({ verification }).eq('id', d.id)
    if (e) console.error('  update failed:', e.message)
  }
}
console.log(write ? 'written' : 'dry run — rerun with --write')
