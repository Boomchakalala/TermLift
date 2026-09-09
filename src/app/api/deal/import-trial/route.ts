import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { renderMarkdown } from '@/lib/render-markdown'
import { checkFreeQuota } from '@/lib/pricing'
import { getPlaybookAccess, consumeCredit } from '@/lib/billing'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    // Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile and check usage limit
    let useCredit = false
    const { data: profile } = await supabase
      .from('profiles')
      .select('usage_count, is_admin')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Rate limiting and free-quota enforcement (admins bypass)
    if (!profile.is_admin) {
      const rateLimit = await checkRateLimit(user.id)
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: rateLimit.message || 'Rate limit exceeded', remaining: rateLimit.remaining, resetAt: rateLimit.resetAt },
          { status: 429 }
        )
      }
      const quota = checkFreeQuota(profile.usage_count || 0)
      if (!quota.allowed) {
        const access = await getPlaybookAccess(user.id, null, false)
        if (!access.granted) return NextResponse.json({ error: quota.message, paymentRequired: true }, { status: 402 })
        if (access.kind === 'credit') useCredit = true
      }
    }

    // Parse request body
    const body = await request.json()
    const { output, dealType, goal, extractedText } = body

    if (!output || !dealType) {
      return NextResponse.json({ error: 'Missing required fields: output, dealType' }, { status: 400 })
    }

    // Create deal
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .insert({
        user_id: user.id,
        vendor: output.vendor,
        title: output.title,
        deal_type: dealType,
        goal: goal || null,
      })
      .select()
      .single()

    if (dealError || !deal) {
      throw new Error('Failed to create deal')
    }

    // Create Round 1
    const { data: round, error: roundError } = await supabase
      .from('rounds')
      .insert({
        deal_id: deal.id,
        user_id: user.id,
        round_number: 1,
        extracted_text: extractedText || null,
        output_json: output,
        output_markdown: renderMarkdown(output),
        status: 'done',
        model_version: 'claude-sonnet-4',
      })
      .select()
      .single()

    if (roundError || !round) {
      throw new Error('Failed to create round')
    }

    if (useCredit) await consumeCredit(user.id, deal.id)

    // Increment usage count (skip for admins)
    if (!profile.is_admin) {
      // usage_count is a server-owned column (users cannot update it); the service role writes it.
      await createAdminClient()
        .from('profiles')
        .update({ usage_count: profile.usage_count + 1 })
        .eq('id', user.id)
    }

    return NextResponse.json({
      dealId: deal.id,
      roundId: round.id,
    })
  } catch (error) {
    console.error('Import trial error:', error)
    // CRITICAL: Never send raw error.message to client - may contain sensitive data
    return NextResponse.json({
      error: 'Failed to import trial. Please try again or contact support.'
    }, { status: 500 })
  }
}

