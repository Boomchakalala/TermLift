import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe, stripeConfigured, appOrigin } from '@/lib/stripe'
import { getPlaybookAccess } from '@/lib/billing'
import { resolveRequestLocale } from '@/lib/request-locale'
import { DEEP_ANALYSIS_PRICE_EUR } from '@/lib/pricing'

/**
 * Start a Stripe Checkout for one Negotiation Playbook.
 *   { dealId }  → pays for that deal; returns to the deal page, which builds the Playbook.
 *   {}          → buys a credit for the next deal; returns to /app/new.
 * One-time payment in EUR; Stripe collects the billing address and an optional
 * VAT number and issues the invoice.
 */
export async function POST(request: Request) {
  if (!stripeConfigured()) return NextResponse.json({ error: 'Payments are not configured.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { dealId?: string; locale?: string } = {}
  try { body = await request.json() } catch { /* empty body is fine */ }
  const dealId = typeof body.dealId === 'string' && body.dealId ? body.dealId : null
  const locale = await resolveRequestLocale(body.locale)
  const fr = locale === 'fr'

  const { data: profile } = await supabase.from('profiles').select('is_admin, stripe_customer_id').eq('id', user.id).single()

  let vendor: string | null = null
  if (dealId) {
    const { data: deal } = await supabase.from('deals').select('id, vendor').eq('id', dealId).eq('user_id', user.id).single()
    if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    vendor = deal.vendor
    // Nothing to sell when the Playbook is already covered.
    const access = await getPlaybookAccess(user.id, dealId, !!profile?.is_admin)
    if (access.granted) return NextResponse.json({ error: 'This Playbook is already included.', granted: true }, { status: 409 })
  }

  const origin = appOrigin()
  const back = dealId ? `${origin}/app/deal/${dealId}` : `${origin}/app/new`
  const stripe = getStripe()
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    locale: fr ? 'fr' : 'en',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: DEEP_ANALYSIS_PRICE_EUR * 100,
        // Terms: prices exclude VAT. Stripe Tax adds the right rate per billing address (reverse charge with a valid EU VAT number).
        tax_behavior: 'exclusive',
        product_data: {
          name: fr ? 'Plan de négociation' : 'Negotiation Playbook',
          description: vendor
            ? (fr ? `Dossier ${vendor} · une fois, par dossier` : `Deal: ${vendor} · one time, per deal`)
            : (fr ? 'Votre prochain dossier · une fois, par dossier' : 'Your next deal · one time, per deal'),
        },
      },
    }],
    ...(profile?.stripe_customer_id
      ? { customer: profile.stripe_customer_id, customer_update: { address: 'auto', name: 'auto' } }
      : { customer_email: user.email ?? undefined, customer_creation: 'always' as const }),
    billing_address_collection: 'required',
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    invoice_creation: { enabled: true },
    allow_promotion_codes: true,
    metadata: { user_id: user.id, deal_id: dealId ?? '', product: 'negotiation_playbook' },
    payment_intent_data: { metadata: { user_id: user.id, deal_id: dealId ?? '', product: 'negotiation_playbook' } },
    success_url: `${back}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${back}?checkout=cancelled`,
  })

  if (!session.url) return NextResponse.json({ error: 'Could not start the payment.' }, { status: 502 })
  return NextResponse.json({ url: session.url })
}
