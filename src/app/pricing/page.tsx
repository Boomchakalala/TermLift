import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { MarketingHeader } from '@/components/MarketingHeader'
import { MarketingFooter } from '@/components/MarketingFooter'
import { Btn, StageRail } from '@/components/system'
import { NEGOTIATION_FEE_PERCENT, NEGOTIATION_FEE_MINIMUM_EUR, FULL_ANALYSIS_EMAIL_REGEN_LIMIT, NEW_DEALS_PER_DAY, NEW_DEALS_PER_MONTH } from '@/lib/pricing'

export const metadata: Metadata = {
  title: 'Free vendor quote analysis and Negotiation Playbook',
  description: `Analyse a supplier quote, build the Negotiation Playbook and write the emails — free, for everyone. Or have TermLift negotiate for a ${NEGOTIATION_FEE_PERCENT}% success fee, nothing if we don't save you money.`,
  alternates: { canonical: 'https://www.termlift.com/pricing' },
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 items-start text-[13.5px] text-ink-2">
      <span className="w-4 h-4 rounded-full shrink-0 mt-px border grid place-items-center bg-green-soft border-green-line">
        <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden><path d="M4 8.5l2.5 2.5L12 5.5" fill="none" stroke="var(--tl-green-deep)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      {children}
    </li>
  )
}

/**
 * Not a pricing page any more (2026-10-22): the product is free, this page says
 * what that means, where the limits are and why, and names the one thing we
 * charge for — running the negotiation.
 */
export default async function PricingPage() {
  const t = await getTranslations('pricingPage')
  const v = { day: NEW_DEALS_PER_DAY, month: NEW_DEALS_PER_MONTH, regen: FULL_ANALYSIS_EMAIL_REGEN_LIMIT, pct: NEGOTIATION_FEE_PERCENT, min: `€${NEGOTIATION_FEE_MINIMUM_EUR}` }
  // Dynamic keys — next-intl's typed `t` can't infer them, so go through a loose signature.
  const tt = t as unknown as (key: string, values?: Record<string, string | number>) => string
  const faqs = [1, 2, 3, 4, 5].map((i) => ({ q: tt(`faq${i}q`, v), a: tt(`faq${i}a`, v) }))

  return (
    <div className="min-h-screen bg-white text-ink flex flex-col">
      <MarketingHeader />
      <main className="flex-1">
        <section className="max-w-[1120px] mx-auto px-5 sm:px-7 pt-10 pb-12 sm:pb-14 text-center">
          <p className="tl-label text-green-deep text-[11px]">{t('freeEyebrow')}</p>
          <h1 className="font-display font-extrabold text-[30px] sm:text-[38px] leading-[1.05] tracking-[-0.03em] mt-2.5">{t('freeTitle')}</h1>
          <p className="text-[15px] sm:text-[16px] text-ink-2 max-w-[58ch] mx-auto mt-3 leading-[1.5]">{tt('freeLead', v)}</p>
          <div className="max-w-[900px] mx-auto mt-6"><StageRail current="full" /></div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8 text-left">
            {/* What free means */}
            <div className="bg-surface border border-line rounded-[16px] p-5 flex flex-col gap-3 md:col-span-2">
              <span className="tl-label text-green-deep">{t('freeIncludedEyebrow')}</span>
              <div className="flex items-end gap-3">
                <span className="font-display font-extrabold text-[40px] leading-none tracking-[-0.04em] tl-num">€0</span>
                <span className="text-[13px] text-ink-2 pb-1.5">{t('freeIncludedUnit')}</span>
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mt-1 m-0 p-0 list-none">
                <Feature>{t('freeF1')}</Feature>
                <Feature>{t('freeF2')}</Feature>
                <Feature>{tt('freeF3', v)}</Feature>
                <Feature>{t('freeF4')}</Feature>
                <Feature>{tt('freeF5', v)}</Feature>
                <Feature>{t('freeF6')}</Feature>
              </ul>
              <div className="mt-2 rounded-[12px] bg-ground border border-line-2 px-4 py-3">
                <p className="text-[12.5px] font-semibold text-ink">{t('freeLimitsTitle')}</p>
                <p className="text-[12.5px] text-ink-2 mt-1 leading-relaxed">{tt('freeLimitsBody', v)}</p>
              </div>
              <Btn href="/try" variant="primary" className="mt-auto self-start">{t('freeCta')}</Btn>
            </div>

            {/* The one paid thing */}
            <div className="bg-ink text-white rounded-[16px] p-5 flex flex-col gap-3">
              <span className="tl-label text-green">{t('negEyebrow')}</span>
              <h3 className="font-display font-bold text-[19px]">{t('neg.title')}</h3>
              <div className="font-display font-extrabold text-[34px] tracking-[-0.03em] tl-num leading-none">
                {NEGOTIATION_FEE_PERCENT}%<span className="font-sans text-[13px] font-medium text-white/70 tracking-normal ml-2">{t('neg.unit')}</span>
              </div>
              <ul className="flex flex-col gap-2 m-0 p-0 list-none text-white/85 [&_li]:text-white/85">
                <Feature>{t('neg.f1')}</Feature><Feature>{t('neg.f2')}</Feature><Feature>{t('neg.f3')}</Feature><Feature>{t('neg.f4')}</Feature>
              </ul>
              <p className="text-[12px] text-white/60">{tt('negMin', v)}</p>
              <Btn href="/negotiate" variant="primary" block className="mt-auto">{t('neg.cta')}</Btn>
            </div>
          </div>

          <div className="max-w-[720px] mx-auto mt-10 text-left bg-green-soft border border-green-line rounded-[16px] px-5 py-4">
            <p className="tl-label text-green-deep">{t('whyEyebrow')}</p>
            <p className="font-display font-bold text-[17px] mt-1.5">{t('whyTitle')}</p>
            <p className="text-[13.5px] text-ink-2 mt-1.5 leading-relaxed">{t('whyBody')}</p>
          </div>
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
