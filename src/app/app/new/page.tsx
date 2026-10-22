import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { NewAnalysisClient } from './NewAnalysisClient'

/**
 * Free for everyone (2026-10-22). The only limits are the technical ceilings in
 * lib/ai-limits.ts, enforced by the create route, which answers with a plain
 * message the uploader shows in place.
 */
export default async function NewAnalysisPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return <NewAnalysisClient />
}
