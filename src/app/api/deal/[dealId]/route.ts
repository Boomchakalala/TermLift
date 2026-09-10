import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { deleteDeal } from '@/lib/deal-deletion'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await params
    const supabase = await createClient()

    // Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get deal to check ownership
    const { data: deal } = await supabase
      .from('deals')
      .select('user_id, status')
      .eq('id', dealId)
      .single()

    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    if (deal.user_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Service role: rounds cascade, linked negotiation requests and their
    // stored documents are removed explicitly (ownership verified above).
    const result = await deleteDeal(createAdminClient(), dealId)
    console.log(`[deal-delete] removed; negotiation requests: ${result.requestsDeleted}, documents: ${result.documentsDeleted}`)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete deal error:', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { error: 'Failed to delete deal' },
      { status: 500 }
    )
  }
}

/**
 * Change the deal type (New | Renewal). The stored value is the one every
 * later prompt receives (Playbook, rounds, emails); the analysis already run
 * is not redone. Used by the "Looks like a renewal" banner's one-click switch.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await params
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const dealType = body?.dealType
    if (dealType !== 'New' && dealType !== 'Renewal') {
      return NextResponse.json({ error: 'dealType must be "New" or "Renewal"' }, { status: 400 })
    }

    const { data: deal, error } = await supabase
      .from('deals')
      .update({ deal_type: dealType, updated_at: new Date().toISOString() })
      .eq('id', dealId)
      .eq('user_id', user.id)
      .select('id, deal_type')
      .single()
    if (error || !deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

    // Record the person's decision next to the inference on the latest round, so
    // the banner stays dismissed and the email route knows the type was confirmed.
    const { data: round } = await supabase
      .from('rounds').select('id, output_json').eq('deal_id', dealId).eq('user_id', user.id)
      .order('round_number', { ascending: false }).limit(1).single()
    if (round) {
      const oj = (round.output_json as Record<string, unknown>) || {}
      const prev = (oj.inferred_deal_type as Record<string, unknown>) || {}
      const snap = { ...((oj.snapshot as Record<string, unknown>) || {}) }
      if (snap.deal_type && !snap.deal_type_stated) snap.deal_type_stated = snap.deal_type
      snap.deal_type = dealType === 'Renewal' ? 'Renewal' : 'New purchase'
      await supabase.from('rounds').update({ output_json: { ...oj, snapshot: snap, inferred_deal_type: { ...prev, user_confirmed_type: dealType, user_confirmed_at: new Date().toISOString() } } }).eq('id', round.id).eq('user_id', user.id)
    }

    return NextResponse.json({ success: true, dealType: deal.deal_type })
  } catch (error) {
    console.error('Update deal type error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Failed to update deal' }, { status: 500 })
  }
}
