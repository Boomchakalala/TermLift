import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Shield, Lock, Trash2, FileText, Database, Upload, Eye, EyeOff, X } from 'lucide-react'
import { MarketingPage, PageHero, Section, SectionTitle, FeatureTile, Callout, FinalCta } from '@/components/marketing/MarketingPage'

export const metadata: Metadata = {
  title: 'Security',
  alternates: { canonical: 'https://www.termlift.com/security' },
}

const EMAIL = 'hello@termlift.com'

export default async function SecurityPage() {
  const t = await getTranslations('securityPage')

  const flow = [
    { n: '01', icon: <Upload className="w-[18px] h-[18px]" />, title: t('step1Title'), desc: t('step1Desc') },
    { n: '02', icon: <Eye className="w-[18px] h-[18px]" />, title: t('step2Title'), desc: t('step2Desc') },
    { n: '03', icon: <Trash2 className="w-[18px] h-[18px]" />, title: t('step3Title'), desc: t('step3Desc'), last: true },
  ]

  const promises = [
    { icon: <Trash2 className="w-[18px] h-[18px]" />, label: t('fileDeletionTitle'), title: t('originalsNeverStored'), body: `${t('fileDeletionDesc1')} ${t('fileDeletionDesc2')}` },
    { icon: <FileText className="w-[18px] h-[18px]" />, label: t('extractedTextTitle'), title: t('onlySavedWhenYouSaySo'), body: `${t('extractedTextDesc1')} ${t('extractedTextDesc2')}` },
    { icon: <EyeOff className="w-[18px] h-[18px]" />, label: t('aiTrainingTitle'), title: t('anthropicNoTrain'), body: `${t('aiTrainingDesc1')} ${t('aiTrainingDesc2')}` },
    { icon: <Shield className="w-[18px] h-[18px]" />, label: t('gdprTitle'), title: t('rightsRespected'), body: `${t('gdprDesc1')} ${t('gdprDesc2')}` },
  ]

  const infra = [
    { icon: <Database className="w-4 h-4" />, title: t('supabaseTitle'), desc: `${t('supabaseDesc1')} ${t('supabaseDesc2')}` },
    { icon: <Shield className="w-4 h-4" />, title: t('vercelTitle'), desc: t('vercelDesc') },
    { icon: <Lock className="w-4 h-4" />, title: t('anthropicTitle'), desc: t('anthropicDesc') },
  ]

  const donts = [t('dontSell'), t('dontAdvertise'), t('dontTrain'), t('dontStore'), t('dontShareBeyond'), t('dontAccess')]
  const limits = [1, 2, 3].map((i) => ({ title: t(`limit${i}Title` as 'limit1Title'), desc: t(`limit${i}Desc` as 'limit1Desc') }))

  return (
    <MarketingPage>
      <PageHero eyebrow={t('badge')} title={t('title')} lead={t('subtitle')} narrow />

      {/* The one promise, then the flow that backs it */}
      <Section tone="ink">
        <p className="font-display font-bold text-[19px] sm:text-[22px] leading-snug tracking-[-0.02em] max-w-[40ch]">{t('keyPrinciple')}</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-8">
          {flow.map((s) => (
            <div key={s.n} className={`rounded-[14px] border px-4 py-4 ${s.last ? 'border-risk/40 bg-risk/10' : 'border-white/10 bg-white/[0.04]'}`}>
              <div className="flex items-center justify-between mb-3">
                <span className={`tl-label text-[10px] ${s.last ? 'text-risk-line' : 'text-green'}`}>{s.n}</span>
                <span className={s.last ? 'text-risk-line' : 'text-green'}>{s.icon}</span>
              </div>
              <h3 className="font-display font-bold text-[15px] leading-tight text-white">{s.title}</h3>
              <p className="text-[13.5px] text-white/65 leading-[1.5] mt-1.5">{s.desc}</p>
            </div>
          ))}
        </div>
        <p className="text-[13.5px] text-white/65 mt-5"><strong className="text-white font-semibold">{t('bottomLine')}</strong> {t('bottomLineDesc')}</p>
      </Section>

      {/* Encryption + the four promises */}
      <Section>
        <SectionTitle title={t('encryptionTitle')} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">
          <FeatureTile icon={<Lock className="w-[18px] h-[18px]" />} title={t('inTransit')} body={t('inTransitDesc')} />
          <FeatureTile icon={<Database className="w-[18px] h-[18px]" />} title={t('atRest')} body={t('atRestDesc')} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-10">
          {promises.map((p) => (
            <div key={p.label} className="rounded-[14px] border border-line bg-surface p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="tl-label text-ink-3 text-[10px]">{p.label}</span>
                <span className="text-green-deep">{p.icon}</span>
              </div>
              <h3 className="font-display font-bold text-[15.5px] leading-tight">{p.title}</h3>
              <p className="text-[13.5px] text-ink-2 leading-[1.55] mt-1.5">{p.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Infrastructure — flat list */}
      <Section tone="ground">
        <SectionTitle title={t('infraTitle')} />
        <dl className="mt-6 max-w-[72ch] border-y border-line divide-y divide-line">
          {infra.map((c) => (
            <div key={c.title} className="py-4 grid grid-cols-[24px_1fr] sm:grid-cols-[24px_160px_1fr] gap-x-3 gap-y-1 items-start">
              <span className="text-ink-3 mt-0.5">{c.icon}</span>
              <dt className="font-semibold text-[14px] text-ink">{c.title}</dt>
              <dd className="text-[13.5px] text-ink-2 leading-[1.55] col-start-2 sm:col-start-3">{c.desc}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* What we don't do + limitations */}
      <Section>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-start">
          <div>
            <SectionTitle title={t('whatWeDontDoTitle')} />
            <ul className="m-0 p-0 list-none mt-6 flex flex-col gap-2.5">
              {donts.map((d) => (
                <li key={d} className="flex items-start gap-3 text-[14.5px] text-ink-2 leading-[1.5]">
                  <X className="w-4 h-4 text-risk shrink-0 mt-[3px]" strokeWidth={2.5} />{d}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <SectionTitle title={t('limitationsTitle')} />
            <Callout tone="warn" className="mt-6">
              <p className="!mt-0">{t('limitationsIntro')}</p>
              <ul className="pl-5 list-disc my-3 [&_li]:my-1.5 [&_li::marker]:text-warn">
                {limits.map((l) => <li key={l.title}><strong className="text-ink font-semibold">{l.title}</strong> {l.desc}</li>)}
              </ul>
              <p className="!mb-0">{t('limitationsOutro')}</p>
            </Callout>
          </div>
        </div>
      </Section>

      {/* Questions — flat */}
      <Section tone="ground">
        <SectionTitle title={t('questionsTitle')} lead={t('questionsIntro')} />
        <dl className="mt-5 flex flex-col gap-1.5 text-[14px]">
          {[t('securityQuestions'), t('privacyRequests'), t('generalSupport')].map((label) => (
            <div key={label} className="flex flex-wrap gap-x-2">
              <dt className="font-semibold text-ink">{label}</dt>
              <dd><a href={`mailto:${EMAIL}`} className="text-green-deep font-medium no-underline hover:underline">{EMAIL}</a></dd>
            </div>
          ))}
        </dl>
      </Section>

      <FinalCta title={t('ctaTitle')} lead={t('ctaSubtitle')} cta={t('ctaButton')} />
    </MarketingPage>
  )
}
