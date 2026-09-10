'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Mail, Sparkles, Loader2, Target, DollarSign, Zap, TrendingUp, Shield, BookOpen, Send, Clock, Briefcase, Copy, ArrowRight, Microscope, Plus, RotateCcw, Eye, Info, Lock } from 'lucide-react'
import Link from 'next/link'
import { normalizeAmount, formatCurrency, parseMoney } from '@/lib/currency'
import type { DealOutput } from '@/types'
import { getCanOffer } from '@/lib/email-asks'
import { hasDeepContent as computeHasDeepContent } from '@/lib/deep-analysis-status'
import { MarketBenchmark } from '@/components/deal/MarketBenchmark'
import { shouldRenderBenchmark } from '@/lib/benchmark/visibility'
import { FULL_ANALYSIS_EMAIL_REGEN_LIMIT, deepAnalysisPriceNote } from '@/lib/pricing'
import { TONE_LABELS, type EmailTone } from '@/lib/tone-recommend'
import { getFlagSeverity } from '@/lib/deal-metrics'
import { Btn, Card, Chip, GateCard } from '@/components/system'
import { TONE_APPROACH } from '@/lib/tone-recommend'
import type { RoundDelta } from '@/types'
import { cn } from '@/lib/utils'
import { VendorOfferField } from '@/components/deal/VendorOfferField'

interface DealScrollViewProps {
  latestOutput: any
  latestRoundId: string
  /** Deal-type inference result (deterministic, computed server-side from
   *  already-extracted data — see lib/deal-type-inference.ts). Threaded into
   *  email generation so renewal vs. new-purchase framing is correct. */
  inferredDealType?: 'renewal' | 'new_purchase' | 'expansion' | 'unknown'
  isV2: boolean
  schemaVersion: string
  score: number | undefined
  scoreLabel: string | undefined
  scoreRationale: string | undefined
  totalCommitment: string | undefined
  term: string | undefined
  redFlagCount: number
  potentialSavings: number
  formatSavingsStr: string | undefined
  dealCurrency: string
  sortedRounds: any[]
  dealId: string
  dealStatus: string | undefined
  locale: 'en' | 'fr'
  closeSummary: any
  savingsAmount: number | null
  savingsPercent: number | null
  closedAt: string | null
  whatChanged: string[] | null
  originalTotal: string | undefined
  isAdmin: boolean
  addRoundForm: React.ReactNode
  messages: Record<string, Record<string, string>>
  /** Demo mode: the "Generate email" button becomes a signup prompt instead of hitting the API. */
  demoMode?: boolean
  /** When false, the full DIY playbook (asks, leverage, email drafts) is replaced with a teaser + "Get this deal negotiated" CTA. */
  showFullPlaybook: boolean
  /** Anonymous /try result: the Step 2 gate sends the visitor to sign up instead of running the Playbook. */
  trialMode?: boolean
  /** Where the teaser's CTA links. Defaults to `/app/deal/{dealId}/negotiate` — override when there's no real saved deal yet (e.g. the anonymous trial view). */
  negotiateHref?: string
  /** Whether a negotiation_requests row already exists for this deal — one of
   *  the signals that real negotiation activity has started (see hasNegotiationActivity). */
  hasNegotiationRequest?: boolean
  /** Free-text context already saved on this deal's negotiation_requests row
   *  (if one exists) — reused to prefill the email generator's optional
   *  context fields rather than asking the user to re-type it. */
  savedNegotiationContext?: {
    objective?: string
    walkAwayNotes?: string
    competitorContext?: string
  }
  /** Redesign: the workspace header owns the primary CTA, so the trailing "Next step" card is redundant. */
  hideNextStep?: boolean
  /** Full Analysis run, owned by the workspace so every CTA on the page triggers the same request. */
  fullAnalysis?: { loading: boolean; error: string | null; run: () => void; due?: boolean; priceLabel?: string; note?: string }
  /** Where the guided flow says the deal is (lib/negotiation-flow.ts). */
  flowPhase?: import('@/lib/negotiation-flow').FlowPhase
}

// ─── helpers ──────────────────────────────────────────────
function getNextBusinessDate(daysOut = 5) {
  const d = new Date()
  let added = 0
  while (added < daysOut) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) added++ }
  const n = d.getDate()
  const suf = n === 1 || n === 21 || n === 31 ? 'st' : n === 2 || n === 22 ? 'nd' : n === 3 || n === 23 ? 'rd' : 'th'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long' }) + ' ' + n + suf
}

const inputCls = 'w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-3 focus:outline-none focus:border-green focus:ring-[3px] focus:ring-green/15'
/** Deal-page cards get more room than the default Card so sections don't read as squished. */
const PAD = 'px-5 py-5'
const scoreBarClass = (pct: number) => (pct >= 60 ? 'bg-green' : pct >= 40 ? 'bg-warn' : 'bg-risk')
const scoreTextClass = (pct: number) => (pct >= 60 ? 'text-green-deep' : pct >= 40 ? 'text-warn' : 'text-risk')

/** Section title with the icon Kevin missed: icon tile + caps heading + one-line sub. */
/** Round 2+: what the vendor's reply changed. Four short lists and the next move. */
function RoundDeltaCard({ d, fr }: { d: RoundDelta; fr: boolean }) {
  const posture = { accept: fr ? 'Accepter' : 'Accept', push: fr ? 'Pousser' : 'Push back', hold: fr ? 'Tenir' : 'Hold', walk: fr ? 'Partir' : 'Walk away' }[d.posture]
  const postureTone: 'green' | 'warn' | 'neutral' | 'risk' = d.posture === 'accept' ? 'green' : d.posture === 'push' ? 'warn' : d.posture === 'walk' ? 'risk' : 'neutral'
  const lists: Array<{ title: string; items: string[]; dot: string }> = [
    { title: fr ? 'Ce qui a changé' : 'What changed', items: d.what_changed, dot: 'bg-ink' },
    { title: fr ? 'Concessions obtenues' : 'Vendor conceded', items: d.concessions, dot: 'bg-green' },
    { title: fr ? 'Demandes refusées' : 'Refused or ignored', items: d.rejected, dot: 'bg-risk' },
    { title: fr ? 'Nouveaux points' : 'New issues introduced', items: d.new_issues, dot: 'bg-warn' },
  ].filter((l) => l.items.length > 0)
  return (
    <Card className="mb-3 flex flex-col gap-3.5">
      {d.headline && <p className="text-[14.5px] font-semibold text-ink leading-snug">{d.headline}</p>}
      {lists.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
          {lists.map((l) => (
            <div key={l.title}>
              <p className="tl-label text-ink-3 mb-1.5">{l.title}</p>
              <ul className="m-0 p-0 list-none flex flex-col gap-1">
                {l.items.map((it, i) => <li key={i} className="flex items-start gap-2 text-[13px] text-ink-2 leading-snug"><span className={cn('w-1.5 h-1.5 rounded-full shrink-0 mt-[7px]', l.dot)} />{it}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
      {d.next_move && (
        <div className="rounded-[10px] border border-green-line bg-green-soft px-3.5 py-3">
          <div className="flex items-center gap-2 mb-1"><span className="tl-label text-green-deep">{fr ? 'Prochain coup recommandé' : 'Recommended next move'}</span><Chip tone={postureTone}>{posture}</Chip></div>
          <p className="text-[13.5px] text-ink leading-relaxed">{d.next_move}</p>
        </div>
      )}
    </Card>
  )
}

function IconHeading({ icon: Icon, title, sub, right, tone = 'neutral', eyebrow }: { icon: typeof Zap; title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; tone?: 'neutral' | 'green' | 'risk' | 'ink'; eyebrow?: React.ReactNode }) {
  const tile = tone === 'green' ? 'bg-green-soft text-green-deep' : tone === 'risk' ? 'bg-risk-soft text-risk' : tone === 'ink' ? 'bg-ink text-white' : 'bg-ground text-ink-2'
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <span className={cn('w-9 h-9 rounded-[10px] grid place-items-center shrink-0', tile)}><Icon className="w-4 h-4" /></span>
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="tl-label text-[11.5px] text-green-deep mb-0.5">{eyebrow}</p>}
        <h3 className="tl-h3 text-ink">{title}</h3>
        {sub && <p className="text-[12.5px] text-ink-2 mt-0.5">{sub}</p>}
      </div>
      {/* On phones the actions drop to their own row instead of squeezing the title into a column. */}
      {right && <div className="flex items-center gap-2 shrink-0 basis-full sm:basis-auto">{right}</div>}
    </div>
  )
}

// ─── component ────────────────────────────────────────────
export function DealScrollView(props: DealScrollViewProps) {
  const {
    latestOutput, latestRoundId, inferredDealType,
    score, totalCommitment,
    redFlagCount, potentialSavings, dealCurrency,
    sortedRounds, dealId, dealStatus, locale,
    savingsAmount, savingsPercent, closedAt,
    addRoundForm, messages, demoMode, showFullPlaybook, trialMode = false,
    negotiateHref = `/app/deal/${dealId}/negotiate`,
    hasNegotiationRequest = false,
    savedNegotiationContext,
    fullAnalysis,
    flowPhase,
  } = props

  const o = latestOutput as DealOutput
  const isClosed = dealStatus?.startsWith('closed_')
  const fmtSav = (n: number) => formatCurrency(n, dealCurrency as any)
  const router = useRouter()
  const fr = locale === 'fr'

  // ── Full Analysis (on-demand enrichment) ──
  const deepAnalysisStatus = (o as any)?.deep_analysis_status as 'idle' | 'running' | 'done' | undefined
  // Shared with the server-rendered hero (page.tsx) so both branch on the
  // exact same signal — see lib/deep-analysis-status.ts for the legacy-deal
  // reasoning behind this formula. Entitlement is per deal: once Full Analysis
  // ran on any round, later rounds (vendor replies analysed at quick depth)
  // inherit it, and the playbook is read from the round that carries it.
  const deepRound = sortedRounds.find((r: any) => computeHasDeepContent(r?.output_json))
  const hasDeepContent = computeHasDeepContent(o) || !!deepRound
  /** Source of the strategy sections (asks, leverage, savings, benchmark): the latest output when it has them, else the round Full Analysis ran on. */
  const pb = (computeHasDeepContent(o) ? o : (deepRound?.output_json as DealOutput | undefined) ?? o) as DealOutput
  // The run itself is owned by DealWorkspace (header, next-step card and this
  // gate all trigger the same request); a standalone render falls back to local state.
  const [localDeepLoading, setLocalDeepLoading] = useState(deepAnalysisStatus === 'running')
  const [localDeepError, setLocalDeepError] = useState<string | null>(null)
  const deepAnalysisLoading = fullAnalysis ? fullAnalysis.loading : localDeepLoading
  const deepAnalysisError = fullAnalysis ? fullAnalysis.error : localDeepError
  const handleDeepAnalysis = async () => {
    if (fullAnalysis) return fullAnalysis.run()
    if (localDeepLoading || deepAnalysisStatus === 'done') return
    setLocalDeepLoading(true); setLocalDeepError(null)
    try {
      const res = await fetch(`/api/deal/${dealId}/deep-analysis`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Building the Playbook failed')
      // The Playbook lands at the top of the page (verdict, tiles, next step), so bring the user there.
      window.scrollTo({ top: 0, behavior: 'smooth' })
      router.refresh()
    } catch (err) {
      setLocalDeepError(err instanceof Error ? err.message : 'Building the Playbook failed')
    } finally {
      setLocalDeepLoading(false)
    }
  }

  const t = (key: string, vars?: Record<string, string | number>) => {
    let text = messages[locale]?.[key] || messages.en[key] || key
    if (vars) Object.entries(vars).forEach(([k, v]) => { text = text.replace(`{${k}}`, String(v)) })
    return text
  }

  // ── collapsible state ─────────────────────
  const [expandedBar, setExpandedBar] = useState<string | null>(null)
  const [showNiceToHave, setShowNiceToHave] = useState(false)

  // ── savings data ──────────────────────────
  const savingsData = useMemo(() => {
    const ps = pb?.potential_savings as any
    if (!ps) return { total: 0, mustHave: [] as any[], niceToHave: [] as any[] }
    if (ps.must_have !== undefined) {
      // `quantified: false` = a conditional ask whose amount was removed in code (lib/savings-normalize.ts); shown as "Not quantified".
      const amt = (i: any) => (i.quantified === false || i.amount == null ? 0 : typeof i.amount === 'number' ? i.amount : parseMoney(String(i.amount || '0')).amount)
      const mh = (ps.must_have || []).map((i: any) => ({ ask: i.ask, amount: amt(i), rationale: i.rationale || '', quantified: i.quantified !== false && i.amount != null }))
      const nth = (ps.nice_to_have || []).map((i: any) => ({ ask: i.ask, amount: amt(i), rationale: i.rationale || '', quantified: i.quantified !== false && i.amount != null }))
      return { total: mh.reduce((s: number, i: any) => s + (i.amount || 0), 0), mustHave: mh, niceToHave: nth }
    }
    if (Array.isArray(ps)) {
      const mh = ps.filter((s: any) => s.confidence !== 'low').map((s: any) => ({ ask: s.ask, amount: parseMoney(s.annual_impact || '').amount, rationale: s.rationale || '' }))
      const nth = ps.filter((s: any) => s.confidence === 'low').map((s: any) => ({ ask: s.ask, amount: parseMoney(s.annual_impact || '').amount, rationale: s.rationale || '' }))
      return { total: mh.reduce((s: number, i: any) => s + (i.amount || 0), 0), mustHave: mh, niceToHave: nth }
    }
    return { total: 0, mustHave: [], niceToHave: [] }
  }, [pb?.potential_savings])

  // ── email state ───────────────────────────
  const bizDate = getNextBusinessDate()
  const toneOrder: EmailTone[] = ['neutral', 'firm', 'final_push']
  // Recommended variant: stored with the drafts on generation; falls back to the first.
  const storedRecIdx = toneOrder.indexOf(((o as any)?.email_recommended_tone ?? '') as EmailTone)
  const [recommendedIdx, setRecommendedIdx] = useState(storedRecIdx >= 0 ? storedRecIdx : 0)
  const [emailTab, setEmailTab] = useState(storedRecIdx >= 0 ? storedRecIdx : 0)
  const [emailSubjects, setEmailSubjects] = useState([
    o?.email_drafts?.neutral?.subject?.replace(/\[DATE\]/gi, bizDate) || '',
    o?.email_drafts?.firm?.subject?.replace(/\[DATE\]/gi, bizDate) || '',
    o?.email_drafts?.final_push?.subject?.replace(/\[DATE\]/gi, bizDate) || '',
  ])
  const [emailBodies, setEmailBodies] = useState([
    o?.email_drafts?.neutral?.body?.replace(/\[DATE\]/gi, bizDate) || '',
    o?.email_drafts?.firm?.body?.replace(/\[DATE\]/gi, bizDate) || '',
    o?.email_drafts?.final_push?.body?.replace(/\[DATE\]/gi, bizDate) || '',
  ])
  // "Additional instructions" (Part 2, field 6) — same field that used to be
  // the bare "custom instructions" box, just relabeled and moved into the
  // context panel below.
  // Context persistence (no schema): the context used for the last generation lives
  // on the round as output_json.email_context. On a new round (vendor reply
  // uploaded) the previous round's context carries over. A negotiation request's
  // fields are the last fallback; walk_away_notes (free text) lands in
  // "additional instructions" only when nothing newer exists.
  const savedCtx: import('@/types').EmailContext | undefined =
    (o as any)?.email_context ?? (sortedRounds[1]?.output_json as any)?.email_context ?? undefined
  const [customPrompt, setCustomPrompt] = useState(savedCtx?.additionalInstructions || savedNegotiationContext?.walkAwayNotes || '')
  const [regenerating, setRegenerating] = useState(false)
  const [regenError, setRegenError] = useState<string | null>(null)
  // Real remaining budget from the round's counter (was a hard-coded 3, wrong after a reload).
  const [remainingRegens, setRemainingRegens] = useState(Math.max(0, (props.isAdmin ? 99 : FULL_ANALYSIS_EMAIL_REGEN_LIMIT) - ((sortedRounds[0] as any)?.email_regeneration_count ?? 0)))
  const [copiedEmail, setCopiedEmail] = useState(false)

  // Optional user-supplied negotiation context (Part 2) — everything the
  // quote/analysis can't reliably know. Objective and competing-quote
  // prefill from an existing negotiation_requests row for this deal where
  // available (Part 6); nothing here is persisted anywhere new.
  // The preparation panel is open by default until a first email exists; after that it folds behind "Edit negotiation context".
  const [showEmailContext, setShowEmailContext] = useState(!o?.email_drafts?.neutral?.body)
  const [negotiationObjective, setNegotiationObjective] = useState(savedCtx?.negotiationObjective || savedNegotiationContext?.objective || '')
  const [budgetCeiling, setBudgetCeiling] = useState(savedCtx?.budgetCeiling || '')
  const [competingQuote, setCompetingQuote] = useState(savedCtx?.competingQuote || savedNegotiationContext?.competitorContext || '')
  const [walkAwayFlexibility, setWalkAwayFlexibility] = useState<'flexible' | 'prefer_stay' | 'can_walk' | ''>(savedCtx?.walkAwayFlexibility || '')
  const [internalDeadline, setInternalDeadline] = useState(savedCtx?.internalDeadline || '')

  const hasEmail = !!(o?.email_drafts?.neutral?.body)

  // Real negotiation activity — an analysis by itself is not a negotiation
  // round. sortedRounds.length > 1 means a genuine round 2+ (vendor response
  // uploaded, counter-offer added) already exists.
  const hasNegotiationActivity = sortedRounds.length > 1 || hasEmail || hasNegotiationRequest || isClosed
  // Step 2 and 3 content only exists once Deep Analysis ran (or, for legacy deals, once
  // negotiation activity exists). Before that the page ends at the single Step 2 gate.
  const stepsUnlocked = hasDeepContent || hasNegotiationActivity
  // The vendor-response form is the obvious next step once an email has gone out; before
  // that it stays behind a small link (a reply can arrive by phone or from a call).
  const [revealAddRound, setRevealAddRound] = useState(false)
  const anyRoundEmailed = sortedRounds.some((r: any) => !!r?.output_json?.email_drafts?.neutral?.body)

  const handleGenerate = async () => {
    if (demoMode || !latestRoundId || remainingRegens <= 0) return
    setRegenerating(true); setRegenError(null)
    try {
      const highSeverityFlagCount = (o?.red_flags || []).filter((f: any) => String(f?.severity || '').toLowerCase() === 'high').length
      const res = await fetch('/api/deal/regenerate-emails', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roundId: latestRoundId,
          customPrompt: customPrompt.trim() || null,
          vendor: o?.vendor || o?.snapshot?.vendor_product,
          contactName: (o as any)?.contact_name,
          totalCommitment: o?.snapshot?.total_commitment,
          term: o?.snapshot?.term,
          currency: dealCurrency,
          mustHaveAsks: pb?.what_to_ask_for?.must_have || [],
          niceToHaveAsks: pb?.what_to_ask_for?.nice_to_have || [],
          redFlagAsks: (o?.red_flags || []).map((f: any) => f.what_to_ask_for).filter(Boolean),
          canOffer: getCanOffer(o),
          conclusion: o?.quick_read?.conclusion,
          dealType: inferredDealType && inferredDealType !== 'unknown' ? inferredDealType : undefined,
          // Automatic context — the route now reads asks, target, deal type and
          // flags from the stored round itself; these are kept for older builds only.
          potentialSavingsTotal: savingsData.total > 0 ? fmtSav(savingsData.total) : undefined,
          leverageYouHave: pb?.negotiation_plan?.leverage_you_have || [],
          paymentTerms: o?.snapshot?.billing_payment,
          pricingModel: o?.snapshot?.pricing_model,
          leverageLevel: (o as any)?.classification?.leverage_level,
          highSeverityFlagCount,
          // Optional user context (Part 2) — omitted entirely when blank.
          negotiationObjective: negotiationObjective.trim() || undefined,
          budgetCeiling: budgetCeiling.trim() || undefined,
          competingQuote: competingQuote.trim() || undefined,
          walkAwayFlexibility: walkAwayFlexibility || undefined,
          internalDeadline: internalDeadline.trim() || undefined,
          // Market Benchmark (deterministic engine + clamped model target). Internal numbers —
          // the route tells the model how (not) to voice them.
          benchmarkAvailable: !!(pb as any)?.market_benchmark?.benchmark_available,
          benchmarkTarget: (pb as any)?.benchmark_interpretation?.target_price != null ? fmtSav((pb as any).benchmark_interpretation.target_price) : undefined,
          benchmarkOpeningAsk: (pb as any)?.benchmark_interpretation?.opening_ask != null ? fmtSav((pb as any).benchmark_interpretation.opening_ask) : undefined,
          benchmarkFairLow: (pb as any)?.market_benchmark?.benchmark_available ? fmtSav((pb as any).market_benchmark.fair_market_low) : undefined,
          benchmarkFairHigh: (pb as any)?.market_benchmark?.benchmark_available ? fmtSav((pb as any).market_benchmark.fair_market_high) : undefined,
          benchmarkConfidence: (pb as any)?.market_benchmark?.confidence,
          benchmarkPositionPct: (pb as any)?.market_benchmark?.benchmark_available ? (pb as any).market_benchmark.quote_vs_market_percent : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setEmailSubjects(data.emails.map((e: any) => e.subject))
      setEmailBodies(data.emails.map((e: any) => e.body))
      const recIdx = toneOrder.indexOf(data.recommendedTone)
      setRecommendedIdx(recIdx >= 0 ? recIdx : 0)
      setEmailTab(recIdx >= 0 ? recIdx : 0)
      setRemainingRegens(data.remainingRegenerations)
      // Context is now persisted with the drafts — keep it in the form (it prefills next time too).
      setShowEmailContext(false)
      router.refresh()
    } catch (err) { setRegenError(err instanceof Error ? err.message : 'Failed') }
    finally { setRegenerating(false) }
  }

  // ── flag sorting ──────────────────────────
  const sortedFlags = useMemo(() => {
    if (!o?.red_flags) return []
    return o.red_flags.map((flag: any, i: number) => {
      // Same helper as the header tile (lib/deal-metrics.getFlagSeverity) so counts never disagree.
      const sev = getFlagSeverity(flag).toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW'
      return { flag, idx: i, severity: sev, order: sev === 'HIGH' ? 0 : sev === 'MEDIUM' ? 1 : 2 }
    }).sort((a: any, b: any) => a.order - b.order)
  }, [o?.red_flags])

  // ── red flag accordion state ──
  const [openFlags, setOpenFlags] = useState<Record<number, boolean>>({})
  const [showWatch, setShowWatch] = useState(false)
  const allFlagsOpen = sortedFlags.length > 0 && sortedFlags.every(({ idx }: any) => openFlags[idx])
  const toggleFlag = (idx: number) => setOpenFlags((p) => ({ ...p, [idx]: !p[idx] }))
  const toggleAllFlags = () => {
    const next: Record<number, boolean> = {}
    if (!allFlagsOpen) sortedFlags.forEach(({ idx }: any) => { next[idx] = true })
    setOpenFlags(next)
  }

  // ── score breakdown ───────────────────────
  const bd = o?.score_breakdown
  const scoreRows = (() => {
    if (!bd || score == null) return null
    const nb = bd as any
    const isNew = Array.isArray(nb.deductions)
    const rows = isNew
      ? [
          { key: 'pricing', label: fr ? 'Prix' : 'Pricing', val: nb.pricing ?? 0, max: 100 },
          { key: 'terms', label: fr ? 'Conditions' : 'Terms', val: nb.terms ?? 0, max: 100 },
          { key: 'leverage', label: fr ? 'Levier' : 'Leverage', val: nb.leverage ?? 0, max: 100 },
        ]
      : [
          { key: 'pricing', label: fr ? 'Prix' : 'Pricing', val: nb.pricing_fairness ?? 0, max: 50 },
          { key: 'terms', label: fr ? 'Conditions' : 'Terms', val: nb.terms_protections ?? 0, max: 30 },
          { key: 'leverage', label: fr ? 'Levier' : 'Leverage', val: nb.leverage_position ?? 0, max: 20 },
        ]
    return rows.map((r) => ({ ...r, pct: Math.round((r.val / r.max) * 100), items: isNew ? (nb.deductions as any[]).filter((d) => d.category === r.key) : [] }))
  })()

  const fmtSnapDate = (d?: string) => {
    if (!d || d === 'not_stated') return null
    const dt = new Date(d)
    return isNaN(dt.getTime()) ? d : dt.toLocaleDateString(fr ? 'fr-FR' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  // Vertical label/value list (as in the draft) — fills the card beside the score breakdown.
  const snapshotItems = o?.snapshot ? [
    { label: t('output.vendor'), val: (o.snapshot.vendor_product || o.vendor || '').split('/')[0].trim() },
    { label: t('output.total'), val: o.snapshot.total_commitment ? normalizeAmount(o.snapshot.total_commitment) : '—' },
    { label: t('output.term'), val: o.snapshot.term || '—' },
    { label: fr ? 'Facturation' : 'Billing', val: o.snapshot.billing_payment || '—' },
    { label: t('output.dealType'), val: o.snapshot.deal_type || '—' },
    { label: t('output.pricingModel'), val: o.snapshot.pricing_model || '—' },
    ...(fmtSnapDate(o.snapshot.renewal_date) ? [{ label: fr ? 'Renouvellement' : 'Renewal date', val: fmtSnapDate(o.snapshot.renewal_date) as string }] : []),
    ...(fmtSnapDate(o.snapshot.signing_deadline) ? [{ label: fr ? 'Date limite de signature' : 'Signing deadline', val: fmtSnapDate(o.snapshot.signing_deadline) as string }] : []),
  ].filter((i) => i.val && i.val !== '—' || ['Vendor', 'Total', 'Term'].includes(i.label)) : []

  const toneChipLabel = (tone: EmailTone) => TONE_LABELS[tone][fr ? 'fr' : 'en']

  // ═══════════════════════════════════════════
  // RENDER — sections as separate objects on the page ground
  // ═══════════════════════════════════════════
  return (
    <div className="flex flex-col gap-5">

      {/* ═══ 1. OVERVIEW — snapshot | score breakdown + already solid (as in the draft) ═══ */}
      <div id="overview" className="scroll-mt-[196px]">
        <p className="tl-label text-[11.5px] text-green-deep mb-2.5">{fr ? 'Étape 1 · Analyse rapide' : 'Step 1 · Quick analysis'}</p>
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-5 items-start">
        <Card className={PAD}>
          <IconHeading icon={BookOpen} title={t('output.dealSnapshot')} />
          <dl className="m-0 divide-y divide-line-2">
            {snapshotItems.map((item) => (
              <div key={item.label} className="grid grid-cols-[130px_1fr] gap-4 py-2.5 first:pt-0 last:pb-0 items-baseline">
                <dt className="tl-label text-ink-3">{item.label}</dt>
                <dd className="m-0 text-[14px] font-semibold text-ink break-words">{item.val}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className={PAD}>
          <IconHeading icon={Target} title={fr ? 'Détail du score' : 'Score breakdown'} />
          {scoreRows ? (
            <div className="flex flex-col gap-3.5">
              {scoreRows.map((r) => {
                const canExpand = r.items.length > 0
                const open = expandedBar === r.key
                const bar = (
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-medium text-ink w-[76px] shrink-0 text-left flex items-center gap-1">{r.label}{canExpand && <ChevronDown className={cn('w-3 h-3 text-ink-3 transition-transform', open && 'rotate-180')} />}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-line-2 overflow-hidden"><div className={cn('h-full rounded-full transition-all duration-500', scoreBarClass(r.pct))} style={{ width: `${r.pct}%` }} /></div>
                    <span className={cn('text-[13px] font-bold w-10 text-right tl-num', scoreTextClass(r.pct))}>{r.pct}%</span>
                  </div>
                )
                return (
                  <div key={r.key}>
                    {canExpand ? <button onClick={() => setExpandedBar(open ? null : r.key)} className="w-full" aria-expanded={open}>{bar}</button> : bar}
                    {canExpand && (
                      <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
                        <div className="overflow-hidden">
                          <ul className="m-0 p-0 list-none pl-[76px] pr-10 pt-2 flex flex-col gap-1">
                            {r.items.map((d: any, i: number) => (
                              <li key={i} className="flex items-center justify-between gap-3 text-[12px]"><span className="text-ink-2 leading-snug">{d.label}</span><span className={cn('font-bold shrink-0 font-display tl-num', d.points < 0 ? 'text-risk' : 'text-green-deep')}>{d.points < 0 ? `−${Math.abs(d.points)}` : `+${d.points}`}</span></li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : <p className="text-[13px] text-ink-3">—</p>}
          {o?.quick_read?.whats_solid && o.quick_read.whats_solid.length > 0 && (
            <div className="mt-5 pt-4 border-t border-line-2">
              <IconHeading icon={CheckCircle2} tone="green" title={t('output.whatsAlreadySolid')} />
              <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
                {o.quick_read.whats_solid.map((item: string, i: number) => (
                  <li key={i} className="flex items-start gap-2.5 text-[13.5px] text-ink leading-snug"><CheckCircle2 className="w-4 h-4 text-green shrink-0 mt-px" />{item}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
      </div>

      {/* ═══ 2. RED FLAGS ═══ */}
      <section id="flags" className="scroll-mt-[196px]">
        <IconHeading
          icon={AlertTriangle}
          tone={sortedFlags.length > 0 ? 'risk' : 'green'}
          title={`${t('output.redFlags')} · ${sortedFlags.length}`}
          sub={hasDeepContent || demoMode
            ? (fr ? 'Chaque point inclut quoi demander et une position de repli' : 'Each issue includes what to ask for and a fallback position')
            : (fr ? 'Ouvrez un point pour voir pourquoi il compte. Les demandes et positions de repli arrivent avec le Plan de négociation.' : 'Open an issue to see why it matters. The asks and fallback positions come with the Negotiation Playbook.')}
          right={
            <>
              {hasDeepContent && <Chip tone="green"><CheckCircle2 className="w-3 h-3" />{fr ? 'Analyse détaillée prête' : 'Detailed analysis ready'}</Chip>}
              {sortedFlags.length > 1 && (
                <Btn variant="link" size="sm" onClick={toggleAllFlags}>
                  {allFlagsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {allFlagsOpen ? (fr ? 'Tout réduire' : 'Collapse all') : (fr ? 'Tout afficher' : 'Expand all')}
                </Btn>
              )}
            </>
          }
        />

        {sortedFlags.length > 0 ? (
          <div className="bg-surface border border-line rounded-[14px] overflow-hidden divide-y divide-line-2">
            {sortedFlags.map(({ flag, idx, severity }: any, pos: number) => {
              const tone: 'risk' | 'warn' | 'neutral' = severity === 'HIGH' ? 'risk' : severity === 'MEDIUM' ? 'warn' : 'neutral'
              const stripe = severity === 'HIGH' ? 'border-l-risk' : severity === 'MEDIUM' ? 'border-l-warn' : 'border-l-line'
              const open = !!openFlags[idx]
              return (
                <div key={idx} className={cn('border-l-[3px]', stripe)}>
                  <button onClick={() => toggleFlag(idx)} className="w-full flex items-start gap-3.5 px-5 py-4 text-left hover:bg-surface-2 transition-colors" aria-expanded={open}>
                    <span className={cn('w-7 h-7 rounded-full text-[12px] font-bold grid place-items-center shrink-0 font-display', severity === 'HIGH' ? 'bg-risk text-white' : severity === 'MEDIUM' ? 'bg-warn text-white' : 'bg-line-2 text-ink-2')}>{pos + 1}</span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2 flex-wrap mb-1"><Chip tone={tone} mono>{severity}</Chip></span>
                      <span className="block text-[14px] font-semibold text-ink leading-snug">{flag.issue}</span>
                    </span>
                    <ChevronDown className={cn('w-4 h-4 text-ink-3 shrink-0 mt-1.5 transition-transform', open && 'rotate-180')} />
                  </button>
                  <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
                    <div className="overflow-hidden">
                      <div className="pb-5 pr-5 pl-[62px]">
                        <p className="text-[13.5px] text-ink-2 leading-relaxed">{flag.why_it_matters}</p>
                        {(flag.what_to_ask_for || flag.if_they_push_back) ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                            {flag.what_to_ask_for && <div className="border-l-2 border-green pl-3"><p className="tl-label text-ink-3 mb-1">{t('output.whatToAskFor')}</p><p className="text-[13px] text-ink font-medium leading-snug">{flag.what_to_ask_for}</p></div>}
                            {flag.if_they_push_back && <div className="border-l-2 border-line pl-3"><p className="tl-label text-ink-3 mb-1">{t('output.fallbackPosition')}</p><p className="text-[13px] text-ink-2 leading-snug">{flag.if_they_push_back}</p></div>}
                          </div>
                        ) : !hasDeepContent && !demoMode ? (
                          /* Quick stage: the ask + fallback were stripped server-side (lib/negotiation-gating.ts). */
                          <p className="mt-3.5 flex items-center gap-2 text-[12.5px] text-ink-3">
                            <Lock className="w-3.5 h-3.5 shrink-0" />
                            {fr ? 'La demande et la position de repli pour ce point arrivent avec le Plan de négociation.' : 'The ask and fallback position for this issue come with the Negotiation Playbook.'}
                            {showFullPlaybook && <a href="#deep-analysis" className="text-green-deep font-medium no-underline hover:underline">{fr ? 'Obtenir le Plan de négociation' : 'Get the Negotiation Playbook'}</a>}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <Card className="text-center py-8">
            <CheckCircle2 className="w-9 h-9 text-green mx-auto mb-2" />
            <p className="text-[14px] font-semibold text-ink">{fr ? 'Aucun point de vigilance' : 'No red flags found'}</p>
            <p className="text-[12.5px] text-ink-2 mt-0.5">{fr ? 'Ce dossier est propre — bien joué.' : 'This deal looks clean — nice work.'}</p>
          </Card>
        )}

        {/* Worth noting — deep-only minor items */}
        {hasDeepContent && Array.isArray((pb as any)?.watchItems) && (pb as any).watchItems.length > 0 && (
          <Card pad={false} className="mt-3">
            <button onClick={() => setShowWatch(!showWatch)} className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface-2 transition-colors" aria-expanded={showWatch}>
              <span className="flex items-center gap-2 text-[13px] font-semibold text-ink-2"><Eye className="w-3.5 h-3.5 text-ink-3" />{showWatch ? (fr ? 'À noter' : 'Worth noting') : `${fr ? 'Afficher' : 'Show'} ${(pb as any).watchItems.length} ${fr ? 'point(s) mineur(s)' : `minor item${(pb as any).watchItems.length === 1 ? '' : 's'}`}`}</span>
              <ChevronDown className={cn('w-4 h-4 text-ink-3 shrink-0 transition-transform', showWatch && 'rotate-180')} />
            </button>
            <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: showWatch ? '1fr' : '0fr' }}>
              <div className="overflow-hidden">
                <ul className="m-0 px-4 pb-3.5 pt-0.5 list-none flex flex-col gap-1.5">
                  {(pb as any).watchItems.map((w: any, i: number) => (
                    <li key={i} className="text-[13px] text-ink-2 leading-snug flex items-start gap-2"><span className="text-ink-3 shrink-0">•</span>{w.description}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        )}
      </section>

      {/* ═══ 1c. ASSUMPTIONS — part of the analysis, so they sit with step 1 ═══ */}
      {o?.assumptions && o.assumptions.length > 0 && (
        <Card className={PAD}>
          <IconHeading icon={Info} title={fr ? 'Hypothèses' : 'Assumptions'} />
          <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
            {o.assumptions.map((a: string, i: number) => (
              <li key={i} className="text-[13px] text-ink-2 leading-relaxed flex items-start gap-2"><span className="text-ink-3 shrink-0">•</span>{a}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* ═══ THE ONE GATE — Step 2, at the end of everything step 1 unlocked. Nothing below it until Full Analysis runs. ═══ */}
      {!demoMode && !hasDeepContent && (
        <div id="deep-analysis" className="scroll-mt-[196px]">
          {deepAnalysisLoading ? (
            <DeepAnalysisProgress locale={locale} />
          ) : (
            <GateCard
              tone="green"
              eyebrow={fr ? 'Étape 2 · Plan de négociation' : 'Step 2 · Negotiation Playbook'}
              title={fr ? 'Construisez votre stratégie de négociation' : 'Build your negotiation strategy'}
              body={<>{fr ? 'Obtenez les demandes ordonnées et chiffrées, les positions cibles, les replis, vos leviers et la séquence de négociation prête à envoyer. Quelques minutes.' : 'Get the ordered asks with amounts, target positions, fallbacks, your leverage and the ready-to-send negotiation sequence. A couple of minutes.'}<span className="block mt-1.5 font-semibold text-green-deep">{fullAnalysis?.note ?? deepAnalysisPriceNote(locale)}{trialMode && (fr ? ' Cette analyse vous suit dans votre compte.' : ' This analysis comes with you into your account.')}</span>{deepAnalysisError && <span className="block text-risk mt-1">{deepAnalysisError}</span>}</>}
              action={trialMode
                ? <Btn href="/login?from=trial" variant="primary">{fr ? 'Créer un compte gratuit' : 'Create free account'}</Btn>
                : <Btn variant="primary" onClick={handleDeepAnalysis}><Microscope className="w-4 h-4" />{deepAnalysisError ? (fr ? 'Réessayer' : 'Try again') : (fr ? 'Obtenir le Plan de négociation' : 'Get the Negotiation Playbook')}{fullAnalysis?.due && !deepAnalysisError ? ` · ${fullAnalysis.priceLabel}` : ''}</Btn>}
            />
          )}
        </div>
      )}

      {/* ═══ 2. PLAYBOOK — the Step 2 block (playbook · savings · benchmark) ═══ */}
      {(!showFullPlaybook || hasDeepContent) && (
        <section id="playbook" className="scroll-mt-[196px]">
          {!showFullPlaybook ? (
            <NegotiationTeaser negotiateHref={negotiateHref} locale={locale} redFlagCount={redFlagCount} potentialSavings={potentialSavings} fmtSav={fmtSav} icon={Zap} />
          ) : (
            <>
              <IconHeading icon={Zap} tone="green" eyebrow={fr ? 'Étape 2 · Stratégie' : 'Step 2 · Strategy'} title={fr ? 'Votre plan de négociation' : 'Your negotiation playbook'} sub={fr ? 'Quoi demander, votre levier, et quoi offrir en retour' : 'What to push for, your leverage, and what to offer in return'} />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className={cn('rounded-[14px] border border-green-line bg-green-soft', PAD)}>
                  <p className="tl-label text-green-deep mb-3.5 flex items-center gap-1.5"><Target className="w-3.5 h-3.5" />{t('output.pushFor')}</p>
                  <ol className="m-0 p-0 list-none flex flex-col gap-3">
                    {pb?.what_to_ask_for?.must_have?.map((item: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-[13px] font-medium text-ink leading-snug"><span className="w-[18px] h-[18px] rounded-full bg-green text-white tl-label text-[10px] grid place-items-center shrink-0 mt-px">{i + 1}</span>{item}</li>
                    ))}
                    {pb?.what_to_ask_for?.nice_to_have?.map((item: string, i: number) => (
                      <li key={`n${i}`} className="flex items-start gap-2 text-[12.5px] text-ink-2 leading-snug"><span className="w-[18px] h-[18px] rounded-full bg-surface border border-green-line text-green-deep tl-label text-[10px] grid place-items-center shrink-0 mt-px">+</span>{item}</li>
                    ))}
                  </ol>
                </div>
                <Card className={PAD}>
                  <p className="tl-label text-ink-3 mb-3.5 flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" />{t('output.yourLeverage')}</p>
                  <ul className="m-0 p-0 list-none flex flex-col gap-3">
                    {pb?.negotiation_plan?.leverage_you_have?.map((item: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-[13px] text-ink leading-snug"><span className="w-3.5 h-3.5 rounded-full border-[1.5px] border-green shrink-0 mt-[3px]" />{item}</li>
                    ))}
                  </ul>
                </Card>
                <Card className={PAD}>
                  <p className="tl-label text-ink-3 mb-3.5 flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" />{t('output.canOffer')}</p>
                  <ul className="m-0 p-0 list-none flex flex-col gap-3">
                    {pb?.negotiation_plan?.trades_you_can_offer?.map((item: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-[13px] text-ink leading-snug"><span className="w-3.5 h-3.5 rounded-full border-[1.5px] border-green shrink-0 mt-[3px]" />{item}</li>
                    ))}
                  </ul>
                </Card>
              </div>

              {/* Savings impact */}
              {savingsData.total > 0 && (savingsData.mustHave.length > 0 || savingsData.niceToHave.length > 0) && (() => {
                const dealTotalNum = parseMoney(totalCommitment || '0').amount
                const afterAmt = Math.max(0, dealTotalNum - savingsData.total)
                const pct = dealTotalNum > 0 ? Math.min(Math.round((savingsData.total / dealTotalNum) * 100), 50) : 0
                return (
                  <Card className={cn('mt-4', PAD)}>
                    <IconHeading icon={DollarSign} tone="green" title={t('output.savingsImpact')} sub={fr ? 'Si toutes les demandes indispensables aboutissent' : 'If every must-have ask lands'} />
                    {/* Three figures on one baseline; the green total sits over the right-hand column so it lines up with the list amounts below. */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                      <div><p className="tl-label text-ink-3">{fr ? 'Devis initial' : 'Original quote'}</p><p className="font-display font-bold text-[22px] text-ink-3 line-through tl-num leading-none mt-1.5">{totalCommitment ? normalizeAmount(totalCommitment) : '—'}</p></div>
                      <div><p className="tl-label text-ink-3">{fr ? 'Après économies' : 'After savings'}</p><p className="font-display font-bold text-[22px] text-ink tl-num leading-none mt-1.5">{fmtSav(afterAmt)}</p></div>
                      <div className="sm:text-right"><p className="tl-label text-green-deep">{fr ? `Économies · ${pct} %` : `Savings · ${pct}%`}</p><p className="font-display font-extrabold text-[22px] text-green-deep tl-num leading-none mt-1.5">{fmtSav(savingsData.total)}</p></div>
                    </div>
                    <div className="h-1.5 rounded-full bg-line-2 overflow-hidden mt-4"><div className="h-full rounded-full bg-green transition-all duration-500" style={{ width: `${pct}%` }} /></div>
                    {savingsData.mustHave.length > 0 && (
                      <div className="mt-5 pt-4 border-t border-line-2">
                        <p className="tl-label text-green-deep mb-1">{fr ? 'Économies indispensables' : 'Must-have savings'}</p>
                        <ol className="m-0 p-0 list-none divide-y divide-line-2">
                          {savingsData.mustHave.map((item: any, i: number) => (
                            <li key={i} className="flex items-start justify-between gap-4 py-3">
                              <span className="flex items-start gap-2.5 min-w-0"><span className="w-5 h-5 rounded-full bg-green text-white tl-label text-[10px] grid place-items-center shrink-0">{i + 1}</span><span className="min-w-0"><span className="block text-[13.5px] font-medium text-ink">{item.ask}</span>{item.rationale && <span className="block text-[12.5px] text-ink-2 mt-0.5">{item.rationale}</span>}</span></span>
                              {item.amount > 0 ? (
                                <span className="font-display font-bold text-[14px] text-green-deep shrink-0 tl-num">{fmtSav(item.amount)}</span>
                              ) : (
                                <span className="text-[12px] text-ink-3 shrink-0 whitespace-nowrap">{fr ? 'Non chiffré' : 'Not quantified'}</span>
                              )}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {savingsData.niceToHave.length > 0 && (
                      <div className="mt-2 pt-3 border-t border-line-2">
                        <button onClick={() => setShowNiceToHave(!showNiceToHave)} className="w-full flex items-center justify-between gap-3 py-1 text-left" aria-expanded={showNiceToHave}>
                          <span className="tl-label text-ink-3">{fr ? 'Souhaitables' : 'Nice-to-have'} <span className="text-ink-3 normal-case tracking-normal font-normal">· {savingsData.niceToHave.length}{(() => { const sub = savingsData.niceToHave.reduce((s: number, i: any) => s + (i.amount || 0), 0); return sub > 0 ? ` · ${fmtSav(sub)}` : '' })()}</span></span>
                          <ChevronDown className={cn('w-4 h-4 text-ink-3 transition-transform', showNiceToHave && 'rotate-180')} />
                        </button>
                        {showNiceToHave && (
                          <ol className="m-0 p-0 list-none divide-y divide-line-2">
                            {savingsData.niceToHave.map((item: any, i: number) => (
                              <li key={i} className="flex items-start justify-between gap-4 py-3">
                                <span className="flex items-start gap-2.5 min-w-0"><span className="w-5 h-5 rounded-full bg-line-2 text-ink-2 tl-label text-[10px] grid place-items-center shrink-0">+</span><span className="min-w-0"><span className="block text-[13.5px] text-ink">{item.ask}</span>{item.rationale && <span className="block text-[12.5px] text-ink-3 mt-0.5">{item.rationale}</span>}</span></span>
                                {item.amount > 0 ? (
                                  <span className="font-display font-semibold text-[13.5px] text-ink-2 shrink-0 tl-num">{fmtSav(item.amount)}</span>
                                ) : (
                                  <span className="text-[12px] text-ink-3 shrink-0 whitespace-nowrap">{fr ? 'Non chiffré' : 'Not quantified'}</span>
                                )}
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    )}
                  </Card>
                )
              })()}

              {pb?.cash_flow_improvements && pb.cash_flow_improvements.length > 0 && (
                <div className={cn('mt-4 rounded-[14px] border border-info-line bg-info-soft', PAD)}>
                  <p className="tl-label text-info mb-2.5 flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" />{t('output.cashFlowAndRiskImprovements')}</p>
                  <ul className="m-0 p-0 list-none flex flex-col gap-2">
                    {pb.cash_flow_improvements.map((item: any, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-[13px] text-ink leading-snug"><CheckCircle2 className="w-3.5 h-3.5 text-info shrink-0 mt-0.5" />{item.recommendation}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ═══ 3b. MARKET BENCHMARK (deep only; absent on deals analysed before the feature) ═══ */}
      {hasDeepContent && shouldRenderBenchmark((pb as any)?.market_benchmark) && (
        <MarketBenchmark benchmark={(pb as any).market_benchmark} interpretation={(pb as any).benchmark_interpretation ?? null} fmt={fmtSav} locale={locale} showEyebrow={false} />
      )}

      {/* ═══ 3. EMAIL — Step 3. Rendered only once step 2 exists (trial keeps its teaser). ═══ */}
      {/* While TermLift runs the negotiation the self-serve email prep is not the next step; an email already generated stays visible. */}
      {(stepsUnlocked || !showFullPlaybook) && !(flowPhase === 'termlift' && !hasEmail) && (
      <section id="email-section" className="scroll-mt-[196px]">
        {!showFullPlaybook ? (
          <NegotiationTeaser negotiateHref={negotiateHref} locale={locale} redFlagCount={redFlagCount} potentialSavings={potentialSavings} fmtSav={fmtSav} icon={Mail} variant="email" />
        ) : (
          <>
            <IconHeading
              icon={Mail}
              tone="ink"
              eyebrow={sortedRounds.length > 1 ? (fr ? `Étape 3 · Tour ${sortedRounds.length}` : `Step 3 · Round ${sortedRounds.length}`) : (fr ? 'Étape 3 · Tour 1' : 'Step 3 · Round 1')}
              title={sortedRounds.length > 1 ? (fr ? `Tour ${sortedRounds.length} — Contre-proposition` : `Round ${sortedRounds.length} — Counter proposal`) : (fr ? 'Tour 1 — Ouverture de la négociation' : 'Round 1 — Initial negotiation')}
              sub={sortedRounds.length > 1
                ? (hasEmail ? (fr ? 'Ce que la réponse du fournisseur a changé, et la contre-proposition à envoyer.' : "What the vendor's reply changed, and the counter to send.") : (fr ? 'Ce que la réponse du fournisseur a changé. Générez votre contre-proposition ci-dessous.' : "What the vendor's reply changed. Generate your counter below."))
                : (hasEmail ? (fr ? 'L’e-mail d’ouverture, prêt à copier et envoyer.' : 'Your opening email, ready to copy and send.') : (fr ? 'TermLift connaît déjà le devis et la stratégie. Ajoutez ce que le document ne peut pas nous dire, puis générez l’e-mail.' : 'TermLift already knows the quote and the strategy. Add what the document can’t tell us, then generate the email.'))}
            />

            {/* Round 2+: the vendor's figure first, then what their reply changed. */}
            {sortedRounds.length > 1 && !demoMode && (() => {
              const latest = sortedRounds[0] as any
              const prev = sortedRounds[1] as any
              const prevFigure = prev
                ? (prev.vendor_offer?.amount != null
                  ? { amount: prev.vendor_offer.amount as number, currency: prev.vendor_offer.currency as string | null }
                  : { amount: (prev.extracted_data?.total_commitment?.amount as number | undefined) ?? (prev.output_json?.snapshot?.total_commitment ? parseMoney(String(prev.output_json.snapshot.total_commitment)).amount || null : null), currency: (prev.extracted_data?.total_commitment?.currency as string | undefined) ?? (prev.output_json?.snapshot?.currency as string | undefined) ?? null })
                : null
              // A recorded figure earns its own card; the "record it" prompt alone does not.
              return latest.vendor_offer?.amount != null ? (
                <Card className="mb-3 py-3">
                  <VendorOfferField roundId={latest.id} offer={latest.vendor_offer ?? null} previous={prevFigure} fr={fr} />
                </Card>
              ) : (
                <div className="mb-3 px-1">
                  <VendorOfferField roundId={latest.id} offer={latest.vendor_offer ?? null} previous={prevFigure} fr={fr} />
                </div>
              )
            })()}
            {sortedRounds.length > 1 && (o as any)?.round_delta && <RoundDeltaCard d={(o as any).round_delta as RoundDelta} fr={fr} />}

            {hasEmail && (
              <div className="rounded-[10px] border border-line bg-surface px-4 py-3 mb-3">
                <p className="tl-label text-ink-3 mb-1">{fr ? 'Approche recommandée' : 'Recommended approach'}</p>
                <p className="text-[13.5px] text-ink leading-relaxed">{TONE_APPROACH[toneOrder[recommendedIdx]][fr ? 'fr' : 'en']}</p>
              </div>
            )}

            {hasEmail && (
              <Card pad={false} className="mb-3">
                {/* Tone: the recommended variant is shown first; softer/firmer step through the three
                    variants already generated in the one call — no extra LLM request. */}
                <div className="px-5 py-3 border-b border-line flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-ink">{toneChipLabel(toneOrder[emailTab])}</span>
                  {emailTab === recommendedIdx && <Chip tone="green">{fr ? 'Recommandé' : 'Recommended'}</Chip>}
                  <span className="flex items-center gap-1 ml-1">
                    <button type="button" onClick={() => setEmailTab(Math.max(0, emailTab - 1))} disabled={emailTab === 0} className="h-[24px] px-2 rounded-md border border-line bg-surface text-[11.5px] font-semibold text-ink-2 hover:border-[#C9D3CE] disabled:opacity-40 disabled:cursor-not-allowed">{fr ? 'Plus doux' : 'Make softer'}</button>
                    <button type="button" onClick={() => setEmailTab(Math.min(toneOrder.length - 1, emailTab + 1))} disabled={emailTab === toneOrder.length - 1} className="h-[24px] px-2 rounded-md border border-line bg-surface text-[11.5px] font-semibold text-ink-2 hover:border-[#C9D3CE] disabled:opacity-40 disabled:cursor-not-allowed">{fr ? 'Plus ferme' : 'Make firmer'}</button>
                  </span>
                  {!demoMode && <span className="ml-auto text-[12px] text-ink-3">{remainingRegens > 0 ? (fr ? `${remainingRegens} régénération(s) restante(s)` : `${remainingRegens} regeneration${remainingRegens === 1 ? '' : 's'} left`) : (fr ? 'Limite atteinte' : 'Limit reached')}</span>}
                </div>
                <div className="px-5 py-3 border-b border-line flex items-center gap-2">
                  <span className="tl-label text-ink-3 shrink-0">{fr ? 'Objet' : 'Subject'}</span>
                  <input type="text" value={emailSubjects[emailTab]} onChange={(e) => { const n = [...emailSubjects]; n[emailTab] = e.target.value; setEmailSubjects(n) }} className="flex-1 min-w-0 text-[13.5px] font-semibold text-ink bg-transparent border-none focus:outline-none p-0" />
                </div>
                <textarea value={emailBodies[emailTab]} onChange={(e) => { const n = [...emailBodies]; n[emailTab] = e.target.value; setEmailBodies(n) }} rows={8} className="w-full min-h-[200px] field-sizing-content text-[13.5px] text-ink leading-[1.65] bg-surface px-5 py-4 border-0 resize-y focus:outline-none focus:bg-surface-2" />
                <div className="px-5 py-3 border-t border-line flex flex-wrap items-center gap-2">
                  <Btn variant="primary" size="sm" onClick={() => { setCopiedEmail(true); navigator.clipboard.writeText(emailBodies[emailTab]); setTimeout(() => setCopiedEmail(false), 2000) }}>{copiedEmail ? <><CheckCircle2 className="w-3.5 h-3.5" />{fr ? 'Copié' : 'Copied'}</> : <><Copy className="w-3.5 h-3.5" />{fr ? 'Copier l’e-mail' : 'Copy email'}</>}</Btn>
                  <Btn variant="ghost" size="sm" onClick={() => { window.location.href = `mailto:?subject=${encodeURIComponent(emailSubjects[emailTab])}&body=${encodeURIComponent(emailBodies[emailTab])}` }}><Send className="w-3.5 h-3.5" />{t('output.openInEmailClient')}</Btn>
                  {!demoMode && (
                    <Btn variant="ghost" size="sm" onClick={handleGenerate} disabled={regenerating || remainingRegens <= 0}>
                      {regenerating ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{fr ? 'Génération…' : 'Generating…'}</> : <><RotateCcw className="w-3.5 h-3.5" />{fr ? 'Régénérer' : 'Regenerate'}</>}
                    </Btn>
                  )}
                  <span className="text-[11.5px] text-ink-3 ml-auto">{fr ? 'Objet et corps modifiables' : 'Subject and body are editable'}</span>
                </div>
              </Card>
            )}

            {!demoMode && (
              <div className="flex flex-col gap-3">
                <button onClick={() => setShowEmailContext(!showEmailContext)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-2 hover:text-green-deep transition-colors self-start" aria-expanded={showEmailContext}>
                  <Plus className={cn('w-3.5 h-3.5 transition-transform', showEmailContext && 'rotate-45')} />
                  {hasEmail ? (fr ? 'Modifier le contexte de négociation' : 'Edit negotiation context') : (fr ? 'Préparez votre négociation' : 'Prepare your negotiation')}
                  {!showEmailContext && <span className="text-[11.5px] font-normal text-ink-3">— {fr ? 'facultatif' : 'optional'}</span>}
                </button>
                {showEmailContext && (
                  <Card className={cn('flex flex-col gap-3.5', PAD)}>
                    {!hasEmail && <p className="text-[12.5px] text-ink-2 -mt-1">{fr ? 'Tout est facultatif. Ce que vous renseignez ici est repris dans l’e-mail et conservé pour les tours suivants.' : 'Everything here is optional. What you add shapes the email and carries over to later rounds.'}</p>}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1"><span className="tl-label text-ink-3">{fr ? 'Objectif / résultat visé' : 'Target outcome'}</span><input type="text" value={negotiationObjective} onChange={(e) => setNegotiationObjective(e.target.value)} placeholder={fr ? 'ex. Obtenir 10 % de remise et supprimer le renouvellement auto' : 'e.g. Get 10% off and remove auto-renewal'} className={inputCls} /></label>
                      <label className="flex flex-col gap-1"><span className="tl-label text-ink-3">{fr ? 'Budget / prix maximum acceptable' : 'Budget / maximum acceptable price'}</span><input type="text" value={budgetCeiling} onChange={(e) => setBudgetCeiling(e.target.value)} placeholder={fr ? 'ex. Budget plafonné à 45 000 €' : 'e.g. Budget capped at €45,000'} className={inputCls} /></label>
                      <label className="flex flex-col gap-1"><span className="tl-label text-ink-3">{fr ? 'Devis concurrents / alternatives' : 'Competing quotes / alternatives'}</span><input type="text" value={competingQuote} onChange={(e) => setCompetingQuote(e.target.value)} placeholder={fr ? 'ex. Offre concurrente à 41 000 €' : 'e.g. We have a competing offer at €41,000'} className={inputCls} /></label>
                      <label className="flex flex-col gap-1"><span className="tl-label text-ink-3">{fr ? 'Échéance / urgence' : 'Deadline / urgency'}</span><input type="text" value={internalDeadline} onChange={(e) => setInternalDeadline(e.target.value)} placeholder={fr ? 'ex. Signer avant le 15 sept.' : 'e.g. Need to sign by Sept 15'} className={inputCls} /></label>
                    </div>
                    <div>
                      <p className="tl-label text-ink-3 mb-1.5">{fr ? 'Relation avec le fournisseur / marge de manœuvre' : 'Relationship considerations / walk-away flexibility'}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {([{ v: 'flexible', l: 'Flexible' }, { v: 'prefer_stay', l: fr ? 'Préfère rester' : 'Prefer to stay' }, { v: 'can_walk', l: fr ? 'Peut partir' : 'Can walk away' }] as const).map((opt) => (
                          <button key={opt.v} type="button" onClick={() => setWalkAwayFlexibility(walkAwayFlexibility === opt.v ? '' : opt.v)} className={cn('h-8 px-3 rounded-lg text-[12.5px] font-semibold border transition-colors', walkAwayFlexibility === opt.v ? 'bg-green-soft border-green-line text-green-deep' : 'bg-surface border-line text-ink-2 hover:border-[#C9D3CE]')} aria-pressed={walkAwayFlexibility === opt.v}>{opt.l}</button>
                        ))}
                      </div>
                    </div>
                    <label className="flex flex-col gap-1"><span className="tl-label text-ink-3">{fr ? 'Contexte supplémentaire' : 'Additional context'}</span><textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} rows={2} className={cn(inputCls, 'resize-none')} placeholder={fr ? 'ex. Mentionner que nous pouvons signer cette semaine si le prix est approuvé' : 'e.g. Mention that we can sign this week if pricing is approved'} /></label>
                  </Card>
                )}
                {/* The generate button is the primary only while no email exists (or a vendor reply awaits a counter);
                    once the round's email is on screen, regeneration lives in the email footer above. */}
                {(!hasEmail || showEmailContext) && (
                  <div className="flex flex-col gap-2">
                    <Btn variant={hasEmail ? 'ghost' : 'primary'} onClick={handleGenerate} disabled={regenerating || remainingRegens <= 0} className="self-start">
                      {regenerating ? <><Loader2 className="w-4 h-4 animate-spin" />{fr ? 'Génération…' : 'Generating…'}</> : hasEmail ? <><RotateCcw className="w-4 h-4" />{fr ? 'Régénérer avec ce contexte' : 'Regenerate with this context'}</> : <><Sparkles className="w-4 h-4" />{sortedRounds.length > 1 ? (fr ? `Générer la contre-proposition du tour ${sortedRounds.length}` : `Generate Round ${sortedRounds.length} counter`) : (fr ? 'Générer l’e-mail de négociation du tour 1' : 'Generate Round 1 negotiation email')}</>}
                    </Btn>
                    {remainingRegens <= 0 && <p className="text-[12px] text-ink-3">{fr ? 'Limite de régénération atteinte.' : 'Regeneration limit reached.'}</p>}
                  </div>
                )}
                {regenError && <p role="alert" className="text-[13px] text-risk bg-risk-soft border border-risk-line rounded-[10px] px-3.5 py-2.5">{regenError}</p>}
              </div>
            )}
            {demoMode && !hasEmail && <Btn href="/login?from=demo" variant="primary">{fr ? 'Inscrivez-vous pour générer' : 'Sign up to generate'} <ArrowRight className="w-3.5 h-3.5" /></Btn>}
          </>
        )}
      </section>
      )}

      {/* ═══ 4. ROUNDS — only once there is negotiation activity ═══ */}
      {hasNegotiationActivity && (
        <div id="rounds" className="grid grid-cols-1 gap-5 scroll-mt-[196px]">
          {hasNegotiationActivity && (
            <Card className={PAD}>
              <IconHeading icon={Clock} title={fr ? 'Tours de négociation' : 'Negotiation rounds'} />
              <ol className="m-0 p-0 list-none">
                {sortedRounds.slice().reverse().map((round: any) => {
                  const ro = round.output_json as any
                  const rTotal = ro?.snapshot?.total_commitment
                  const rFlags = ro?.red_flags?.length || 0
                  const rDate = round.created_at && !isNaN(new Date(round.created_at).getTime()) ? new Date(round.created_at).toLocaleDateString(fr ? 'fr-FR' : 'en-US', { month: 'short', day: 'numeric' }) : null
                  // What this round's offer moved from: the previous round's confirmed/inferred offer, else its structured total.
                  const prevRound = sortedRounds.find((r: any) => r.round_number === round.round_number - 1) as any
                  const prevFigure = prevRound
                    ? (prevRound.vendor_offer?.amount != null
                      ? { amount: prevRound.vendor_offer.amount as number, currency: prevRound.vendor_offer.currency as string | null }
                      : { amount: (prevRound.extracted_data?.total_commitment?.amount as number | undefined) ?? (prevRound.output_json?.snapshot?.total_commitment ? parseMoney(String(prevRound.output_json.snapshot.total_commitment)).amount || null : null), currency: (prevRound.extracted_data?.total_commitment?.currency as string | undefined) ?? (prevRound.output_json?.snapshot?.currency as string | undefined) ?? null })
                    : null
                  return (
                    <li key={round.id} className="grid grid-cols-[22px_1fr] gap-3 pb-4 relative">
                      <span className="w-[22px] h-[22px] rounded-full bg-green text-white tl-label text-[10px] grid place-items-center relative after:content-[''] after:absolute after:top-[22px] after:bottom-[-16px] after:left-[10px] after:w-0.5 after:bg-line">{round.round_number}</span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                        <p className="text-[13px] font-semibold text-ink">{fr ? `Tour ${round.round_number}` : `Round ${round.round_number}`}{round.round_number === 1 ? (fr ? ' — analyse initiale' : ' — initial analysis') : (fr ? ' — contre-proposition' : ' — counter proposal')}</p>
                        <p className="text-[12px] text-ink-3 tl-num">{[rDate, rTotal ? normalizeAmount(rTotal) : null, rFlags > 0 ? `${rFlags} ${fr ? 'point(s)' : 'flags'}` : null].filter(Boolean).join(' · ')}</p>
                        </div>
                        {ro?.round_delta?.headline && <p className="text-[12.5px] text-ink-2 mt-0.5 leading-snug">{ro.round_delta.headline}</p>}
                        {round.round_number > 1 && !demoMode && (
                          <VendorOfferField roundId={round.id} offer={round.vendor_offer ?? null} previous={prevFigure} fr={fr} />
                        )}
                      </div>
                    </li>
                  )
                })}
                {isClosed ? (
                  <li className="grid grid-cols-[22px_1fr] gap-3">
                    <span className="w-[22px] h-[22px] rounded-full bg-green text-white grid place-items-center"><CheckCircle2 className="w-3.5 h-3.5" /></span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-green-deep">{dealStatus === 'closed_won' ? (fr ? 'Dossier gagné' : 'Deal won') : (fr ? 'Dossier clôturé' : 'Deal closed')}</p>
                      <p className="text-[12px] text-ink-2 tl-num">{[closedAt ? new Date(closedAt).toLocaleDateString(fr ? 'fr-FR' : 'en-US', { month: 'short', day: 'numeric' }) : null, savingsAmount != null && savingsAmount > 0 ? `${fmtSav(savingsAmount)} ${fr ? 'économisés' : 'saved'}` : null, savingsPercent != null ? `${savingsPercent.toFixed(1)}%` : null].filter(Boolean).join(' · ')}</p>
                      {dealStatus === 'closed_won' && <Link href={`/app/deal/${dealId}/outcome`} className="inline-flex items-center min-h-[32px] mt-0.5 text-[12.5px] font-semibold text-green-deep hover:underline">{fr ? 'Voir le résultat complet →' : 'View full outcome →'}</Link>}
                    </div>
                  </li>
                ) : sortedRounds.length > 0 && (
                  <li className="grid grid-cols-[22px_1fr] gap-3">
                    <span className="w-[22px] h-[22px] rounded-full border-[1.5px] border-dashed border-line text-ink-3 tl-label text-[10px] grid place-items-center">{sortedRounds.length + 1}</span>
                    <div className="min-w-0">
                      {hasDeepContent && (anyRoundEmailed || revealAddRound || demoMode) ? (
                        <div id="add-round" className="scroll-mt-[196px]">
                          <p className="text-[13px] font-semibold text-ink">{fr ? `Tour ${sortedRounds.length + 1} — ajouter la réponse du fournisseur` : `Round ${sortedRounds.length + 1} — add the vendor's response`}</p>
                          <p className="text-[12px] text-ink-2">{fr ? 'Importez ou collez leur réponse. Nous relevons leur offre, ce qui a changé, et préparons votre contre-proposition.' : 'Upload or paste their reply. We pick out their offer, what changed, and prepare your counter.'}</p>
                          <div className="mt-2">{addRoundForm}</div>
                        </div>
                      ) : hasDeepContent ? (
                        <div id="add-round" className="scroll-mt-[196px]">
                          <p className="text-[13px] font-semibold text-ink">{fr ? `Tour ${sortedRounds.length + 1}` : `Round ${sortedRounds.length + 1}`}</p>
                          <p className="text-[12px] text-ink-2">{fr ? 'Envoyez d’abord l’e-mail du tour 1. ' : 'Send the Round 1 email first. '}<button type="button" onClick={() => setRevealAddRound(true)} className="font-semibold text-green-deep hover:underline">{fr ? 'Vous avez déjà une réponse du fournisseur ?' : 'Already have the vendor’s response?'}</button></p>
                        </div>
                      ) : (
                        <a id="add-round" href="#deep-analysis" className="block no-underline scroll-mt-[196px]">
                          <p className="text-[13px] font-semibold text-ink">{fr ? `Tour ${sortedRounds.length + 1}` : `Round ${sortedRounds.length + 1}`}</p>
                          <p className="text-[12px] text-ink-2">{fr ? 'Se débloque avec le Plan de négociation →' : 'Unlocks with the Negotiation Playbook →'}</p>
                        </a>
                      )}
                    </div>
                  </li>
                )}
              </ol>
            </Card>
          )}
        </div>
      )}

      {/* Footer line — the AI disclaimer belongs at the end of the page, not inside a card. */}
      {o?.disclaimer && <p className="text-[12px] text-ink-3 italic leading-relaxed text-center px-4">{o.disclaimer}</p>}
    </div>
  )
}

// ─── Deep analysis progress ─────────────────────────────────
// Staged progress for the deep-analysis call (~100-120s, one long LLM call —
// there's no intermediate backend event to key off, so this is a restrained
// time-based progression. The last stage holds with a spinner until the
// request actually completes; nothing is ever claimed done early.
function DeepAnalysisProgress({ locale }: { locale: 'en' | 'fr' }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const id = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 500)
    return () => clearInterval(id)
  }, [])

  const stages = locale === 'fr'
    ? [
        { label: 'Examen des conditions commerciales détaillées', at: 0 },
        { label: "Développement des opportunités de tarification et d'économies", at: 20 },
        { label: 'Construction de la stratégie de négociation', at: 45 },
        { label: 'Identification des concessions et points de vigilance', at: 75 },
        { label: "Finalisation de l'analyse détaillée", at: 95 },
      ]
    : [
        { label: 'Reviewing detailed commercial terms', at: 0 },
        { label: 'Expanding pricing & savings opportunities', at: 20 },
        { label: 'Building negotiation strategy', at: 45 },
        { label: 'Identifying concessions and watch-outs', at: 75 },
        { label: 'Finalizing detailed analysis', at: 95 },
      ]
  const currentIdx = stages.reduce((acc, s, i) => (elapsed >= s.at ? i : acc), 0)

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13.5px] font-semibold text-ink">{locale === 'fr' ? 'Construction de votre Plan de négociation' : 'Building your Negotiation Playbook'}</p>
        <span className="tl-label text-ink-3 tl-num">{elapsed}s</span>
      </div>
      <ul className="m-0 p-0 list-none flex flex-col gap-2">
        {stages.map((s, i) => {
          const done = i < currentIdx
          const active = i === currentIdx
          return (
            <li key={i} className="flex items-center gap-2.5">
              {done ? <CheckCircle2 className="w-4 h-4 text-green shrink-0" /> : active ? <Loader2 className="w-4 h-4 text-ink-2 animate-spin shrink-0" /> : <span className="w-4 h-4 rounded-full border-[1.5px] border-line shrink-0" />}
              <p className={cn('text-[12.5px]', active ? 'text-ink font-semibold' : 'text-ink-3')}>{s.label}</p>
            </li>
          )
        })}
      </ul>
      <p className="text-[11.5px] text-ink-3 mt-3 pt-3 border-t border-line-2 leading-relaxed">
        {locale === 'fr' ? "Cela prend généralement environ deux minutes. Vous pouvez continuer à consulter l'analyse pendant ce temps." : 'This usually takes about two minutes — keep reading the analysis while it runs.'}
      </p>
    </Card>
  )
}

// ─── Negotiation teaser — replaces the DIY playbook/email sections when the playbook is hidden ───
function NegotiationTeaser({ negotiateHref, locale, redFlagCount, potentialSavings, fmtSav, icon: Icon, variant = 'strategy' }: {
  negotiateHref: string
  locale: 'en' | 'fr'
  redFlagCount: number
  potentialSavings: number
  fmtSav: (n: number) => string
  icon: typeof Zap
  variant?: 'strategy' | 'email'
}) {
  const fr = locale === 'fr'
  const heading = variant === 'email'
    ? (fr ? 'Nous rédigeons et envoyons les e-mails' : 'We write and send the emails')
    : (fr ? 'La stratégie complète' : 'The full negotiation strategy')
  const body = variant === 'email'
    ? (fr ? "Une fois la négociation confiée à TermLift, l'envoi des e-mails fait partie du service." : 'Once TermLift takes this on, drafting and sending the negotiation emails is part of the service.')
    : (fr ? "Ce qu'il faut demander, votre levier et la séquence de négociation font partie de la négociation menée par TermLift." : 'What to ask for, your leverage, and the negotiation sequence are part of the negotiation TermLift runs on your behalf.')
  return (
    <div>
      <IconHeading icon={Icon} tone="ink" title={heading} sub={body} />
      <GateCard
        tone="neutral"
        title={fr ? 'Faire négocier ce dossier' : 'Get this deal negotiated'}
        body={<span className="flex flex-wrap gap-x-4 gap-y-1">{redFlagCount > 0 && <span className="inline-flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-warn" />{redFlagCount} {fr ? (redFlagCount === 1 ? 'levier identifié' : 'leviers identifiés') : (redFlagCount === 1 ? 'negotiation lever identified' : 'negotiation levers identified')}</span>}{potentialSavings > 0 && <span className="inline-flex items-center gap-1.5 text-green-deep font-semibold"><DollarSign className="w-3.5 h-3.5" />{fmtSav(potentialSavings)} {fr ? "d'économies potentielles" : 'in potential savings'}</span>}</span>}
        action={<Btn href={negotiateHref} variant="ink">{fr ? 'Faire négocier ce dossier' : 'Get this deal negotiated'} <ArrowRight className="w-3.5 h-3.5" /></Btn>}
      />
    </div>
  )
}
