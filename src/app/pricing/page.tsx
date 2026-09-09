import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { MarketingHeader } from '@/components/MarketingHeader'
import { MarketingFooter } from '@/components/MarketingFooter'
import { Btn, StageRail } from '@/components/system'
import { NEGOTIATION_FEE_PERCENT, NEGOTIATION_FEE_MINIMUM_EUR, FULL_ANALYSIS_EMAIL_REGEN_LIMIT, FREE_ANALYSIS_LIMIT, deepAnalysisPriceLabel, earlyAccessUntilLabel, isEarlyAccess } from '@/lib/pricing'

export const metadata: Metadata = {
  title: `Pricing — free vendor quote analysis, ${deepAnalysisPriceLabel()} Negotiation Playbook per deal`,
  description: `Analyse a supplier quote free. Build the Negotiation Playbook per deal. Or have TermLift negotiate for a ${NEGOTIATION_FEE_PERCENT}% success fee — nothing if we don't save you money.`,
  alternates: { canonical: 'https://www.termlift.com/pricing' },
}

function Feature({ children, off }: { children: React.ReactNode; off?: boolean }) {
  return (
    <li className={`flex gap-2 items-start text-[13px] ${off ? 'text-ink-3' : ''}`}>
      <span className={`w-4 h-4 rounded-full shrink-0 mt-px border grid place-items-center ${off ? 'bg-line-2 border-line' : 'bg-green-soft border-green-line'}`}>
        {!off && <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden><path d="M4 8.5l2.5 2.5L12 5.5" fill="none" stroke="var(--tl-green-deep)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </span>
      {children}
    </li>
  )
}

export default async function PricingPage() {
  const t = await getTranslations('pricingPage')
  const pct = NEGOTIATION_FEE_PERCENT

  const locale = await getLocale()
  const fullPrice = deepAnalysisPriceLabel()
  const early = isEarlyAccess()
  const untilLabel = earlyAccessUntilLabel(locale)

  // Dynamic keys — next-intl's typed `t` can't infer them, so go through a loose signature.
  const tt = t as unknown as (key: string, values?: Record<string, string | number>) => string
  const faqValues = { pct, price: fullPrice, date: untilLabel, min: `€${NEGOTIATION_FEE_MINIMUM_EUR}` }
  const faqs = [1, 2, 3, 4, 5].map((i) => ({ q: tt(`faq${i}q`), a: tt(`faq${i}a`, faqValues) }))

  const card = 'bg-surface border border-line rounded-[16px] p-5 flex flex-col gap-3 text-left'

  return (
    <div className="min-h-screen bg-white text-ink flex flex-col">
      <MarketingHeader />
      <main className="flex-1">
        <section className="max-w-[1120px] mx-auto px-5 sm:px-7 pt-10 pb-12 sm:pb-14 text-center">
          <p className="tl-label text-green-deep text-[11px]">{t('eyebrow')}</p>
          <h1 className="font-display font-extrabold text-[30px] sm:text-[34px] leading-[1.05] tracking-[-0.03em] mt-2.5">{t('title')}</h1>
          <p className="text-[15px] text-ink-2 max-w-[52ch] mx-auto mt-2.5 leading-[1.5]">{t('lead')}</p>
          <div className="max-w-[900px] mx-auto mt-5"><StageRail current="full" /></div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 mt-7">
            {/* Step 1 */}
            <div className={card}>
              <span className="tl-label text-ink-3">{t('step1')}</span>
              <h3 className="font-display font-bold text-[19px]">{t('quick.title')}</h3>
              <div className="font-display font-extrabold text-[30px] tracking-[-0.03em] tl-num">{t('quick.price')}</div>
              <ul className="m-0 p-0 list-none flex flex-col gap-2">
                <Feature>{t('quick.f1')}</Feature><Feature>{t('quick.f2')}</Feature><Feature>{t('quick.f3')}</Feature><Feature>{t('quick.f4')}</Feature>
                <Feature off>{t('quick.off1')}</Feature><Feature off>{t('quick.off2')}</Feature>
              </ul>
              <Btn href="/try" variant="ghost" block className="mt-auto">{t('quick.cta')}</Btn>
            </div>
            {/* Step 2 + 3 */}
            <div className={`${card} border-green shadow-[0_20px_50px_-30px_rgba(29,185,84,0.5)]`}>
              <span className="tl-label text-green-deep">{t('step23')}</span>
              <h3 className="font-display font-bold text-[19px]">{t('full.title')}</h3>
              <div className="font-display font-extrabold text-[30px] tracking-[-0.03em] tl-num flex items-baseline flex-wrap gap-x-2">
                {early ? <s className="text-ink-3 font-bold decoration-[2px]">{fullPrice}</s> : fullPrice}
                {early && <span className="text-[13px] font-bold text-green-deep bg-green-soft border border-green-line rounded-full px-2.5 py-0.5 tracking-normal font-sans">{t('full.freeNow', { date: untilLabel })}</span>}
                <span className="font-sans text-[13px] font-medium text-ink-2 tracking-normal basis-full">{t('full.unit')}</span>
              </div>
              {early && <p className="text-[12px] text-ink-2 -mt-1">{t('full.early', { date: untilLabel })}</p>}
              <ul className="m-0 p-0 list-none flex flex-col gap-2">
                <Feature>{t('full.f1')}</Feature><Feature>{t('full.f2')}</Feature><Feature>{t('full.f3')}</Feature>
                <Feature>{t('full.f4', { n: FULL_ANALYSIS_EMAIL_REGEN_LIMIT })}</Feature><Feature>{t('full.f5')}</Feature>
              </ul>
              <Btn href="/try" variant="primary" block className="mt-auto">{t('full.cta')}</Btn>
            </div>
            {/* Step 4 */}
            <div className={card}>
              <span className="tl-label text-ink-3">{t('step4')}</span>
              <h3 className="font-display font-bold text-[19px]">{t('neg.title')}</h3>
              <div className="font-display font-extrabold text-[30px] tracking-[-0.03em] tl-num">
                {pct}%<span className="font-sans text-[13px] font-medium text-ink-2 tracking-normal ml-2">{t('neg.unit')}</span>
              </div>
              <ul className="m-0 p-0 list-none flex flex-col gap-2">
                <Feature>{t('neg.f1')}</Feature><Feature>{t('neg.f2')}</Feature><Feature>{t('neg.f3')}</Feature><Feature>{t('neg.f4')}</Feature>
              </ul>
              <Btn href="/negotiate" variant="ink" block className="mt-auto">{t('neg.cta')}</Btn>
            </div>
          </div>
          <p className="text-[12.5px] text-ink-3 mt-5">{t('foot', { n: FREE_ANALYSIS_LIMIT })}</p>
        </section>

        <section className="max-w-[720px] mx-auto px-5 sm:px-7 pb-14">
          <div className="text-center mb-7">
            <p className="tl-label text-green-deep text-[11px]">{t('faqEyebrow')}</p>
            <h2 className="font-display font-bold text-[24px] sm:text-[28px] tracking-[-0.025em] mt-2">{t('faqTitle')}</h2>
          </div>
          <div className="border-t border-line">
            {faqs.map((f) => (
              <details key={f.q} className="group border-b border-line">
                <summary className="flex items-center justify-between cursor-pointer py-4 text-left list-none">
                  <span className="text-[14px] font-semibold text-ink pr-6 leading-snug">{f.q}</span>
                  <span className="w-6 h-6 rounded-full bg-ground group-open:bg-green-soft text-ink-3 group-open:text-green-deep grid place-items-center group-open:rotate-45 transition-all text-lg leading-none shrink-0">+</span>
                </summary>
                <p className="pb-4 text-[13.5px] text-ink-2 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  )
}
