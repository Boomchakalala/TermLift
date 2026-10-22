// Repair: data scripts (vendor link, savings backfill) bumped deals.updated_at. Put it back to the
// last real activity: closed_at for closed deals, else the latest round's created_at.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,'')]}))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const ids = process.argv.slice(2)
const { data: deals } = await db.from('deals').select('id, status, closed_at, updated_at, rounds(created_at)').in('id', ids)
for (const d of deals) {
  const lastRound = (d.rounds || []).map(r => r.created_at).sort().at(-1)
  const target = d.status?.startsWith('closed_') && d.closed_at ? d.closed_at : lastRound
  if (!target) { console.log(d.id, 'no reference, skipped'); continue }
  const { error } = await db.from('deals').update({ updated_at: target }).eq('id', d.id)
  console.log(d.id, d.updated_at.slice(0,16), '->', target.slice(0,16), error ? error.message : 'ok')
}
