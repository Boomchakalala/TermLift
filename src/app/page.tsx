import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ArrowRight, Check } from 'lucide-react'
import { MarketingHeader } from '@/components/MarketingHeader'
import { MarketingFooter } from '@/components/MarketingFooter'
import Image from 'next/image'
import { Btn, Chip, ScoreRing } from '@/components/system'
import { CountUp, FillBar } from '@/components/landing/Reveal'
import { LogoStrip } from '@/components/LogoStrip'

/** A product screenshot in a soft device frame — same treatment for every picture on the page. */
function Frame({ src, alt, width, height, className }: { src: string; alt: string; width: number; height: number; className?: string }) {
  return (
    <div className={`rounded-[14px] border border-line bg-surface shadow-[0_18px_50px_-24px_rgba(16,26,23,0.35)] overflow-hidden ${className || ''}`}>
      <Image src={src} alt={alt} width={width} height={height} className="w-full h-auto block" sizes="(min-width: 1024px) 640px, 100vw" />
    </div>
  )
}
import { SHOWCASE_CARDS, SHOWCASE_COUNT, SHOWCASE_TOTAL_EUR } from '@/lib/demo-showcase'
import { NEGOTIATION_FEE_PERCENT } from '@/lib/pricing'

/* ─── Browser-frame wrapper for a product surface ─── */
function Shot({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-line rounded-[14px] overflow-hidden shadow-[0_40px_80px_-30px_rgba(16,26,23,0.35)]">
      <div className="h-[34px] border-b border-line flex items-center gap-1.5 px-3 bg-surface-2">
        <i className="w-[9px] h-[9px] rounded-full bg-line block" />
        <i className="w-[9px] h-[9px] rounded-full bg-line block" />
        <i className="w-[9px] h-[9px] rounded-full bg-line block" />
        <span className="ml-2 tl-label text-ink-3 normal-case tracking-normal font-normal text-[10.5px]">{url}</span>
      </div>
      {children}
    </div>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="tl-label text-green-deep text-[11px]">{children}</p>
}

export default async function LandingPage() {
  const t = await getTranslations('landing')
  const ladder = await getTranslations('ladder')
  const pct = NEGOTIATION_FEE_PERCENT

  // Three steps + the add-on. "TermLift negotiates" is a way of doing step 3, not a step of its own.
  const steps = [
    { n: 1, tag: t('how.s1tag'), title: t('how.s1title'), body: t('how.s1body'), addon: false },
    { n: 2, tag: t('how.s2tag'), title: t('how.s2title'), body: t('how.s2body'), addon: false },
    { n: 3, tag: t('how.s3tag'), title: t('how.s3title'), body: t('how.s3body'), addon: false },
    { n: 4, tag: t('how.s4tag', { pct }), title: t('how.s4title'), body: t('how.s4body'), addon: true },
  ]

  const tours = [
    { k: t('tour.t1k'), title: t('tour.t1title'), body: t('tour.t1body'), bullets: [t('tour.t1b1'), t('tour.t1b2'), t('tour.t1b3')], img: t('tour.t1img'), src: '/landing/tour-playbook-v5.png', w: 1104, h: 839, flip: false },
    { k: t('tour.t2k'), title: t('tour.t2title'), body: t('tour.t2body'), bullets: [t('tour.t2b1'), t('tour.t2b2'), t('tour.t2b3')], img: t('tour.t2img'), src: '/landing/tour-email-v5.png', w: 1120, h: 686, flip: true },
    { k: t('tour.t3k'), title: t('tour.t3title'), body: t('tour.t3body'), bullets: [t('tour.t3b1'), t('tour.t3b2'), t('tour.t3b3')], img: t('tour.t3img'), src: '/landing/tour-negotiate-v5.png', w: 840, h: 716, flip: false },
  ]

  const wrap = 'max-w-[1120px] mx-auto px-5 sm:px-7'

  return (
    <div className="min-h-screen bg-white text-ink">
      <MarketingHeader />

      {/* ═══ HERO ═══ */}
      <section className="pt-10 pb-10 sm:pt-12 sm:pb-12">
        <div className={`${wrap} grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-8 lg:gap-10 items-center`}>
          <div>
            <Eyebrow>{t('eyebrow')}</Eyebrow>
            <h1 className="font-display font-extrabold text-[34px] sm:text-[46px] leading-[1.02] tracking-[-0.035em] mt-3">
              {t('h1a')} <span className="text-green">{t('h1b')}</span>
            </h1>
            <p className="text-[15.5px] leading-[1.5] text-ink-2 max-w-[48ch] mt-4">{t('lead')}</p>
            <div className="flex flex-wrap items-center gap-4 mt-5">
              <Btn href="/try" variant="primary" size="lg">{t('ctaPrimary')}</Btn>
              <Link href="/demo/deal/demo-atlassian" className="text-[13.5px] font-semibold text-ink-2 hover:text-ink inline-flex items-center gap-1.5 no-underline transition-colors">
                {t('ctaSecondary')} <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="flex flex-wrap gap-x-3.5 gap-y-1 mt-4 tl-label text-ink-3 text-[10px]">
              <span>{t('trust1')}</span><span aria-hidden>·</span><span>{t('trust2')}</span><span aria-hidden>·</span><span>{t('trust3')}</span>
            </div>
            {/* Vendors whose quotes TermLift analyses — monochrome marks, never "customers" */}
            <div className="mt-6 pt-4 border-t border-line">
              <p className="tl-label text-ink-3 text-[10px] mb-3">{t('logosCap')}</p>
              <LogoStrip compact />
            </div>
          </div>

          {/* Real product surface — a deal at stage 2 */}
          {/* The deal page as it really opens after the free step: verdict, the three numbers, the next step.
              Same hierarchy as the product; the settle-in animation runs once on load. */}
          <Shot url={t('shot.url')}>
            <div className="p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3.5 tl-rise">
                <ScoreRing score={48} size={64} animate />
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-1.5 mb-1"><Chip>{t('shot.type')}</Chip><Chip tone="green">{ladder('quick')}</Chip></div>
                  <div className="font-display font-bold text-[17px] leading-tight">{t('shot.verdict')}</div>
                  <div className="text-[12.5px] text-ink-2 mt-0.5">{t('shot.sub')}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: t('shot.statSavings'), value: '$15,145', sub: t('shot.statSavingsSub'), tone: 'text-green-deep' },
                  { label: t('shot.statTotal'), value: '$61,800', sub: t('shot.statTotalSub'), tone: 'text-ink' },
                  { label: t('shot.statFlags'), value: '3', sub: t('shot.statFlagsSub'), tone: 'text-risk' },
                ].map((s, i) => (
                  <div key={s.label} className="tl-rise rounded-xl border border-line bg-surface px-3 py-2.5 min-w-0" style={{ '--tl-delay': `${120 + i * 80}ms` } as React.CSSProperties}>
                    <p className="tl-label text-ink-3 text-[9.5px]">{s.label}</p>
                    <p className={`font-display font-bold text-[17px] tracking-[-0.02em] tl-num mt-1 leading-none ${s.tone}`}>{s.value}</p>
                    <p className="text-[11px] text-ink-3 mt-1 truncate">{s.sub}</p>
                  </div>
                ))}
              </div>
              <div className="tl-rise rounded-xl border border-green-line bg-green-soft px-3.5 py-3 flex items-center gap-3" style={{ '--tl-delay': '400ms' } as React.CSSProperties}>
                <div className="min-w-0 flex-1">
                  <p className="tl-label text-green-deep text-[10px]">{t('shot.nextStep')}</p>
                  <p className="font-display font-bold text-[13.5px] leading-tight mt-0.5">{t('shot.nextTitle')}</p>
                  <p className="text-[12px] text-ink-2 mt-0.5">{t('shot.nextBody')}</p>
                </div>
                <span className="shrink-0 inline-flex items-center h-8 px-3 rounded-[9px] bg-green text-white text-[12.5px] font-semibold shadow-[0_6px_18px_-8px_rgba(29,185,84,0.7)]">{t('shot.nextCta')}</span>
              </div>
            </div>
          </Shot>
        </div>
      </section>

      {/* ═══ HOW IT WORKS — the ladder ═══ */}
      <section id="how" className="bg-ground py-12 sm:py-14 scroll-mt-14">
        <div className={wrap}>
          <Eyebrow>{t('how.eyebrow')}</Eyebrow>
          <h2 className="font-display font-extrabold text-[26px] sm:text-[32px] leading-[1.08] tracking-[-0.03em] max-w-[24ch] mt-2.5">{t('how.title')}</h2>
          <p className="text-[15px] text-ink-2 max-w-[56ch] mt-2.5 leading-[1.5]">{t('how.lead')}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mt-7">
            {steps.map((s) => (
              <div key={s.n} className={`rounded-[14px] p-4 flex flex-col gap-2 ${s.addon ? 'bg-ground border border-dashed border-line' : 'bg-surface border border-line'}`}>
                <div className="flex justify-between tl-label text-green-deep"><span className={s.addon ? 'text-ink-3' : undefined}>{s.addon ? t('how.addon') : t('how.step', { n: s.n })}</span><span className="text-ink-3">{s.tag}</span></div>
                <h3 className="font-display font-bold text-[17px]">{s.title}</h3>
                <p className="text-[13px] text-ink-2 leading-[1.5]">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ WHO IT'S FOR — photo slot ═══ */}
      <section className="py-12 sm:py-14">
        <div className={`${wrap} grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-8 lg:gap-10 items-center`}>
          <Frame src="/landing/who-home-v5.png" alt={t('who.imgAlt')} width={1220} height={660} />
          <div>
            <Eyebrow>{t('who.eyebrow')}</Eyebrow>
            <h2 className="font-display font-extrabold text-[26px] sm:text-[32px] leading-[1.08] tracking-[-0.03em] max-w-[24ch] mt-2.5">{t('who.title')}</h2>
            <p className="text-[15px] text-ink-2 max-w-[56ch] mt-2.5 leading-[1.5]">{t('who.lead')}</p>
            <ul className="m-0 mt-4 p-0 list-none flex flex-col gap-2 text-[14px]">
              {[t('who.p1'), t('who.p2'), t('who.p3')].map((p) => (
                <li key={p} className="flex gap-2.5 items-start"><Check className="w-4 h-4 text-green shrink-0 mt-0.5" />{p}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ═══ INSIDE THE PRODUCT — screenshot slots ═══ */}
      <section className="bg-ground py-12 sm:py-14">
        <div className={wrap}>
          <Eyebrow>{t('tour.eyebrow')}</Eyebrow>
          <h2 className="font-display font-extrabold text-[26px] sm:text-[32px] leading-[1.08] tracking-[-0.03em] max-w-[24ch] mt-2.5">{t('tour.title')}</h2>
          <div className="mt-4">
            {tours.map((tr, i) => (
              <div key={tr.k} className={`grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-4 lg:gap-9 items-center py-6 ${i > 0 ? 'border-t border-line' : ''}`}>
                <div className={tr.flip ? 'lg:order-2' : ''}>
                  <span className="tl-label text-ink-3">{tr.k}</span>
                  <h3 className="font-display font-bold text-[20px] sm:text-[22px] mt-1.5">{tr.title}</h3>
                  <p className="text-[14px] text-ink-2 max-w-[46ch] mt-2 leading-[1.5]">{tr.body}</p>
                  <ul className="m-0 mt-3 p-0 list-none flex flex-col gap-1.5 text-[13px]">
                    {tr.bullets.map((b) => <li key={b}><span className="text-green mr-1.5">—</span>{b}</li>)}
                  </ul>
                </div>
                <Frame src={tr.src} alt={tr.img} width={tr.w} height={tr.h} className={tr.flip ? 'lg:order-1' : ''} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ REAL WINS ═══ */}
      <section className="py-12 sm:py-14">
        <div className={wrap}>
          <Eyebrow>{t('wins.eyebrow')}</Eyebrow>
          <h2 className="font-display font-extrabold text-[26px] sm:text-[32px] leading-[1.08] tracking-[-0.03em] max-w-[24ch] mt-2.5">
            {t('wins.title', { count: SHOWCASE_COUNT, total: Math.round(SHOWCASE_TOTAL_EUR / 1000) })}
          </h2>
          <p className="text-[15px] text-ink-2 max-w-[56ch] mt-2.5 leading-[1.5]">{t('wins.lead', { count: SHOWCASE_COUNT })}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
            {SHOWCASE_CARDS.map((d) => (
              <Link key={d.id} href={`/demo/deal/${d.id}`} className="bg-surface border border-line rounded-[14px] overflow-hidden no-underline hover:border-[#C9D3CE] hover:shadow-[0_20px_40px_-24px_rgba(16,26,23,0.3)] transition-all">
                <div className="px-4 py-3 border-b border-line flex justify-between items-center font-display font-bold text-[14px]">{d.vendor}<span className="tl-label text-ink-3">{d.cat}</span></div>
                <div className="p-4 grid grid-cols-[1fr_auto_1fr] gap-2.5 items-end">
                  <div><div className="tl-label text-ink-3 text-[10px]">{t('wins.quoted')}</div><div className="font-display font-semibold text-[16px] text-ink-3 line-through tl-num">{d.original}</div></div>
                  <ArrowRight className="w-4 h-4 text-ink-3 mb-1" />
                  <div className="text-right"><div className="tl-label text-ink-3 text-[10px]">{t('wins.signed')}</div><div className="font-display font-bold text-[16px] tl-num">{d.final}</div></div>
                </div>
                <div className="px-4 py-3 bg-green-soft border-t border-green-line">
                  <div className="flex justify-between items-center">
                    <CountUp value={d.saved} className="font-display font-extrabold text-[20px] text-green-deep" />
                    <Chip tone="green">{t('wins.saved', { pct: d.pct })}</Chip>
                  </div>
                  <FillBar pct={parseInt(d.pct, 10)} className="mt-2.5 bg-green-line/60" />
                </div>
              </Link>
            ))}
          </div>
          {/* No testimonial until there is a real one — a labelled fake quote is worse than none. */}
          <p className="tl-label text-ink-3 text-[10px] mt-4">{t('wins.note')}</p>
        </div>
      </section>

      {/* ═══ TERMLIFT NEGOTIATE ═══ */}
      <section className="bg-ink text-white py-12 sm:py-14">
        <div className={`${wrap} grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-8 lg:gap-10 items-center`}>
          <div>
            <Eyebrow>{t('neg.eyebrow')}</Eyebrow>
            <h2 className="font-display font-extrabold text-[26px] sm:text-[32px] leading-[1.08] tracking-[-0.03em] max-w-[24ch] mt-2.5">{t('neg.title')}</h2>
            <p className="text-[15px] text-[#A9B7B1] max-w-[56ch] mt-2.5 leading-[1.5]">{t('neg.lead')}</p>
            <Btn href="/negotiate" variant="primary" size="lg" className="mt-6">{t('neg.cta')}</Btn>
          </div>
          <div className="rounded-[16px] border border-[#243029] bg-[#161F1B] p-6">
            <div className="flex items-baseline gap-2.5">
              <span className="font-display font-extrabold text-[56px] leading-none text-green tl-num">{pct}%</span>
              <span className="text-[#A9B7B1]">{t('neg.feeUnit')}</span>
            </div>
            <p className="font-semibold mt-2">{t('neg.noFee')}</p>
            <div className="h-px bg-[#243029] my-4" />
            <div className="flex flex-col gap-3 text-[13.5px] text-[#C4D0CA]">
              {[[t('neg.p1t'), t('neg.p1')], [t('neg.p2t'), t('neg.p2')], [t('neg.p3t'), t('neg.p3')]].map(([h, b]) => (
                <div key={h}><b className="text-white">{h}</b> {b}</div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section className="py-12 sm:py-14 text-center">
        <div className={wrap}>
          <h2 className="font-display font-extrabold text-[26px] sm:text-[32px] leading-[1.08] tracking-[-0.03em] mx-auto">{t('final.title')}</h2>
          <p className="text-[15px] text-ink-2 mt-2.5">{t('final.lead')}</p>
          <Btn href="/try" variant="primary" size="lg" className="mt-5">{t('final.cta')}</Btn>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
