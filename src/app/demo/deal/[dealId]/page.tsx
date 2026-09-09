import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { DealWorkspace } from '@/components/deal/DealWorkspace'
import { Btn, GateCard } from '@/components/system'
import { getDemoDeal, demoDeals } from '@/lib/demo-data'
import enMessages from '@/i18n/en.json'
import frMessages from '@/i18n/fr.json'
import { getLocale } from 'next-intl/server'

// One dictionary for the client instead of both languages: FR merged over EN so the
// fallback lookup in DealScrollView still resolves, at roughly half the payload.
function clientMessages(locale: string): Record<string, Record<string, string>> {
  const en = enMessages as unknown as Record<string, string>
  const dict = locale === 'fr' ? { ...en, ...(frMessages as unknown as Record<string, string>) } : en
  return { en: dict, [locale]: dict }
}

export function generateStaticParams() {
  return demoDeals.map((d) => ({ dealId: d.id }))
}

export default async function DemoDealPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params
  const deal = getDemoDeal(dealId)
  if (!deal) notFound()
  const t = await getTranslations('dealPage')

  return (
    <DealWorkspace
      mode="demo"
      deal={{ ...deal, deal_type: null, savings_percent: null }}
      messages={clientMessages(await getLocale())}
      isAdmin={false}
      showFullPlaybook
      addRoundForm={
        <GateCard tone="green" title={t('demoRoundTitle')} body={t('demoRoundBody')} action={<Btn href="/login?from=demo" variant="primary">{t('demoCta')}</Btn>} />
      }
    />
  )
}
