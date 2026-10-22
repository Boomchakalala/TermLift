import type { Metadata } from 'next'
import { getTranslations, getLocale } from 'next-intl/server'
import { MarketingPage, PageHero, LegalDoc, Callout } from '@/components/marketing/MarketingPage'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  alternates: { canonical: 'https://www.termlift.com/privacy' },
}

/** Bump when the wording changes — this is the date shown on the page. */
const LAST_UPDATED = '2026-09-09'
const EMAIL = 'hello@termlift.com'

export default async function PrivacyPage() {
  const t = await getTranslations('privacyPage')
  const l = await getTranslations('legal')
  const locale = await getLocale()
  const updated = new Date(LAST_UPDATED + 'T12:00:00Z').toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const mail = <a href={`mailto:${EMAIL}`}>{EMAIL}</a>

  const providers = [
    { name: t('s4Anthropic'), desc: t('s4AnthropicDesc'), link: 'https://www.anthropic.com/privacy' },
    { name: t('s4Supabase'), desc: t('s4SupabaseDesc') },
    { name: t('s4Vercel'), desc: t('s4VercelDesc') },
    { name: t('s4PostHog'), desc: t('s4PostHogDesc') },
  ]

  const sections = [
    {
      id: 'who',
      title: t('s1Title'),
      body: (
        <>
          <p>{t('s1p1')}</p>
          <p>{t('s1Contact')} {mail}</p>
        </>
      ),
    },
    {
      id: 'collect',
      title: t('s2Title'),
      body: (
        <>
          <h3>{t('s2AccountInfo')}</h3>
          <ul><li>{t('s2Account1')}</li><li>{t('s2Account2')}</li><li>{t('s2Account3')}</li></ul>
          <h3>{t('s2DealData')}</h3>
          <ul><li>{t('s2Deal1')}</li><li>{t('s2Deal2')}</li><li>{t('s2Deal3')}</li><li>{t('s2Deal4')}</li></ul>
          <h3>{t('s2PaymentInfo')}</h3>
          <ul><li>{t('s2Payment1')}</li><li>{t('s2Payment2')}</li></ul>
          <h3>{t('s2AutoCollected')}</h3>
          <ul><li>{t('s2Auto1')}</li><li>{t('s2Auto2')}</li></ul>
        </>
      ),
    },
    {
      id: 'use',
      title: t('s3Title'),
      body: (
        <ul>
          {(['s3Item1', 's3Item2', 's3Item3', 's3Item4', 's3Item5', 's3Item6', 's3Item7', 's3Item8'] as const).map((k) => <li key={k}>{t(k)}</li>)}
        </ul>
      ),
    },
    {
      id: 'share',
      title: t('s4Title'),
      body: (
        <>
          <p>{t('s4Intro')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 my-4">
            {providers.map((p) => (
              <div key={p.name} className="rounded-[12px] border border-line bg-surface px-4 py-3.5">
                <p className="font-display font-bold text-ink text-[14.5px] leading-tight !my-0">{p.name}</p>
                <p className="text-[13px] text-ink-2 leading-[1.5] !mt-1 !mb-0">
                  {p.desc}
                  {p.link && <> <a href={p.link} target="_blank" rel="noopener noreferrer">{locale === 'fr' ? 'Politique de confidentialité' : 'Privacy policy'}</a></>}
                </p>
              </div>
            ))}
          </div>
        </>
      ),
    },
    {
      id: 'retention',
      title: t('s5Title'),
      body: (
        <>
          <ul>
            {([1, 2, 3, 4, 5, 6, 7] as const).map((n) => (
              <li key={n}><strong>{t(`s5Item${n}Prefix`)}</strong> {t(`s5Item${n}`)}</li>
            ))}
          </ul>
          <p>{t('s5Note')}</p>
        </>
      ),
    },
    {
      id: 'cookies',
      title: t('s6Title'),
      body: (
        <>
          <p>{t('s6Intro')}</p>
          <h3>{t('s6Session')}</h3>
          <ul><li>{t('s6Session1')}</li><li>{t('s6Session2')}</li></ul>
          <h3>{t('s6Analytics')}</h3>
          <ul><li>{t('s6Analytics1')}</li><li>{t('s6Analytics2')}</li></ul>
          <h3>{t('s6WhatWeDoNot')}</h3>
          <ul><li>{t('s6Not1')}</li><li>{t('s6Not2')}</li><li>{t('s6Not3')}</li></ul>
        </>
      ),
    },
    {
      id: 'rights',
      title: t('s7Title'),
      body: (
        <>
          <p>{t('s7Intro')}</p>
          <ul>
            <li><strong>{t('s7Access')}</strong> {t('s7AccessDesc')}</li>
            <li><strong>{t('s7Delete')}</strong> {t('s7DeleteDesc')}</li>
            <li><strong>{t('s7Correct')}</strong> {t('s7CorrectDesc')}</li>
            <li><strong>{t('s7Export')}</strong> {t('s7ExportDesc')}</li>
            <li><strong>{t('s7Object')}</strong> {t('s7ObjectDesc')}</li>
          </ul>
          <p>{t('s7Contact', { email: EMAIL })}</p>
        </>
      ),
    },
    { id: 'transfers', title: t('s8Title'), body: <p>{t('s8Text')}</p> },
    { id: 'children', title: t('s9Title'), body: <p>{t('s9Text')}</p> },
    { id: 'changes', title: t('s10Title'), body: <p>{t('s10Text')}</p> },
    {
      id: 'contact',
      title: t('s11Title'),
      body: (
        <ul>
          <li><strong>{t('s11Privacy')}</strong> {mail}</li>
          <li><strong>{t('s11Data')}</strong> {mail}</li>
          <li><strong>{t('s11General')}</strong> {mail}</li>
        </ul>
      ),
    },
  ]

  const intro = (
    <Callout tone="green" title={l('quickSummary')} className="!mt-0 mb-8 max-w-[68ch]">
      <ul className="!my-0 pl-5 list-disc [&_li]:my-1 [&_li::marker]:text-green-deep">
        {(['summary1', 'summary2', 'summary3', 'summary4', 'summary5'] as const).map((k) => <li key={k}>{t(k)}</li>)}
      </ul>
    </Callout>
  )

  return (
    <MarketingPage>
      <PageHero eyebrow={t('badge')} title={t('title')} lead={t('lead')} meta={l('lastUpdated', { date: updated })} narrow />
      <LegalDoc sections={sections} tocLabel={l('toc')} intro={intro} />
    </MarketingPage>
  )
}
