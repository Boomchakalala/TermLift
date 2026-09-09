import type { Metadata } from 'next'
import { getTranslations, getLocale } from 'next-intl/server'
import { Info, Upload, CheckCircle2, Lock, CreditCard, Shield, Plus } from 'lucide-react'
import { NEGOTIATION_FEE_PERCENT, NEGOTIATION_FEE_MINIMUM_EUR, FREE_ANALYSIS_LIMIT, deepAnalysisPriceLabel, earlyAccessUntilLabel } from '@/lib/pricing'
import { MarketingPage, PageHero, Section, wrap } from '@/components/marketing/MarketingPage'
import { Btn } from '@/components/system'
import { cn } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Help & FAQ',
  alternates: { canonical: 'https://www.termlift.com/help' },
}

/** Section keys and how many Q&As each has — copy lives in messages/*.json under helpPage.sections. */
const SECTIONS = [
  { key: 'what', n: 3, icon: <Info className="w-4 h-4" /> },
  { key: 'upload', n: 3, icon: <Upload className="w-4 h-4" /> },
  { key: 'output', n: 4, icon: <CheckCircle2 className="w-4 h-4" /> },
  { key: 'privacy', n: 3, icon: <Lock className="w-4 h-4" /> },
  { key: 'billing', n: 8, icon: <CreditCard className="w-4 h-4" /> },
  { key: 'trouble', n: 2, icon: <Shield className="w-4 h-4" /> },
] as const

export default async function HelpPage() {
  const t = await getTranslations('helpPage')
  const locale = await getLocale()
  const pricing = {
    price: deepAnalysisPriceLabel(),
    date: earlyAccessUntilLabel(locale),
    pct: NEGOTIATION_FEE_PERCENT,
    min: NEGOTIATION_FEE_MINIMUM_EUR,
    limit: FREE_ANALYSIS_LIMIT,
  }

  const sections = SECTIONS.map((s) => ({
    key: s.key,
    icon: s.icon,
    title: t(`sections.${s.key}.title`),
    sub: t(`sections.${s.key}.sub`),
    items: Array.from({ length: s.n }, (_, i) => ({
      q: t(`sections.${s.key}.q${i + 1}`, pricing),
      a: t(`sections.${s.key}.a${i + 1}`, pricing),
    })),
  }))

  return (
    <MarketingPage>
      <PageHero eyebrow={t('badge')} title={t('title')} lead={t('lead')} narrow />

      <section className="py-10 sm:py-12">
        <div className={cn(wrap, 'grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-10 lg:gap-14 items-start')}>
          {/* Jump nav — sticky on desktop */}
          <nav className="hidden lg:block sticky top-[72px]" aria-label={t('toc')}>
            <p className="tl-label text-ink-3 text-[10px] mb-3">{t('toc')}</p>
            <ol className="m-0 p-0 list-none flex flex-col gap-1">
              {sections.map((s) => (
                <li key={s.key}>
                  <a href={`#${s.key}`} className="flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink no-underline py-0.5 leading-snug">
                    <span className="text-ink-3">{s.icon}</span>{s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {/* FAQ groups */}
          <div className="max-w-[72ch] flex flex-col gap-10">
            {sections.map((s) => (
              <div key={s.key} id={s.key} className="scroll-mt-20">
                <div className="flex items-baseline justify-between gap-3 mb-3">
                  <h2 className="tl-h3 text-ink">{s.title}</h2>
                  <span className="text-[12.5px] text-ink-2 hidden sm:inline">{s.sub}</span>
                </div>
                <div className="border-y border-line divide-y divide-line">
                  {s.items.map((item, i) => (
                    <details key={i} className="group">
                      <summary className="flex items-center justify-between gap-4 py-3.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                        <span className="text-[14.5px] font-semibold text-ink leading-snug">{item.q}</span>
                        <Plus className="w-4 h-4 text-ink-3 shrink-0 transition-transform group-open:rotate-45" />
                      </summary>
                      <p className="text-[14px] text-ink-2 leading-[1.6] pb-4 -mt-1 max-w-[64ch]">{item.a}</p>
                    </details>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Still stuck — one flat band */}
      <Section tone="ground">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div>
            <h2 className="font-display font-extrabold text-[22px] sm:text-[26px] leading-[1.08] tracking-[-0.03em]">{t('still.title')}</h2>
            <p className="text-[14.5px] text-ink-2 mt-1.5">{t('still.body')}</p>
          </div>
          <div className="flex flex-wrap gap-2.5 shrink-0">
            <Btn href="mailto:hello@termlift.com" variant="ghost" size="lg">hello@termlift.com</Btn>
            <Btn href="/try" variant="primary" size="lg">{t('still.cta')}</Btn>
          </div>
        </div>
      </Section>
    </MarketingPage>
  )
}
