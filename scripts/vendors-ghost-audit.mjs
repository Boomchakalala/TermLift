// Vendor hygiene, run with the service role from the project root.
//
//   node scripts/vendors-ghost-audit.mjs                         dry run: ghosts per user + deals with no vendor_id
//   node scripts/vendors-ghost-audit.mjs --link                  link every deal with vendor_id NULL to its vendor
//                                                                (exact normalized-key match or alias, else create — same
//                                                                rule as lib/vendor-resolve.ts)
//   node scripts/vendors-ghost-audit.mjs --delete <user_id> <backup.json>
//                                                                delete that user's vendors with no deal AND no note,
//                                                                after writing them to <backup.json>
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Port of lib/vendor-normalize.ts normalizeVendorName — keep in sync.
const LEGAL_SUFFIXES = new Set(['llc', 'inc', 'ltd', 'sarl', 'sas', 'gmbh', 'bv', 'corp', 'co'])
function normalizeVendorName(name) {
  if (!name) return ''
  let s = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  s = s.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
  const tokens = s.split(' ').filter(Boolean)
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop()
  return tokens.join(' ')
}

async function load() {
  const [{ data: vendors, error: e1 }, { data: deals, error: e2 }, { data: notes, error: e3 }] = await Promise.all([
    db.from('vendors').select('id, user_id, canonical_name, normalized_key, aliases, alias_keys, created_at'),
    db.from('deals').select('id, user_id, vendor_id, vendor, title, status, created_at'),
    db.from('vendor_notes').select('id, vendor_id'),
  ])
  if (e1 || e2 || e3) { console.error(e1 || e2 || e3); process.exit(1) }
  return { vendors, deals, notes }
}

const args = process.argv.slice(2)
const mode = args[0] || '--audit'

if (mode === '--link') {
  const { vendors, deals } = await load()
  const orphans = deals.filter((d) => !d.vendor_id)
  for (const d of orphans) {
    const name = (d.vendor || '').trim()
    const key = normalizeVendorName(name)
    if (!key) { console.log(`skip ${d.id}: no vendor name`); continue }
    let v = vendors.find((x) => x.user_id === d.user_id && x.normalized_key === key)
      || vendors.find((x) => x.user_id === d.user_id && (x.alias_keys || []).includes(key))
    if (!v) {
      const { data, error } = await db.from('vendors').insert({ user_id: d.user_id, canonical_name: name, normalized_key: key, aliases: [], alias_keys: [] }).select('id, user_id, canonical_name, normalized_key, aliases, alias_keys, created_at').single()
      if (error) { console.error(`create failed for ${d.id}:`, error.message); continue }
      v = data; vendors.push(v)
      console.log(`created vendor ${v.id} ${JSON.stringify(name)} for user ${d.user_id}`)
    }
    const { error } = await db.from('deals').update({ vendor_id: v.id }).eq('id', d.id)
    if (error) console.error(`link failed for ${d.id}:`, error.message)
    else console.log(`linked deal ${d.id} (${JSON.stringify(name)}) -> vendor ${v.id} ${JSON.stringify(v.canonical_name)}`)
  }
  process.exit(0)
}

const { vendors, deals, notes } = await load()
const dealsByVendor = new Map()
for (const d of deals) if (d.vendor_id) dealsByVendor.set(d.vendor_id, (dealsByVendor.get(d.vendor_id) || 0) + 1)
const notesByVendor = new Map()
for (const n of notes) notesByVendor.set(n.vendor_id, (notesByVendor.get(n.vendor_id) || 0) + 1)
const rows = vendors.map((v) => ({ ...v, deals: dealsByVendor.get(v.id) || 0, notes: notesByVendor.get(v.id) || 0 }))
const byUser = new Map()
for (const r of rows) { const a = byUser.get(r.user_id) || []; a.push(r); byUser.set(r.user_id, a) }

for (const [user, list] of byUser) {
  const ghosts = list.filter((r) => r.deals === 0)
  console.log(`\nuser ${user}: ${list.length} vendors, ${ghosts.length} with no deal`)
  for (const g of ghosts) console.log(`  ghost  ${g.id}  ${JSON.stringify(g.canonical_name)}  notes=${g.notes}  aliases=${JSON.stringify(g.aliases)}  created=${g.created_at.slice(0, 10)}`)
  for (const l of list.filter((r) => r.deals > 0)) console.log(`  keep   ${l.id}  ${JSON.stringify(l.canonical_name)}  deals=${l.deals}`)
}
const orphans = deals.filter((d) => !d.vendor_id)
console.log(`\ndeals with no vendor_id: ${orphans.length}`)
for (const d of orphans) console.log(`  ${d.id}  user=${d.user_id}  vendor=${JSON.stringify(d.vendor)}  status=${d.status}`)

if (mode === '--delete') {
  const [, userId, backupPath] = args
  if (!userId || !backupPath) { console.error('usage: --delete <user_id> <backup.json>'); process.exit(1) }
  const targets = (byUser.get(userId) || []).filter((r) => r.deals === 0 && r.notes === 0)
  writeFileSync(backupPath, JSON.stringify(targets, null, 2))
  console.log(`\nbacked up ${targets.length} vendors to ${backupPath}`)
  const { error, count } = await db.from('vendors').delete({ count: 'exact' }).in('id', targets.map((t) => t.id))
  if (error) { console.error(error); process.exit(1) }
  console.log(`deleted ${count} vendors for user ${userId}`)
}
