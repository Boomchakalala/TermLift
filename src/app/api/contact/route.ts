import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { emailAdmins } from '@/lib/notifications'
import { allowIp, clientIp, tooMany } from '@/lib/ip-limit'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function POST(request: Request) {
  try {
    const { name, email, subject, message } = await request.json().catch(() => ({}))

    if (typeof name !== 'string' || typeof email !== 'string' || typeof message !== 'string' || !name.trim() || !email.trim() || !message.trim()) {
      return NextResponse.json({ error: 'Name, email, and message are required' }, { status: 400 })
    }
    if (!EMAIL_RE.test(email.trim()) || name.length > 200 || email.length > 320 || message.length > 5000 || (subject !== undefined && (typeof subject !== 'string' || subject.length > 200))) {
      return NextResponse.json({ error: 'Please check the email address and keep the message under 5000 characters.' }, { status: 400 })
    }
    // Each submission emails the team: a few per hour per network is plenty.
    if (!allowIp('contact', clientIp(request), 5, 60 * 60 * 1000)) return tooMany()

    const supabase = await createClient()

    const { error } = await supabase.from('contact_submissions').insert({
      name: name.trim(),
      email: email.trim(),
      subject: subject || 'General question',
      message: message.trim(),
      created_at: new Date().toISOString(),
    })

    if (error) {
      console.error('Contact submission error:', error)
      // If table doesn't exist yet, still return success to not block users
      if (error.code === '42P01') {
        console.warn('contact_submissions table does not exist yet — skipping DB insert')
      } else {
        return NextResponse.json({ error: 'Failed to save message' }, { status: 500 })
      }
    }

    // Tell the humans. Inert until RESEND_API_KEY is set; never blocks the reply.
    try {
      await emailAdmins(
        `[Contact] ${subject || 'General question'} — ${name.trim()}`,
        `From: ${name.trim()} <${email.trim()}>\nSubject: ${subject || 'General question'}\n\n${message.trim()}`,
        email.trim(),
      )
    } catch (err) {
      console.error('Contact email error:', err)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Contact API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
