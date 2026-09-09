import { createClient } from '@/lib/supabase/server'
import { applyVipStatus } from '@/lib/vip-emails'
import { NextResponse } from 'next/server'

// Handles email confirmation links and password reset links from Supabase
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/app'

  if (token_hash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as any,
    })

    if (!error) {
      // For password recovery, redirect to the reset password page
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/reset-password?type=recovery`)
      }

      // For email confirmation, ensure profile exists
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .single()

        if (!existingProfile) {
          await supabase.from('profiles').insert({
            id: user.id,
            email: user.email || '',
            locale: 'en',
          })
        }
        await applyVipStatus(supabase, user.id, user.email)
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=invalid_link`)
}
