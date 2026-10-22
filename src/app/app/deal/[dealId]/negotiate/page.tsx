export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { NEGOTIATION_SERVICE_ENABLED } from '@/lib/features'
import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { FileCheck, PhoneCall, Calendar } from 'lucide-react'
import { NegotiationRequestForm } from '@/components/NegotiationRequestForm'
import { formatCurrency, detectCurrency } from '@/lib/currency'
import { inferDealType, dealTypeLabel } from '@/lib/deal-type-inference'
import { NEGOTIATION_FEE_PERCENT } from '@/lib/pricing'
import { getPotentialSavings, getRedFlagCount, getVendorName, type DealLike } from '@/lib/deal-metrics'
import { AppPage, PageHeader, PageBody, Btn, Card, Chip, GateCard, SectionHeading } from '@/components/system'
import type { DealOutput, DealOutputV2 } from '@/types'

export default async function NegotiateDealPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params
  if (!NEGOTIATION_SERVICE_ENABLED) redirect(`/app/deal/${dealId}`)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: deal }, { data: existingRequest }, { data: profile }] = await Promise.all([
    supabase.from('deals').select('*, rounds (*)').eq('id', dealId).eq('user_id', user.id).single(),
    supabase.from('negotiation_requests').select('id').eq('deal_id', dealId).eq('user_id', user.id).not('status', 'in', '(closed_won,closed_lost)').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('profiles').select('contact_name, locale').eq('id', user.id).maybeSingle(),
  ])
  if (!deal) notFound()

  const t = await getTranslations('negotiateRequest')
  const dp = await getTranslations('dealPage')
  const locale = (await cookies()).get('termlift_lang')?.value || 'en'
  const vendor = getVendorName(deal as DealLike)
  const crumbs = [{ label: dp('crumbDeals'), href: '/app' }, { label: vendor, href: `/app/deal/${dealId}` }, { label: t('crumb') }]

  if (existingRequest) {
    return (
      <AppPage>
        <PageHeader crumbs={crumbs} title={t('alreadyTitle')} sub={t('alreadyBody')} />
        <PageBody>
          <GateCard tone="neutral" eyebrow={dp('handoffWaitingEyebrow')} title={t('alreadyTitle')} body={t('alreadyBody')} action={<Btn href={`/app/negotiations/${existingRequest.id}`} variant="ink">{dp('handoffOpen')}</Btn>} />
        </PageBody>
      </AppPage>
    )
  }

  const sortedRounds = (deal.rounds || []).slice().sort((a: { round_number: number }, b: { round_number: number }) => b.round_number - a.round_number)
  const latestRound = sortedRounds[0]
  const latestOutput = latestRound?.output_json as DealOutput | DealOutputV2 | undefined
  const isV2 = (latestRound?.schema_version || 'v1') === 'v2'

  const defaultVendor = deal.vendor || (isV2 ? (latestOutput as DealOutputV2)?.commercial_facts?.supplier : (latestOutput as DealOutput)?.vendor) || ''
  const defaultCategory = (latestOutput as DealOutput)?.category || ''
  const rawRenewalDate = isV2 ? undefined : (latestOutput as DealOutput)?.snapshot?.renewal_date
  // Local date parts, not toISOString(): "January 31, 2027" parses as local midnight and
  // came out as Jan 30 once shifted to UTC.
  const defaultRenewalDate = (() => {
    if (!rawRenewalDate || isNaN(Date.parse(rawRenewalDate))) return ''
    const d = new Date(rawRenewalDate)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const defaultCurrentTotal = isV2 ? (latestOutput as DealOutputV2)?.commercial_facts?.total_value : (latestOutput as DealOutput)?.snapshot?.total_commitment

  const redFlagCount = getRedFlagCount(deal as DealLike)
  const potentialSavings = getPotentialSavings(deal as DealLike)
  const dealCurrency = detectCurrency(defaultCurrentTotal || '')

  // Deal type inference uses extracted_text server-side only — never sent to the client.
  const dealTypeInference = !isV2
    ? inferDealType((latestOutput as DealOutput)?.snapshot?.deal_type, undefined, latestRound?.extracted_text)
    : { type: 'unknown' as const, confidence: 'low' as const }

  const targetPriceRange = (latestOutput as unknown as { target_price_range?: { low: number; high: number } | null })?.target_price_range
  const topRedFlags = (!isV2 ? (latestOutput as DealOutput)?.red_flags : undefined)?.slice(0, 3).map((f) => f.issue).filter(Boolean) || []
  const analysisContext = {
    verdict: !isV2 ? (latestOutput as DealOutput)?.verdict : undefined,
    targetPriceLow: targetPriceRange?.low ?? null,
    targetPriceHigh: targetPriceRange?.high ?? null,
    potentialSavings: potentialSavings || null,
    currency: dealCurrency,
    topRedFlags,
  }
  const dealTypeText = dealTypeInference.type !== 'unknown' ? dealTypeLabel(dealTypeInference.type) : null
  const hasStoredDocument = !!latestRound?.extracted_text
  // What the user already told the email generator on this deal — never make them retype it.
  const emailCtx = (latestOutput as DealOutput | undefined)?.email_context
  const walkAwayText = emailCtx?.walkAwayFlexibility === 'can_walk' ? (locale === 'fr' ? 'Nous pouvons changer de fournisseur' : 'We can walk away from this vendor')
    : emailCtx?.walkAwayFlexibility === 'prefer_stay' ? (locale === 'fr' ? 'Nous préférons rester si possible' : 'We would prefer to stay if reasonably possible')
    : emailCtx?.walkAwayFlexibility === 'flexible' ? (locale === 'fr' ? 'Flexibles' : 'Flexible')
    : ''

  const steps = [
    { icon: FileCheck, label: t('step1'), sub: t('step1sub') },
    { icon: PhoneCall, label: t('step2'), sub: t('step2sub') },
    { icon: Calendar, label: t('step3'), sub: t('step3sub') },
  ]

  return (
    <AppPage>
      <PageHeader crumbs={crumbs} title={t('title')} sub={t('sub')}>
        {(defaultCurrentTotal || potentialSavings > 0 || dealTypeText || redFlagCount > 0) && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {defaultCurrentTotal && <Chip>{t('chipQuote', { v: defaultCurrentTotal })}</Chip>}
            {potentialSavings > 0 && <Chip tone="green">{t('chipSavings', { v: formatCurrency(potentialSavings, dealCurrency) })}</Chip>}
            {dealTypeText && <Chip>{dealTypeText}</Chip>}
            {redFlagCount > 0 && <Chip tone="info">{t('chipLevers', { n: redFlagCount })}</Chip>}
          </div>
        )}
      </PageHeader>
      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3.5 items-start">
          <div className="min-w-0">
            <NegotiationRequestForm
              source="post_analysis"
              dealId={dealId}
              roundId={latestRound?.id}
              defaultVendor={defaultVendor}
              defaultCategory={defaultCategory}
              defaultRenewalDate={defaultRenewalDate}
              defaultCurrentTotal={defaultCurrentTotal}
              defaultDealType={dealTypeInference.type}
              defaultDealTypeConfidence={dealTypeInference.confidence}
              analysisContext={analysisContext}
              hasStoredDocument={hasStoredDocument}
              defaultObjective={emailCtx?.negotiationObjective || ''}
              defaultWalkAway={walkAwayText}
              defaultCompetitor={emailCtx?.competingQuote || ''}
              defaultContactName={profile?.contact_name || ''}
              feePercent={NEGOTIATION_FEE_PERCENT}
              locale={locale}
            />
          </div>
          {/* One card: the three steps and the fee, together. */}
          <div className="lg:sticky lg:top-4">
            <Card>
              <SectionHeading title={t('howTitle')} />
              <div className="flex flex-col gap-3">
                {steps.map((s, i) => (
                  <div key={s.label} className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-green-soft text-green-deep grid place-items-center shrink-0 tl-label text-[11px]">{i + 1}</span>
                    <div className="min-w-0"><p className="text-[13px] font-semibold text-ink">{s.label}</p><p className="text-[12px] text-ink-2">{s.sub}</p></div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-line-2">
                <p className="font-display font-bold text-[22px] leading-tight tl-num text-ink">{NEGOTIATION_FEE_PERCENT}%<span className="font-sans text-[13px] text-ink-2 font-normal ml-1.5">{t('feeUnit')}</span></p>
                <p className="text-[12.5px] text-ink-2 mt-1 leading-relaxed">{t('feeNote')}</p>
              </div>
            </Card>
          </div>
        </div>
      </PageBody>
    </AppPage>
  )
}
