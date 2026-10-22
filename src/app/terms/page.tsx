import type { Metadata } from 'next'
import { getTranslations, getLocale } from 'next-intl/server'
import { MarketingPage, PageHero, LegalDoc, Callout } from '@/components/marketing/MarketingPage'
import { NEGOTIATION_FEE_PERCENT, NEGOTIATION_FEE_MINIMUM_EUR, NEW_DEALS_PER_DAY, NEW_DEALS_PER_MONTH } from '@/lib/pricing'

export const metadata: Metadata = {
  title: 'Terms of Service',
  alternates: { canonical: 'https://www.termlift.com/terms' },
}

/** Bump when the wording changes — this is the date shown on the page. */
const LAST_UPDATED = '2026-09-09'
const EMAIL = 'hello@termlift.com'

export default async function TermsPage() {
  const t = await getTranslations('termsPage')
  const l = await getTranslations('legal')
  const locale = await getLocale()
  const updated = new Date(LAST_UPDATED + 'T12:00:00Z').toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  const pricing = {
    day: NEW_DEALS_PER_DAY,
    month: NEW_DEALS_PER_MONTH,
    pct: NEGOTIATION_FEE_PERCENT,
    min: NEGOTIATION_FEE_MINIMUM_EUR,
  }

  const mail = <a href={`mailto:${EMAIL}`}>{EMAIL}</a>

  const sections = [
    { id: 'acceptance', title: t('s1Title'), body: <p>{t('s1Text')}</p> },
    {
      id: 'service',
      title: t('s2Title'),
      body: (
        <>
          <p>{t('s2Intro')}</p>
          <ul>
            <li>{t('s2Item1')}</li>
            <li>{t('s2Item2')}</li>
            <li>{t('s2Item3')}</li>
            <li>{t('s2Item4')}</li>
            <li>{t('s2Item5')}</li>
          </ul>
          <p>{t('s2Nego')}</p>
        </>
      ),
    },
    {
      id: 'not',
      title: t('s3Title'),
      body: (
        <Callout tone="warn" title={t('s3Important')}>
          <ul className="!my-0">
            <li>{t('s3Item1')}</li>
            <li>{t('s3Item2')}</li>
            <li>{t('s3Item3')}</li>
            <li>{t('s3Item4')}</li>
            <li>{t('s3Item5')}</li>
          </ul>
        </Callout>
      ),
    },
    {
      id: 'responsibilities',
      title: t('s4Title'),
      body: (
        <>
          <p>{t('s4Intro')}</p>
          <ul>
            {(['s4Item1', 's4Item2', 's4Item3', 's4Item4', 's4Item5', 's4Item6', 's4Item7'] as const).map((k) => <li key={k}>{t(k)}</li>)}
          </ul>
        </>
      ),
    },
    {
      id: 'pricing',
      title: t('s5Title'),
      body: (
        <>
          <p>{t('s5Intro')}</p>
          <div className="grid grid-cols-1 gap-2.5 my-4 not-prose">
            {[
              { title: t('s5QuickTitle'), desc: t('s5QuickDesc', pricing) },
              { title: t('s5DeepTitle', pricing), desc: t('s5DeepDesc', pricing) },
              { title: t('s5NegoTitle', pricing), desc: t('s5NegoDesc', pricing) },
            ].map((p) => (
              <div key={p.title} className="rounded-[12px] border border-line bg-surface px-4 py-3.5">
                <p className="font-display font-bold text-ink text-[15px] leading-tight !my-0">{p.title}</p>
                <p className="text-[13.5px] text-ink-2 leading-[1.55] !mt-1 !mb-0">{p.desc}</p>
              </div>
            ))}
          </div>
          <ul>
            {(['s5Item1', 's5Item2', 's5Item3', 's5Item4', 's5Item5'] as const).map((k) => <li key={k}>{t(k)}</li>)}
          </ul>
        </>
      ),
    },
    {
      id: 'negotiation',
      title: t('s15Title'),
      body: (
        <>
          <p>{t('s15Intro')}</p>
          <h3>{t('s15ScopeTitle')}</h3>
          <ul>
            {(['s15Scope1', 's15Scope2', 's15Scope3', 's15Scope4'] as const).map((k) => <li key={k}>{t(k)}</li>)}
          </ul>
          <h3>{t('s15FeeTitle')}</h3>
          <ul>
            {(['s15Fee1', 's15Fee2', 's15Fee3', 's15Fee4', 's15Fee5', 's15Fee6'] as const).map((k) => <li key={k}>{t(k, pricing)}</li>)}
          </ul>
        </>
      ),
    },
    {
      id: 'confidentiality',
      title: t('s16Title'),
      body: (
        <>
          <p>{t('s16p1')}</p>
          <p>{t('s16p2')}</p>
        </>
      ),
    },
    {
      id: 'ip',
      title: t('s6Title'),
      body: (
        <>
          <h3>{t('s6YourContent')}</h3>
          <p>{t('s6YourContentDesc')}</p>
          <h3>{t('s6OurContent')}</h3>
          <p>{t('s6OurContentDesc')}</p>
          <h3>{t('s6AiOutputs')}</h3>
          <p>{t('s6AiOutputsDesc')}</p>
        </>
      ),
    },
    {
      id: 'availability',
      title: t('s7Title'),
      body: (
        <>
          <p>{t('s7Intro')}</p>
          <ul>
            {(['s7Item1', 's7Item2', 's7Item3', 's7Item4'] as const).map((k) => <li key={k}>{t(k)}</li>)}
          </ul>
        </>
      ),
    },
    {
      id: 'termination',
      title: t('s8Title'),
      body: (
        <ul>
          {(['s8Item1', 's8Item2', 's8Item3', 's8Item4'] as const).map((k) => <li key={k}>{t(k)}</li>)}
        </ul>
      ),
    },
    {
      id: 'liability',
      title: t('s9Title'),
      body: (
        <>
          <p>{t('s9Intro')}</p>
          <ul>
            {(['s9Item1', 's9Item2', 's9Item3', 's9Item4', 's9Item5'] as const).map((k) => <li key={k}>{t(k)}</li>)}
          </ul>
        </>
      ),
    },
    { id: 'indemnification', title: t('s10Title'), body: <p>{t('s10Text')}</p> },
    {
      id: 'disputes',
      title: t('s11Title'),
      body: (
        <>
          <ul>
            <li><strong>{t('s11Item1Prefix')}</strong> {t('s11Item1', { email: EMAIL })}</li>
            <li><strong>{t('s11Item2Prefix')}</strong> {t('s11Item2')}</li>
            <li><strong>{t('s11Item3Prefix')}</strong> {t('s11Item3')}</li>
            <li><strong>{t('s11Item4Prefix')}</strong> {t('s11Item4')}</li>
          </ul>
          <p className="text-[13.5px] text-ink-3">{t('s11Note')}</p>
        </>
      ),
    },
    { id: 'changes', title: t('s12Title'), body: <p>{t('s12Text')}</p> },
    {
      id: 'general',
      title: t('s13Title'),
      body: (
        <ul>
          <li><strong>{t('s13Item1Prefix')}</strong> {t('s13Item1')}</li>
          <li><strong>{t('s13Item2Prefix')}</strong> {t('s13Item2')}</li>
          <li><strong>{t('s13Item3Prefix')}</strong> {t('s13Item3')}</li>
          <li><strong>{t('s13Item4Prefix')}</strong> {t('s13Item4')}</li>
        </ul>
      ),
    },
    { id: 'contact', title: t('s14Title'), body: <p>{t('s14Text', { email: '' }).trimEnd()} {mail}</p> },
  ]

  return (
    <MarketingPage>
      <PageHero eyebrow={t('badge')} title={t('title')} lead={t('lead')} meta={l('lastUpdated', { date: updated })} narrow />
      <LegalDoc sections={sections} tocLabel={l('toc')} />
    </MarketingPage>
  )
}
