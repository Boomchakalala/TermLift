import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SettingsClient } from '@/components/SettingsClient'
import { formatCurrency, parseMoney, type Currency } from '@/lib/currency'
import { computeInsights, enrichDeals } from '@/lib/deal-insights'
import type { DealLike } from '@/lib/deal-metrics'
import { getTranslations } from 'next-intl/server'
import { cookies } from 'next/headers'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const t = await getTranslations()

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const { data: deals } = await supabase
    .from('deals')
    .select('id, status, savings_amount, rounds (id, output_json)')
    .eq('user_id', user.id)

  const { count: roundCount } = await supabase
    .from('rounds')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  const allDeals = deals || []
  const activeDeals = allDeals.filter(d => !d.status?.startsWith('closed_'))
  const closedDeals = allDeals.filter(d => d.status?.startsWith('closed_'))

  const baseCurrencyForInsights = (profile?.base_currency || 'EUR') as Currency
  // The one "saved" number: same pipeline as Home (won deals, converted to the base currency).
  const savingsAchieved = computeInsights(await enrichDeals(allDeals as unknown as DealLike[], baseCurrencyForInsights), baseCurrencyForInsights).savingsAchieved
  const totalSavingsIdentified = allDeals.reduce((sum, d) => {
    const rounds = (d as any).rounds || []
    const latest = rounds.sort((a: any, b: any) => (b.round_number || 0) - (a.round_number || 0))[0]
    const ps = latest?.output_json?.potential_savings as any
    if (!ps) return sum
    if (ps.must_have) return sum + (ps.must_have as any[]).reduce((s: number, item: any) => s + (typeof item.amount === 'number' ? item.amount : parseMoney(String(item.amount || '0')).amount), 0)
    if (ps.total !== undefined) return sum + (typeof ps.total === 'number' ? ps.total : parseMoney(String(ps.total || '0')).amount)
    if (ps.optimistic_ceiling !== undefined) return sum + (typeof ps.optimistic_ceiling === 'number' ? ps.optimistic_ceiling : parseMoney(String(ps.optimistic_ceiling || '0')).amount)
    if (Array.isArray(ps)) return sum + ps.reduce((s: number, item: any) => s + parseMoney(item.annual_impact || '').amount, 0)
    return sum
  }, 0)

  const baseCurrency = (profile?.base_currency || 'EUR') as Currency

  const createdAt = new Date(user.created_at)
  const now = new Date()
  const monthsAgo = (now.getFullYear() - createdAt.getFullYear()) * 12 + (now.getMonth() - createdAt.getMonth())
  const joinedAgo = monthsAgo === 0 ? t('time.thisMonth') : monthsAgo === 1 ? t('time.oneMonthAgo') : t('time.monthsAgo', { count: monthsAgo })

  const locale = (await cookies()).get('termlift_lang')?.value === 'fr' ? 'fr-FR' : 'en-US'

  return (
    <>
      <SettingsClient
        email={user.email || ''}
        firstName={(profile?.contact_name || '').trim().split(/\s+/)[0] || ''}
        lastName={(profile?.contact_name || '').trim().split(/\s+/).slice(1).join(' ')}
        usageCount={profile?.usage_count || 0}
        dealCount={allDeals.length}
        activeDeals={activeDeals.length}
        closedDeals={closedDeals.length}
        roundCount={roundCount || 0}
        isAdmin={profile?.is_admin || false}
        baseCurrency={baseCurrency}
        totalSavings={formatCurrency(savingsAchieved || totalSavingsIdentified, baseCurrency)}
        memberSince={createdAt.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
        joinedAgo={joinedAgo}
        locale={profile?.locale || 'en'}
        negotiationPreferences={(profile as any)?.negotiation_preferences || null}
      />
    </>
  )
}
