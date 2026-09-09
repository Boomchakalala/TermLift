import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe, stripeConfigured } from '@/lib/stripe'
import { recordCheckoutSession } from '@/lib/billing'

/**
 * Stripe webhook. Configure the endpoint in the Stripe dashboard as
 * https://www.termlift.com/api/billing/webhook with the events
 * checkout.session.completed and checkout.session.async_payment_succeeded,
 * and set STRIPE_WEBHOOK_SECRET to its signing secret.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripeConfigured() || !secret) return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  const signature = request.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  let event: Stripe.Event
  try {
    const raw = await request.text()
    event = getStripe().webhooks.constructEvent(raw, signature, secret)
  } catch (err) {
    console.error('[billing] webhook signature failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Bad signature' }, { status: 400 })
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.metadata?.product === 'negotiation_playbook') await recordCheckoutSession(session)
    }
  } catch (err) {
    console.error('[billing] webhook handling failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }
  return NextResponse.json({ received: true })
}
