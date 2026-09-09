import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe, stripeConfigured } from '@/lib/stripe'
import { recordCheckoutSession } from '@/lib/billing'

/**
 * Called by the page the user lands on after Checkout. Verifies the session
 * with Stripe and records the purchase, so the Playbook can start right away
 * without waiting for the webhook (which records the same row idempotently).
 */
export async function POST(request: Request) {
  if (!stripeConfigured()) return NextResponse.json({ error: 'Payments are not configured.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { sessionId?: string } = {}
  try { body = await request.json() } catch { /* handled below */ }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return NextResponse.json({ error: 'Invalid session' }, { status: 400 })

  const session = await getStripe().checkout.sessions.retrieve(sessionId)
  if (session.metadata?.user_id !== user.id) return NextResponse.json({ error: 'Not your session' }, { status: 403 })
  if (session.payment_status !== 'paid') return NextResponse.json({ ok: false, status: session.payment_status })

  const purchase = await recordCheckoutSession(session)
  return NextResponse.json({ ok: !!purchase, dealId: purchase?.deal_id ?? null })
}
