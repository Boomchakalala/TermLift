import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { NewAnalysisClient } from './NewAnalysisClient'
import { NewDealBilling } from './NewDealBilling'
import { checkFreeQuota, DEEP_ANALYSIS_PRICE_EUR, FREE_ANALYSIS_LIMIT } from '@/lib/pricing'
import { getPlaybookAccess } from '@/lib/billing'

/**
 * Past the free quick analyses a new deal is a Playbook deal. The server decides
 * before the form shows, so nobody uploads a quote and then hits a paywall:
 *   none    → the usual uploader
 *   credit  → uploader + "one Playbook paid and waiting"
 *   gate    → pay first (Stripe Checkout), the uploader appears on return
 */
export default async function NewAnalysisPage({ searchParams }: { searchParams: Promise<{ checkout?: string; session_id?: string }> }) {
  const { checkout, session_id: sessionId } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('usage_count, is_admin').eq('id', user.id).single()
  const isAdmin = !!profile?.is_admin

  let state: 'none' | 'credit' | 'gate' = 'none'
  if (!isAdmin && !checkFreeQuota(profile?.usage_count || 0).allowed) {
    const access = await getPlaybookAccess(user.id, null, false)
    state = access.granted ? (access.kind === 'credit' ? 'credit' : 'none') : 'gate'
  }

  const billing = (state !== 'none' || checkout)
    ? <NewDealBilling state={state} price={`€${DEEP_ANALYSIS_PRICE_EUR}`} limit={FREE_ANALYSIS_LIMIT} checkout={checkout ?? null} sessionId={sessionId ?? null} />
    : null

  return <NewAnalysisClient billing={billing} locked={state === 'gate'} />
}
