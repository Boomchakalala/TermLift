import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { deleteDeal } from '@/lib/deal-deletion'

export async function GET(request: Request) {
  try {
    const supabase = await createClient()

    // Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get all deals for the user
    const { data: deals, error } = await supabase
      .from('deals')
      .select(`
        *,
        rounds (
          id,
          round_number,
          created_at,
          status
        )
      `)
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })

    if (error) {
      throw error
    }

    return NextResponse.json({ deals: deals || [] })
  } catch (error) {
    console.error('Get deals error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Bulk delete: `{ ids: string[] }`. Only the caller's own deals are removed;
 * ids that don't exist or belong to someone else are silently skipped and
 * reported back in `skipped`, so a stale list on the client is not an error.
 */
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown): id is string => typeof id === 'string') : []
    if (ids.length === 0 || ids.length > 200) {
      return NextResponse.json({ error: 'Provide 1-200 deal ids' }, { status: 400 })
    }

    // Ownership check under RLS: anything not returned is not ours.
    const { data: owned, error: ownedErr } = await supabase
      .from('deals')
      .select('id')
      .eq('user_id', user.id)
      .in('id', ids)
    if (ownedErr) throw ownedErr

    const ownedIds = (owned || []).map((d) => d.id as string)
    const admin = createAdminClient()
    const failed: string[] = []
    for (const id of ownedIds) {
      try {
        await deleteDeal(admin, id)
      } catch (err) {
        console.error(`[deals-bulk-delete] ${id}:`, err instanceof Error ? err.message : err)
        failed.push(id)
      }
    }

    const deleted = ownedIds.filter((id) => !failed.includes(id))
    console.log(`[deals-bulk-delete] requested ${ids.length}, deleted ${deleted.length}, failed ${failed.length}`)
    return NextResponse.json({
      success: failed.length === 0,
      deleted,
      failed,
      skipped: ids.filter((id: string) => !ownedIds.includes(id)),
    })
  } catch (error) {
    console.error('Bulk delete deals error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Failed to delete deals' }, { status: 500 })
  }
}
