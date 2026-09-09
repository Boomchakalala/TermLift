import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { allowIp, clientIp, tooMany } from '@/lib/ip-limit'

export async function POST(request: Request) {
  try {
    const { email, source } = await request.json().catch(() => ({}))

    if (typeof email !== 'string' || !email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) || email.length > 320) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
    }
    if (!allowIp('subscribe', clientIp(request), 10, 60 * 60 * 1000)) return tooMany()

    const supabase = createAdminClient()

    // Upsert to avoid duplicates — if email exists, update source and timestamp
    const { error } = await supabase.from('email_subscribers').upsert(
      {
        email: email.trim().toLowerCase(),
        source: source || 'unknown',
        created_at: new Date().toISOString(),
      },
      { onConflict: 'email' }
    )

    if (error) {
      console.error('Subscribe error:', error)
      // If table doesn't exist yet, still return success
      if (error.code === '42P01') {
        console.warn('email_subscribers table does not exist yet — skipping DB insert')
      } else {
        return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Subscribe API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
