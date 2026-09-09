/**
 * Small per-IP throttle for the public, unauthenticated routes (upload, extract,
 * contact, subscribe). In-memory, so it is per serverless instance and resets on
 * cold start — it blunts casual abuse and scripted spam, not a determined
 * attacker. Authenticated routes use lib/rate-limit.ts (database-backed).
 */

const buckets = new Map<string, { count: number; resetAt: number }>()
let lastSweep = 0

/** Real client IP from the platform headers; x-forwarded-for is client-spoofable, so take its last entry. */
export function clientIp(request: Request): string {
  const real = request.headers.get('x-real-ip') || request.headers.get('x-vercel-forwarded-for')
  if (real) return real.trim()
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded.split(',')
    return parts[parts.length - 1].trim()
  }
  return 'unknown'
}

/** True when this IP is still under `max` hits in the current `windowMs` for `scope`. */
export function allowIp(scope: string, ip: string, max: number, windowMs: number): boolean {
  if (ip === 'unknown') return true
  const now = Date.now()
  if (now - lastSweep > 10 * 60 * 1000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
    lastSweep = now
  }
  const key = `${scope}:${ip}`
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (b.count >= max) return false
  b.count += 1
  return true
}

export const tooMany = (message = 'Too many requests. Please try again later.') =>
  new Response(JSON.stringify({ error: message }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' } })
