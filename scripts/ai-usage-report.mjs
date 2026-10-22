// Cost per AI action and per deal from ai_usage_events (service role). Usage: node scripts/ai-usage-report.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,'')]}))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data, error } = await db.from('ai_usage_events').select('action, model, estimated_cost_usd, input_tokens, output_tokens, latency_ms, created_at, deal_id').order('created_at', { ascending: false }).limit(2000)
if (error) { console.error(error); process.exit(1) }
console.log('events:', data.length, 'oldest:', data.at(-1)?.created_at?.slice(0,10), 'newest:', data[0]?.created_at?.slice(0,10))
const agg = {}
for (const e of data) { const a = agg[e.action] ||= { n:0, cost:0, inTok:0, outTok:0, lat:0 }; a.n++; a.cost += +e.estimated_cost_usd||0; a.inTok += e.input_tokens||0; a.outTok += e.output_tokens||0; a.lat += e.latency_ms||0 }
console.log('action'.padEnd(26), 'calls', 'avg$'.padStart(8), 'total$'.padStart(8), 'avgIn'.padStart(7), 'avgOut'.padStart(7), 'avgMs'.padStart(7))
for (const [k,a] of Object.entries(agg).sort((x,y)=>y[1].cost-x[1].cost)) console.log(k.padEnd(26), String(a.n).padStart(5), (a.cost/a.n).toFixed(4).padStart(8), a.cost.toFixed(2).padStart(8), Math.round(a.inTok/a.n).toString().padStart(7), Math.round(a.outTok/a.n).toString().padStart(7), Math.round(a.lat/a.n).toString().padStart(7))
const total = data.reduce((s,e)=>s+(+e.estimated_cost_usd||0),0)
const deals = new Set(data.map(e=>e.deal_id).filter(Boolean)).size
console.log('total $', total.toFixed(2), 'distinct deals', deals, '=> $/deal', (total/Math.max(1,deals)).toFixed(3))
const byModel = {}
for (const e of data) byModel[e.model] = (byModel[e.model]||0) + (+e.estimated_cost_usd||0)
console.log('by model', JSON.stringify(Object.fromEntries(Object.entries(byModel).map(([k,v])=>[k,+v.toFixed(2)]))))
