export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { NEGOTIATION_SERVICE_ENABLED } from '@/lib/features'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { FileCheck, PhoneCall, Calendar } from 'lucide-react'
import { MarketingHeader } from '@/components/MarketingHeader'
import { MarketingFooter } from '@/components/MarketingFooter'
import { NegotiationRequestForm } from '@/components/NegotiationRequestForm'
import { StageRail } from '@/components/system'
import { NEGOTIATION_FEE_PERCENT } from '@/lib/pricing'

export default async function NegotiatePage() {
  if (!NEGOTIATION_SERVICE_ENABLED) redirect('/')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const t = await getTranslations('negotiateRequest')

  const steps = [
    { icon: FileCheck, label: t('step1'), sub: t('step1sub') },
    { icon: PhoneCall, label: t('step2'), sub: t('step2sub') },
    { icon: Calendar, label: t('step3'), sub: t('step3sub') },
  ]

  return (
    <div className="min-h-screen bg-white text-ink">
      <MarketingHeader />
      <main className="max-w-[880px] mx-auto px-5 sm:px-7 pt-10 pb-14">
        <div className="text-center">
          <p className="tl-label text-green-deep text-[11px]">{t('publicEyebrow')}</p>
          <h1 className="font-display font-extrabold text-[30px] sm:text-[36px] leading-[1.05] tracking-[-0.03em] mt-2.5">{t('publicTitle')}</h1>
          <p className="text-[15px] text-ink-2 max-w-[56ch] mx-auto mt-2.5 leading-[1.5]">{t('publicSub')}</p>
          <div className="max-w-[720px] mx-auto mt-5"><StageRail current="negotiate" /></div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-7">
          {steps.map((s) => (
            <div key={s.label} className="rounded-[14px] border border-line bg-surface px-4 py-3.5 flex items-start gap-3">
              <span className="w-8 h-8 rounded-lg bg-green-soft text-green-deep grid place-items-center shrink-0"><s.icon className="w-4 h-4" /></span>
              <div><p className="text-[13px] font-semibold">{s.label}</p><p className="text-[12px] text-ink-2 mt-0.5">{s.sub}</p></div>
            </div>
          ))}
        </div>

        <div className="rounded-[14px] bg-ink text-white px-5 py-4 mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <p className="font-display font-extrabold text-[30px] leading-none text-green tl-num">{NEGOTIATION_FEE_PERCENT}%<span className="font-sans text-[13px] text-[#A9B7B1] font-normal ml-2">{t('feeUnit')}</span></p>
          <p className="text-[13px] text-[#C4D0CA]">{t('feeNote')}</p>
          <a href="mailto:hello@termlift.com?subject=Let's%20talk%20negotiation" className="ml-auto text-[13px] font-semibold text-white underline underline-offset-2 decoration-[#3d4a44] hover:decoration-white">{t('talkFirst')}</a>
        </div>

        <div className="mt-6"><NegotiationRequestForm source="direct" isAuthenticated={!!user} /></div>
      </main>
      <MarketingFooter />
    </div>
  )
}
