/**
 * The Stripe dashboard endpoint from the earlier subscription build points at
 * /api/stripe/webhook, with the signing secret already in Vercel. Keep that URL
 * alive and hand it to the current handler, so no dashboard change is needed.
 */
export { POST } from '@/app/api/billing/webhook/route'
