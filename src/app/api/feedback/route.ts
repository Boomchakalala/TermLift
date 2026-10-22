import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { emailAdmins } from '@/lib/notifications'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { rating, message, pageUrl } = await request.json()

    if (!message?.trim() && !rating) {
      return NextResponse.json({ error: 'Please provide a message or rating' }, { status: 400 })
    }

    const { error } = await supabase.from('feedback').insert({
      user_id: user.id,
      rating: rating || null,
      message: message?.trim() || null,
      page_url: pageUrl || null,
      created_at: new Date().toISOString(),
    })

    if (error) {
      console.error('Feedback error:', error)
      if (error.code === '42P01') {
        console.warn('feedback table does not exist yet — skipping DB insert')
      } else {
        return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 })
      }
    }

    // Feedback is the point of the free phase: it lands in the admins' inbox, not only in a table.
    try {
      const stars = rating ? `${'★'.repeat(Number(rating))}${'☆'.repeat(Math.max(0, 5 - Number(rating)))} (${rating}/5)` : 'no rating'
      await emailAdmins(
        `TermLift feedback · ${stars}`,
        `${message?.trim() || '(no message)'}

— ${user.email || user.id}
Page: ${pageUrl || '?'}
${new Date().toISOString()}`,
        user.email || undefined,
      )
    } catch (err) {
      console.error('Feedback email failed (row saved):', err)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Feedback API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
