import 'server-only'
import Stripe from 'stripe'

let client: Stripe | null = null

/** Server-side Stripe client. Throws when the secret key is not configured, so callers can 503 cleanly. */
export function getStripe(): Stripe {
  if (client) return client
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  client = new Stripe(key, { typescript: true })
  return client
}

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

/** Absolute origin for Checkout return URLs. Production must set NEXT_PUBLIC_APP_URL. */
export function appOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL || 'https://www.termlift.com'
  return raw.replace(/\/+$/, '')
}
