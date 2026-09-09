import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { aggregateVendors, sumInBase } from '@/lib/vendor-aggregate'
import { fetchRates, type Currency } from '@/lib/currency'
import { VendorsListClient } from '@/components/VendorsListClient'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Vendors' }

export default async function VendorsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: vendors }, { data: deals }, { data: profile }] = await Promise.all([
    supabase.from('vendors').select('id, canonical_name, aliases').eq('user_id', user.id),
    supabase
      .from('deals')
      .select('id, vendor_id, status, savings_amount, final_total, updated_at, created_at, rounds(output_json, round_number)')
      .eq('user_id', user.id)
      .not('vendor_id', 'is', null),
    supabase.from('profiles').select('base_currency').eq('id', user.id).single(),
  ])

  const baseCurrency = ((profile?.base_currency as Currency) || 'EUR') as Currency
  const rows = aggregateVendors(vendors || [], (deals as any) || [])
  // Same conversion Home uses for its tiles, so "spend" and "saved" are one number in the base currency.
  try { await fetchRates() } catch { /* fall back to unconverted sums */ }
  for (const r of rows) {
    r.totalBase = await sumInBase(r.totalsByCurrency, baseCurrency)
    r.savingsBase = await sumInBase(r.savingsByCurrency, baseCurrency)
  }
  return <VendorsListClient rows={rows} baseCurrency={baseCurrency} />
}
