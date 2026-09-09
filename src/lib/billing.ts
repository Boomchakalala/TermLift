import 'server-only'
/**
 * Server side of Playbook billing: gathers the facts for lib/billing-rules.ts,
 * records Stripe Checkout sessions as purchases, and attaches credits to deals.
 * All writes go through the service role (RLS allows users to read their own
 * purchases only).
 */
import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe'
import { playbookAccess, type PlaybookAccess } from '@/lib/billing-rules'

export interface PurchaseRow {
  id: string
  user_id: string
  deal_id: string | null
  assigned_at: string | null
  stripe_checkout_session_id: string
  stripe_payment_intent_id: string | null
  stripe_customer_id: string | null
  amount_cents: number
  currency: string
  status: string
  invoice_url: string | null
  created_at: string
}

/** Facts → access, for one user and (optionally) one deal. */
export async function getPlaybookAccess(userId: string, dealId: string | null, isAdmin: boolean): Promise<PlaybookAccess> {
  if (isAdmin) return playbookAccess({ isAdmin: true, purchasedForDeal: false, hasAnyPlaybook: false, hasUnassignedCredit: false })
  const admin = createAdminClient()
  const [{ data: purchases }, { count: doneRounds }] = await Promise.all([
    admin.from('playbook_purchases').select('deal_id, assigned_at').eq('user_id', userId).eq('status', 'paid'),
    admin.from('rounds').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('output_json->>deep_analysis_status', 'done'),
  ])
  const rows = (purchases || []) as Array<{ deal_id: string | null; assigned_at: string | null }>
  return playbookAccess({
    isAdmin: false,
    purchasedForDeal: !!dealId && rows.some((p) => p.deal_id === dealId),
    hasAnyPlaybook: (doneRounds || 0) > 0 || rows.length > 0,
    hasUnassignedCredit: rows.some((p) => !p.deal_id && !p.assigned_at),
  })
}

/** Attach the oldest unassigned credit to a deal. Returns false when there is none. */
export async function consumeCredit(userId: string, dealId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data: credit } = await admin
    .from('playbook_purchases')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'paid')
    .is('deal_id', null)
    .is('assigned_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!credit) return false
  const { error } = await admin
    .from('playbook_purchases')
    .update({ deal_id: dealId, assigned_at: new Date().toISOString() })
    .eq('id', credit.id)
    .is('deal_id', null)
  return !error
}

/**
 * Record a paid Checkout Session as a purchase (idempotent on the session id).
 * Called from the webhook and from the post-checkout confirm route, whichever
 * lands first. Returns the purchase row, or null when the session is not paid.
 */
export async function recordCheckoutSession(session: Stripe.Checkout.Session): Promise<PurchaseRow | null> {
  if (session.payment_status !== 'paid') return null
  const userId = session.metadata?.user_id
  if (!userId) return null
  const dealId = session.metadata?.deal_id || null
  const admin = createAdminClient()

  const { data: existing } = await admin.from('playbook_purchases').select('*').eq('stripe_checkout_session_id', session.id).maybeSingle()
  if (existing) return existing as PurchaseRow

  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null
  let invoiceUrl: string | null = null
  if (session.invoice) {
    try {
      const inv = typeof session.invoice === 'string' ? await getStripe().invoices.retrieve(session.invoice) : session.invoice
      invoiceUrl = inv.hosted_invoice_url ?? null
    } catch { /* the invoice link is a convenience */ }
  }

  const row = {
    user_id: userId,
    deal_id: dealId,
    assigned_at: dealId ? new Date().toISOString() : null,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null,
    stripe_customer_id: customerId,
    amount_cents: session.amount_total ?? 0,
    currency: session.currency ?? 'eur',
    status: 'paid',
    invoice_url: invoiceUrl,
  }
  const { data, error } = await admin.from('playbook_purchases').insert(row).select('*').single()
  if (error) {
    // Unique violation: the other path (webhook vs confirm) got there first.
    const { data: again } = await admin.from('playbook_purchases').select('*').eq('stripe_checkout_session_id', session.id).maybeSingle()
    return (again as PurchaseRow) ?? null
  }
  if (customerId) {
    await admin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', userId).is('stripe_customer_id', null)
  }
  return data as PurchaseRow
}

export async function listPurchases(userId: string): Promise<PurchaseRow[]> {
  const admin = createAdminClient()
  const { data } = await admin.from('playbook_purchases').select('*').eq('user_id', userId).order('created_at', { ascending: false })
  return (data || []) as PurchaseRow[]
}
