export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { NEGOTIATION_SERVICE_ENABLED } from '@/lib/features'
import { CountUp } from '@/components/landing/Reveal'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations, getLocale } from 'next-intl/server'
import { Plus, Handshake } from 'lucide-react'
import { AppPage, PageHeader, PageBody, StatRow, StatTile, Btn } from '@/components/system'
import { HomeDealsClient } from '@/components/home/HomeDealsClient'
import { HomeInsights } from '@/components/home/HomeInsights'
import { TrialImporter } from '@/components/home/TrialImporter'
import { buildHomeRows } from '@/lib/home-rows'
import { enrichDeals, computeInsights } from '@/lib/deal-insights'
import { fmtCompact, fmtMoney, type DealLike } from '@/lib/deal-metrics'
import type { Currency } from '@/lib/currency'
import { cn } from '@/lib/utils'

type Tab = 'deals' | 'insights'
type Filter = 'all' | 'needs' | 'termlift' | 'won'

export default async function HomePage({ searchParams }: { searchParams: Promise<{ tab?: string; filter?: string }> }) {
  const sp = await searchParams
  const tab: Tab = sp.tab === 'insights' ? 'insights' : 'deals'
  const filter: Filter = (['all', 'needs', 'termlift', 'won'] as Filter[]).includes(sp.filter as Filter) ? (sp.filter as Filter) : 'all'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const t = await getTranslations('home')
  const locale = await getLocale()

  const [{ data: profile }, { data: deals, error: dealsError }, { data: requests, error: requestsError }] = await Promise.all([
    supabase.from('profiles').select('usage_count, is_admin, base_currency').eq('id', user.id).single(),
    supabase.from('deals').select('*, rounds (id, output_json, round_number, status, created_at, vendor_offer)').eq('user_id', user.id).order('updated_at', { ascending: false }),
    supabase.from('negotiation_requests').select('deal_id, status').eq('user_id', user.id),
  ])

  // A failed query must never masquerade as "no deals yet".
  if (dealsError) throw new Error(`Home: deals query failed — ${dealsError.message}`)
  if (requestsError) throw new Error(`Home: negotiation_requests query failed — ${requestsError.message}`)

  const allDeals = (deals || []) as unknown as DealLike[]
  const isAdmin = !!profile?.is_admin
  const baseCurrency = ((profile?.base_currency as Currency) || 'EUR') as Currency

  const reqByDeal = new Map<string, string>()
  for (const r of requests || []) if (r.deal_id) reqByDeal.set(r.deal_id, r.status)

  // ── empty state ─────────────────────────────────────────────
  if (allDeals.length === 0) {
    return (
      <AppPage>
        <TrialImporter />
        <PageHeader title={t('title')} />
        <PageBody className="items-center justify-center flex-1">
          <div className="max-w-[560px] w-full text-center py-10">
            <h2 className="font-display font-extrabold text-[26px] sm:text-[30px] tracking-[-0.025em]">{t('emptyTitle')}</h2>
            <p className="text-[14px] text-ink-2 mt-2.5 max-w-[46ch] mx-auto leading-relaxed">{t('emptyBody')}</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-6">
              <Btn href="/app/new" variant="primary" size="lg"><Plus className="w-4 h-4" />{t('newAnalysis')}</Btn>
              <Link href="/demo" className="text-[13.5px] font-semibold text-ink-2 hover:text-ink no-underline">{t('seeExample')} →</Link>
            </div>
            <p className="mt-8 text-[12px] text-ink-3"><Link href="/app/settings" className="hover:text-green-deep no-underline">{t('setupProfile')} →</Link></p>
          </div>
        </PageBody>
      </AppPage>
    )
  }

  // ── data ────────────────────────────────────────────────────
  const rows = buildHomeRows(allDeals, reqByDeal)
  const enriched = await enrichDeals(allDeals, baseCurrency)
  const insights = computeInsights(enriched, baseCurrency)
  // "Needs you" = the next move is yours: TermLift is waiting on an answer, or a
  // Playbook is ready and the email hasn't gone out. Running Full Analysis is an
  // option, not an obligation, so quick-stage deals don't count.
  const needsYou = rows.filter((r) => r.needsYou).length
  const needsReply = rows.filter((r) => r.waitingOnClient).length
  const needsSub = needsYou === 0 ? t('kpiNeedsNone') : needsReply === needsYou ? t('kpiNeedsReply', { n: needsYou }) : t('kpiNeedsAction', { n: needsYou })

  const dateShort = (d: Date) => d.toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { month: 'short', day: 'numeric' })

  const tabCls = (on: boolean) => cn('px-3 py-2 text-[13.5px] font-semibold border-b-2 -mb-px no-underline transition-colors', on ? 'text-ink border-green' : 'text-ink-3 border-transparent hover:text-ink-2')

  return (
    <AppPage>
      <TrialImporter />
      <PageHeader
        title={t('title')}
        sub={t('sub', { n: rows.length, spend: fmtCompact(insights.totalSpend, baseCurrency) })}
        actions={
          <>
            {NEGOTIATION_SERVICE_ENABLED && <Btn href="/negotiate" variant="ghost" size="sm"><Handshake className="w-3.5 h-3.5" />{t('requestNegotiation')}</Btn>}
            <Btn href="/app/new" variant="primary" size="sm"><Plus className="w-3.5 h-3.5" />{t('newAnalysis')}</Btn>
          </>
        }
      >
        {/* The one sentence Home is for: how much is on the table and where. */}
        {insights.savingsIdentified > 0 && insights.opportunities[0] ? (
          <p className="mt-3.5 text-[15px] sm:text-[16px] text-ink leading-snug max-w-[72ch]">
            {t('headlineTable', { total: fmtCompact(insights.savingsIdentified, baseCurrency), n: insights.activeCount })}{' '}
            <Link href={`/app/deal/${insights.opportunities[0].id}`} className="font-semibold text-green-deep no-underline hover:underline">{insights.opportunities[0].vendor}</Link>{' '}
            {t('headlineBiggest', { amount: fmtCompact(insights.opportunities[0].potential, baseCurrency) })}
          </p>
        ) : insights.savingsAchieved > 0 ? (
          <p className="mt-3.5 text-[15px] sm:text-[16px] text-ink leading-snug max-w-[72ch]">{t('headlineSaved', { total: fmtCompact(insights.savingsAchieved, baseCurrency), n: insights.wonCount })}</p>
        ) : null}
        <StatRow flat className="mt-4 pt-4 border-t border-line-2">
          <StatTile flat tone="money" label={t('kpiSaved')} value={insights.savingsAchieved > 0 ? <CountUp value={fmtMoney(insights.savingsAchieved, baseCurrency)} duration={900} /> : '—'} sub={t('kpiSavedSub', { n: insights.wonCount })} />
          <StatTile flat tone="money" label={t('kpiPipeline')} value={insights.savingsIdentified > 0 ? <CountUp value={fmtMoney(insights.savingsIdentified, baseCurrency)} duration={900} /> : '—'} sub={t('kpiPipelineSub', { n: insights.activeCount })} />
          <StatTile flat tone={needsYou > 0 ? 'warn' : 'neutral'} label={t('kpiNeeds')} value={needsYou} sub={needsSub} />
          <StatTile
            flat
            label={t('kpiRenewal')}
            value={insights.nextRenewal ? dateShort(insights.nextRenewal.date) : '—'}
            sub={insights.nextRenewal ? t('kpiRenewalSub', { vendor: insights.nextRenewal.vendor, days: insights.nextRenewal.daysOut }) : t('kpiRenewalNone')}
          />
        </StatRow>
        <nav className="flex gap-1 border-b border-line mt-3.5" aria-label="Home tabs">
          <Link href="/app" className={tabCls(tab === 'deals')}>{t('tabDeals')}</Link>
          <Link href="/app?tab=insights" className={tabCls(tab === 'insights')}>{t('tabInsights')}</Link>
        </nav>
      </PageHeader>

      <PageBody>
        {tab === 'deals' ? (
          <HomeDealsClient rows={rows} initialFilter={filter} />
        ) : (
          <HomeInsights insights={insights} locale={locale} />
        )}
      </PageBody>
    </AppPage>
  )
}
