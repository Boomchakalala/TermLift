import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { outputLocale } from '@/lib/output-language'
import { classifyQuote } from '@/lib/claude'
import { analyzeDealFacts } from '@/lib/claude/analyze'
import type { QuoteClassificationType } from '@/lib/schemas'
import { factsFromOutput, readPersistedExtract, renderExtractForModel } from '@/lib/quote-extract'
import { createTimer, logTimings, serverTimingHeader } from '@/lib/timings'
import { checkRateLimit } from '@/lib/rate-limit'
import { runWithAiContext } from '@/lib/ai-telemetry'
import { extractBenchmarkInput } from '@/lib/claude/benchmark-input'
import { benchmarkInputFromQuoteFacts, quoteFactsSufficient } from '@/lib/benchmark/from-quote-facts'
import { computeMarketBenchmark, type BenchmarkRun } from '@/lib/benchmark/service'
import { clampInterpretation } from '@/lib/benchmark/interpret'
import { toStructuredExtraction } from '@/lib/structured-extraction'
import type { BenchmarkInput } from '@/lib/benchmark/types'
import { getPlaybookAccess, consumeCredit } from '@/lib/billing'
import { deepAnalysisPriceLabel } from '@/lib/pricing'
import { analysisDate } from '@/lib/claude'
import { isUnreadableClassification, resolveClassification } from '@/lib/claude/classification-guard'
import { normalizeSavings } from '@/lib/savings-normalize'
import { attachPlaybookAsks, renderExistingFlagsForPrompt, type FlagRow } from '@/lib/playbook-flags'
import { filterSolidAgainstFlags, stripDeadlineLeverage, stripPastDated, stripLongerTermOffers, longerTermOptedIn } from '@/lib/playbook-hygiene'
import { enforceUpliftPolicy } from '@/lib/ask-policy'
import { attachTargetPrice } from '@/lib/deal-target'
import { isExpired, normalizeExtraction } from '@/lib/scoring'
import { parseMoney } from '@/lib/currency'

export const maxDuration = 120

// ─────────────────────────────────────────────────────────────────────────────
// Deep analysis — on-demand enrichment of an already-created deal's LATEST
// round, triggered explicitly from the deal page. Reuses analyzeDealFacts()
// (the original, untouched, full-depth analysis call) rather than rebuilding
// anything. Reconstructs its inputs from what's already persisted:
//   - ExtractedFacts  <- output_json.extract (the persisted extract, 2026-09-11),
//                        else the slim rebuild from snapshot/vendor/category
//   - classification  <- output_json.classification if present, else one
//                         fresh classifyQuote() call (cheap Haiku, ~2s — not
//                         worth a bigger change to avoid)
//   - document view    <- the rendered extract (lines, totals, dates, verbatim
//                          term clauses). The full quote text is read ONLY for
//                          rounds analysed before extracts were persisted; the
//                          file itself is never sent again.
// Never resends/reprocesses the document.
// ─────────────────────────────────────────────────────────────────────────────

/** Build state of the latest round: 'idle' | 'running' | 'done'. Lets the client recover a run whose response it lost. */
export async function GET(_request: Request, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: round } = await supabase
    .from('rounds')
    .select('output_json')
    .eq('deal_id', dealId)
    .eq('user_id', user.id)
    .order('round_number', { ascending: false })
    .limit(1)
    .single()
  if (!round) return NextResponse.json({ error: 'No analysis found for this deal' }, { status: 404 })
  const status = (round.output_json as { deep_analysis_status?: string } | null)?.deep_analysis_status || 'idle'
  return NextResponse.json({ status })
}

export async function POST(request: Request, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Deep Analysis is a long, expensive Sonnet call — reuse the same hourly/daily
    // rate-limit budget as any other analysis action rather than leaving it unbounded.
    // A failed run reverts deep_analysis_status to 'idle' (see catch block
    // below), so without this check a bad document could be retried
    // indefinitely, each retry burning a fresh expensive call.
    const { data: limitProfile } = await supabase.from('profiles').select('is_admin, negotiation_preferences').eq('id', user.id).single()
    if (!limitProfile?.is_admin) {
      const rateLimit = await checkRateLimit(user.id)
      if (!rateLimit.allowed) {
        return NextResponse.json({ error: rateLimit.message || 'Rate limit exceeded' }, { status: 429 })
      }
    }

    // Price gate (lib/billing-rules.ts): free during early access, first Playbook free,
    // otherwise paid for this deal or covered by a credit bought from the new-deal gate.
    const access = await getPlaybookAccess(user.id, dealId, !!limitProfile?.is_admin)
    if (!access.granted) {
      return NextResponse.json({
        error: `The Negotiation Playbook is ${deepAnalysisPriceLabel()} for this deal.`,
        paymentRequired: true,
        price: access.priceEur,
      }, { status: 402 })
    }
    if (access.kind === 'credit') await consumeCredit(user.id, dealId)

    const { data: deal } = await supabase
      .from('deals')
      .select('id, deal_type')
      .eq('id', dealId)
      .eq('user_id', user.id)
      .single()
    if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

    const { data: round } = await supabase
      .from('rounds')
      .select('id, output_json, extracted_text, extracted_text_purged_at')
      .eq('deal_id', dealId)
      .eq('user_id', user.id)
      .order('round_number', { ascending: false })
      .limit(1)
      .single()
    if (!round) return NextResponse.json({ error: 'No analysis found for this deal' }, { status: 404 })

    const output = round.output_json as any

    // Already done — reuse, no LLM call. Satisfies "don't regenerate every time."
    if (output?.deep_analysis_status === 'done') {
      return NextResponse.json({ status: 'done', output })
    }
    // Already in flight (duplicate click, another tab) — don't start a second one.
    if (output?.deep_analysis_status === 'running') {
      return NextResponse.json({ error: 'The Negotiation Playbook is already being built for this deal.' }, { status: 409 })
    }

    // The document view for the model: the persisted extract, rendered. Only a
    // round from before extracts existed falls back to its stored quote text.
    const persistedExtract = readPersistedExtract(output)
    const docForModel: string | null = persistedExtract ? renderExtractForModel(persistedExtract) : (round.extracted_text as string | null)
    if (persistedExtract) console.log(`[TermLift] Playbook reads the persisted extract (${docForModel!.length} chars), not the quote text`)
    else console.warn('[TermLift] Playbook: no persisted extract on this round (pre-2026-09-11); reading the stored quote text')
    if (!docForModel) {
      // Either a legacy deal analysed before the quote text was kept, or the text was
      // removed under the retention policy (closed deal, or older than the maximum age).
      // There is no re-upload on an existing deal — the way forward is a new analysis.
      const purged = !!round.extracted_text_purged_at
      return NextResponse.json({
        error: purged
          ? 'The quote text for this deal was removed under our retention policy, so the Negotiation Playbook can’t be built on it. Start a new analysis with the same quote to unlock it.'
          : 'We couldn’t read the text of this quote when it was analysed (the file may be image-only), so the Negotiation Playbook can’t be built on it. Start a new analysis: paste the quote text, or upload the document again.',
      }, { status: 422 })
    }

    // Best-effort duplicate-click guard: mark running before the (slow) call
    // starts. Not a hard lock, but combined with the client disabling the
    // button on click, sufficient for this low-traffic, single-user action.
    await supabase
      .from('rounds')
      .update({ output_json: { ...output, deep_analysis_status: 'running' } })
      .eq('id', round.id)
      .eq('user_id', user.id)

    const timer = createTimer()
    try {
      // The verified facts the Playbook prompt receives: the full persisted extract
      // (line items, dates, renewal mechanics, term clauses) when the round has one.
      // Copied: the stored extract keeps what the document printed; only the prompt copy follows the chosen type.
      const facts = { ...factsFromOutput(output, deal.deal_type) }
      // The snapshot's deal type is the deal's CHOSEN type (form / inference / switch).
      facts.deal_type = output.snapshot?.deal_type || facts.deal_type || deal.deal_type

      // Generated in the language the deal already speaks, whatever the UI cookie says now.
      const locale = outputLocale(output)

      const deepStart = Date.now()
      const asOf = analysisDate()
      const contractTotal = parseMoney(facts.total_commitment).amount
      const quickFlags: FlagRow[] = Array.isArray(output.red_flags) ? output.red_flags : []
      const { classification, deep, benchmarkInput, benchmarkRun } = await runWithAiContext({ userId: user.id, dealId, roundId: round.id }, async () => {
        // A stored classification that could not read the document (the old blank-prompt
        // PDF path) is not reused: classify again from the text, then guard the result.
        const stored: QuoteClassificationType | undefined = output.classification && !isUnreadableClassification(output.classification) ? output.classification : undefined
        const fresh = stored || await classifyQuote(docForModel, deal.deal_type as 'New' | 'Renewal')
        const classification: QuoteClassificationType = resolveClassification(fresh, facts, deal.deal_type as 'New' | 'Renewal', contractTotal).classification

        // ── Market Benchmark (optional, never blocks Deep Analysis) ──────────
        // 1. small fact-extraction call for product/quantity/unit price
        // 2. deterministic engine over stored observations (no LLM)
        // Any failure here is logged and Deep Analysis proceeds without a benchmark.
        let benchmarkInput: BenchmarkInput | null = null
        let benchmarkRun: BenchmarkRun | null = null
        // Quote facts validated at analysis time come first — no extra call.
        // The Haiku extractor runs only when they lack the numbers it would add.
        const benchStart = Date.now()
        benchmarkInput = benchmarkInputFromQuoteFacts(output.quote_facts)
        if (!quoteFactsSufficient(output.quote_facts)) {
          try {
            const fallback = await extractBenchmarkInput(docForModel, output.snapshot || {})
            benchmarkInput = benchmarkInput
              ? { ...fallback, quantity: benchmarkInput.quantity ?? fallback.quantity, unit_price: benchmarkInput.unit_price ?? fallback.unit_price, unit_price_period: benchmarkInput.unit_price ? benchmarkInput.unit_price_period : fallback.unit_price_period, term_months: benchmarkInput.term_months ?? fallback.term_months, list_unit_price: benchmarkInput.list_unit_price ?? fallback.list_unit_price, pricing_metric: benchmarkInput.pricing_metric ?? fallback.pricing_metric, extraction_notes: [benchmarkInput.extraction_notes, fallback.extraction_notes].filter(Boolean).join(' · ') }
              : fallback
          } catch (e) {
            console.warn('[TermLift] Benchmark input extraction failed (continuing without):', e instanceof Error ? e.message : e)
          }
        }
        try {
          benchmarkRun = await computeMarketBenchmark({
            vendor: output.vendor,
            snapshot: output.snapshot || {},
            category: classification?.quote_type ?? null,
            deal_size_bracket: classification?.deal_size_bracket ?? null,
            dealType: deal.deal_type,
          }, benchmarkInput)
        } catch (e) {
          console.warn('[TermLift] Market benchmark failed (continuing without):', e instanceof Error ? e.message : e)
        }
        timer.mark('benchmark_ms', Date.now() - benchStart)

        // The quick analysis's flags are final: the Playbook fills each one's ask and fallback, nothing else.
        const deep = await timer.time('flags_ms', () => analyzeDealFacts(facts, classification, docForModel, {
          dealType: deal.deal_type as 'New' | 'Renewal',
          userLocale: locale,
          marketBenchmark: benchmarkRun?.result,
          asOf,
          existingFlagsBlock: renderExistingFlagsForPrompt(quickFlags),
        }))
        return { classification, deep, benchmarkInput, benchmarkRun }
      })
      console.log(`[TermLift timing] Deep analysis (analyzeDealFacts): ${Date.now() - deepStart}ms`)
      const assembleStart = Date.now()

      // The model's benchmark commentary is clamped into the engine's evidence band —
      // it can explain the numbers, never move them.
      const benchmark_interpretation = benchmarkRun ? clampInterpretation(deep.benchmark_interpretation, benchmarkRun.result) : null

      // ── Flags and score are FINAL from the quick analysis (2026-09-11) ──────
      // No flagger runs here and nothing is rescored: the Playbook attaches its
      // ask and fallback to each existing flag row (same rows, same order, same
      // severity) and brings the asks, target, savings and strategy.
      const quickExtraction = normalizeExtraction(output.extraction, contractTotal)
      const quoteExpired = output.quote_expired === true || isExpired(quickExtraction.quoteDates?.expires, asOf)
      const attached = attachPlaybookAsks(quickFlags, deep.red_flags)
      console.log(`[TermLift] Playbook flags: ${quickFlags.length} kept, ${attached.enriched} enriched, ${attached.unmatched} model rows dropped`)
      const normalizedSavings = normalizeSavings(deep.potential_savings, contractTotal, output.quote_facts?.lines ?? null, asOf) ?? deep.potential_savings
      // Uplift cap policy (lib/ask-policy.ts): no proposed cap above 4%, never above the vendor's stated minimum. Rewrites ask text only; never a row.
      const policed = enforceUpliftPolicy({ red_flags: attached.flags, what_to_ask_for: deep.what_to_ask_for, potential_savings: normalizedSavings }, quickExtraction.renewalTerms)
      if (policed.rewrites.length) console.log('[TermLift] Deep: uplift policy rewrites:', policed.rewrites.join(' | '))
      const policedFlags = policed.output.red_flags as typeof attached.flags
      const policedAsks = policed.output.what_to_ask_for as typeof deep.what_to_ask_for
      const potentialSavings = policed.output.potential_savings
      // Past-dated concessions are dead; a longer term is only offered when the person opted in.
      const optedLonger = longerTermOptedIn((limitProfile as { negotiation_preferences?: { contract_term_strategy?: string } } | null)?.negotiation_preferences)
      const hygienicAsks = {
        must_have: stripLongerTermOffers(stripPastDated(policedAsks?.must_have, asOf).kept, optedLonger).kept,
        nice_to_have: stripLongerTermOffers(stripPastDated(policedAsks?.nice_to_have, asOf).kept, optedLonger).kept,
      }
      const trades = stripLongerTermOffers(stripPastDated(deep.negotiation_plan?.trades_you_can_offer, asOf).kept, optedLonger).kept
      const solid = filterSolidAgainstFlags(deep.quick_read?.whats_solid, policedFlags, hygienicAsks.must_have)
      let leverage = stripPastDated(deep.negotiation_plan?.leverage_you_have, asOf).kept
      if (quoteExpired) leverage = stripDeadlineLeverage(leverage).kept
      // Enrich, don't overwrite the headline facts: verdict/verdict_type/title/
      // snapshot/vendor/category/description stay as the fast pass set them, and
      // so do score / score_breakdown / deductions / extraction (never recomputed here).
      const mergedRaw = {
        generated_locale: locale,
        ...output,
        quick_read: { ...deep.quick_read, whats_solid: solid.kept },
        red_flags: policedFlags,
        negotiation_plan: { ...deep.negotiation_plan, leverage_you_have: leverage, trades_you_can_offer: trades },
        what_to_ask_for: hygienicAsks,
        potential_savings: potentialSavings,
        cash_flow_improvements: deep.cash_flow_improvements,
        watchItems: deep.watchItems,
        assumptions: deep.assumptions,
        price_insight: deep.price_insight,
        quick_score: typeof output.score === 'number' ? output.score : null,
        analysis_date: output.analysis_date ?? asOf,
        quote_expired: quoteExpired,
        classification,
        // Market Benchmark — deterministic result + the query that produced it (reproducible),
        // plus the clamped model commentary. All absent when the step was skipped/failed.
        ...(benchmarkInput ? { benchmark_input: benchmarkInput } : {}),
        ...(benchmarkRun ? { market_benchmark: benchmarkRun.result, market_benchmark_query: benchmarkRun.query } : {}),
        ...(benchmark_interpretation ? { benchmark_interpretation } : {}),
        deep_analysis_status: 'done',
        deep_analysis_completed_at: new Date().toISOString(),
      }
      // Recompute the single stored target on the Playbook's asks (or the benchmark target).
      const merged = attachTargetPrice(mergedRaw, contractTotal)
      timer.mark('assemble_ms', Date.now() - assembleStart)
      const dbStart = Date.now()

      // Deep Analysis was the last reader of the raw quote text. Structured
      // facts (quote_facts, extracted_data, snapshot) carry everything later
      // steps need, so the text goes in the same write that records success —
      // never before it (a failed run keeps the text and can be retried).
      const { error: updateError } = await supabase
        .from('rounds')
        .update({
          output_json: merged,
          extracted_data: toStructuredExtraction(merged),
          extracted_text: null,
          extracted_text_purged_at: new Date().toISOString(),
        })
        .eq('id', round.id)
        .eq('user_id', user.id)
      if (updateError) throw new Error('Failed to save deep analysis')
      timer.mark('db_ms', Date.now() - dbStart)
      const timings = timer.done()
      logTimings(`deep-analysis deal=${dealId}`, timings)

      return NextResponse.json({ status: 'done', output: merged, timings }, { headers: { 'Server-Timing': serverTimingHeader(timings) } })
    } catch (innerError) {
      // Deep analysis failed — revert the status flag so the fast analysis
      // (everything else in output_json, untouched above) stays fully usable
      // and the user can retry, rather than getting stuck on "running" forever.
      await supabase
        .from('rounds')
        .update({ output_json: { ...output, deep_analysis_status: 'idle' } })
        .eq('id', round.id)
        .eq('user_id', user.id)
      throw innerError
    }
  } catch (error) {
    console.error('[TermLift] Deep analysis error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Building the Negotiation Playbook failed. Please try again.' }, { status: 500 })
  }
}
