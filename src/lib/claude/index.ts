/**
 * Claude AI Pipeline — v2 architecture
 *
 * 1. Classify the quote type (Haiku, fast) — from the extracted TEXT, never a blank prompt
 * 2. Extract facts into rigid schema (Haiku — the ONLY call that reads the document)
 * 3. Code checks on the facts (total, line sums, unit price, renewal fields, dates)
 * 4. Fast AI analysis for judgment calls (verdict, flags, asks, savings)
 * 5. Code: rule flags on the renewal/date fields, savings normalisation,
 *    playbook hygiene, deterministic score
 *
 * Same document = same extraction = same code flags = same score.
 * AI only handles what code can't: market judgment, writing, strategy.
 *
 * 2026-09-11 perf split — the pipeline is two phases the routes can run in
 * separate requests:
 *   prepareExtract()      steps 1-3, produces the extract that is persisted on the round
 *   buildSnapshotOutput() the output_json a deal can already render (snapshot, expiry)
 *   analyzeFromExtract()  steps 4-5 from that extract + the stored text (no document)
 * analyzeDeal() runs both back to back for callers that still want one call
 * (vendor-reply rounds, the anonymous trial).
 */

export { CLAUDE_MODEL_ID, getLanguageInstruction, type ClaudeUserContent } from './client'
export { classifyQuote } from './classify'
export { extractFinancialFacts, type ExtractedFacts } from './extract'
export { analyzeDealFacts, type AnalysisOutput } from './analyze'
export { analyzeFastCore, type FastAnalysisOutput } from './fast-analyze'
export { generateEmailDrafts, regenerateEmailDrafts, generateEmailV2, KEVIN_SYSTEM_PROMPT, EMAIL_RULES } from './emails'
export { calculateQuoteScore, parseMoneyAmount } from './score'
export { validateTotalCommitment } from './validate-total'
export { extractRigid, generateDocumentHash, rigidToLegacyFacts, type RigidExtraction } from './extract-rigid'
export { detectRedFlags, type CodeRedFlag } from './red-flags'
export { calculateDeterministicScore } from './score-deterministic'

import { classifyQuote } from './classify'
import { extractFinancialFacts, type ExtractedFacts } from './extract'
import { analyzeFastCore } from './fast-analyze'
import { validateTotalCommitment } from './validate-total'
import { resolveClassification } from './classification-guard'
import { detectCodeFlags, mergeCodeFlags } from './code-flags'
import { CLAUDE_EXTRACT_MODEL } from './client'
import { buildQuoteFacts, reconcileTotalWithLines, type QuoteFacts } from '@/lib/quote-facts'
import { buildPersistedExtract, readPersistedExtract, type PersistedExtract } from '@/lib/quote-extract'
import { normalizeSavings } from '@/lib/savings-normalize'
import { filterSolidAgainstFlags, stripDeadlineLeverage, stripPastDated, stripLongerTermOffers, longerTermOptedIn } from '@/lib/playbook-hygiene'
import { enforceUpliftPolicy } from '@/lib/ask-policy'
import { attachTargetPrice } from '@/lib/deal-target'
import { createTimer, type Timer } from '@/lib/timings'
import { DealOutputSchema, type DealOutputType, type QuoteClassificationType } from '../schemas'
import { computeScores, countHighTermsFlags, isExpired, normalizeExtraction, scoreLabel, seedFromFacts } from '../scoring'
import { parseMoney, normalizeAmount } from '../currency'
import type { DealOutput } from '@/types'
import { ANALYSIS_PIPELINE_V3 } from '../analysis/flag'
import { runFullAnalysisPipelineV3 } from '../analysis/full-pipeline'

/** Server date as `YYYY-MM-DD` — the one clock the pipeline reads. */
export function analysisDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export type DealType = 'New' | 'Renewal'
export type UserPreferences = { payment_terms?: string; top_priority?: string; auto_renewal?: string; contract_term_strategy?: string }

/** Everything steps 1-3 established about the document; persisted (via `extract`) so later steps never re-read the file. */
export interface PreparedExtract {
  classification: QuoteClassificationType
  classificationSource: 'model' | 'facts_fallback'
  /** Validated facts (total normalised/reconciled). Same object as `extract.facts`. */
  rawFacts: ExtractedFacts
  quoteFacts: QuoteFacts
  contractTotal: number
  extract: PersistedExtract
}

export interface PrepareExtractInput {
  extractedText: string
  dealType: DealType
  imageData?: { base64: string; mimeType: string }
  allPages?: Array<{ base64: string; mimeType: string }>
  pdfData?: { base64: string; mimeType: string }
  /** Result of an earlier /api/deal/extract-preview call — reused, never re-derived. */
  precomputed?: { classification: QuoteClassificationType; rawFacts: ExtractedFacts }
  /** Text the classifier reads when the quote arrived as a file (pdf-parse / OCR / transcription). */
  textForClassification?: string
  timer?: Timer
}

/**
 * Steps 1-3: classify + extract (the only model calls that see the document),
 * then the code checks on the facts. Reuses a precomputed preview result when
 * the client already ran it.
 */
export async function prepareExtract(input: PrepareExtractInput): Promise<PreparedExtract> {
  const { extractedText, dealType, imageData, allPages, pdfData, precomputed, textForClassification } = input
  const timer = input.timer ?? createTimer()
  let classification: QuoteClassificationType
  let rawFacts: ExtractedFacts
  if (precomputed) {
    console.log('[TermLift] Steps 0+1: Reusing precomputed classify+extract from extract-preview')
    classification = precomputed.classification
    rawFacts = { ...precomputed.rawFacts }
    timer.mark('extract_ms', 0)
  } else {
    console.log('[TermLift] Steps 0+1: Classifying + extracting facts (parallel)...')
    const classifyText = (textForClassification && textForClassification.trim().length >= 10 ? textForClassification : extractedText) || ''
    ;[classification, rawFacts] = await timer.time('extract_ms', () => Promise.all([
      classifyQuote(classifyText, dealType, imageData, allPages, pdfData),
      extractFinancialFacts(extractedText, dealType, imageData, allPages, pdfData),
    ]))
    console.log(`[TermLift timing] Steps 0+1 (classify+extract, parallel): ${timer.t.extract_ms}ms`)
  }
  console.log('[TermLift] Steps 0+1 done:', classification.quote_type, classification.deal_size_bracket, '|', rawFacts.vendor, rawFacts.total_commitment)

  // ─── Step 1a: Normalize total_commitment ───
  rawFacts.total_commitment = normalizeAmount(rawFacts.total_commitment)
  console.log('[TermLift] Step 1a: Normalized total:', rawFacts.total_commitment)

  // ─── Step 1b: Code-validate total_commitment ───
  const validation = validateTotalCommitment(rawFacts.total_commitment, extractedText)
  if (validation.wasOverridden) {
    rawFacts.total_commitment = validation.total
    console.log('[TermLift] Step 1b: Total overridden to:', validation.total)
  }
  // ─── Step 1c: Cross-check the total against printed line totals ───
  // Overrides only when the document itself prints the line sum as a total; otherwise records the discrepancy.
  const lineCheck = reconcileTotalWithLines(rawFacts.total_commitment, rawFacts.printed_line_totals, extractedText || textForClassification)
  if (lineCheck.corrected) {
    rawFacts.total_commitment = lineCheck.total
    console.warn('[TermLift] Step 1c: Total corrected from printed line totals:', lineCheck.note)
  } else if (lineCheck.note) {
    console.warn('[TermLift] Step 1c:', lineCheck.note)
  }
  // Validated structured facts — the only place quantity / unit price / list price are trusted.
  const quoteFacts = buildQuoteFacts(rawFacts)
  if (lineCheck.note) quoteFacts.notes.push(lineCheck.note)
  if (lineCheck.corrected) quoteFacts.checks.total = 'corrected'

  // ─── Step 1d: Classification guard ───
  // A classification that says it could not read the document is rejected and
  // rebuilt from the extraction's own facts (category, term, pricing model, total).
  const contractTotal = parseMoney(rawFacts.total_commitment).amount
  const resolved = resolveClassification(classification, rawFacts, dealType, contractTotal)
  if (resolved.replaced) console.warn('[TermLift] Step 1d: classifier could not read the document; classification rebuilt from facts:', resolved.classification.quote_type, resolved.classification.savings_strategy.target_percent_min + '-' + resolved.classification.savings_strategy.target_percent_max + '%')

  const extract = buildPersistedExtract(rawFacts, CLAUDE_EXTRACT_MODEL)
  return {
    classification: resolved.classification,
    classificationSource: resolved.replaced ? 'facts_fallback' : 'model',
    rawFacts: extract.facts,
    quoteFacts,
    contractTotal,
    extract,
  }
}

/** Rebuild the prepared extract from a round's stored output (no model call). Null when the round predates persisted extracts. */
export function preparedFromOutput(output: unknown, dealType: DealType): PreparedExtract | null {
  const extract = readPersistedExtract(output)
  if (!extract) return null
  const o = output as { classification?: QuoteClassificationType; classification_source?: string; quote_facts?: QuoteFacts }
  const rawFacts = extract.facts
  const contractTotal = parseMoney(rawFacts.total_commitment).amount
  const resolved = resolveClassification(o.classification, rawFacts, dealType, contractTotal)
  return {
    classification: resolved.classification,
    classificationSource: o.classification_source === 'facts_fallback' || resolved.replaced ? 'facts_fallback' : 'model',
    rawFacts,
    quoteFacts: o.quote_facts ?? buildQuoteFacts(rawFacts),
    contractTotal,
    extract,
  }
}

function snapshotFromFacts(rawFacts: ExtractedFacts) {
  return {
    vendor_product: rawFacts.vendor_product,
    term: rawFacts.term,
    total_commitment: rawFacts.total_commitment,
    currency: rawFacts.currency,
    billing_payment: rawFacts.billing_payment,
    pricing_model: rawFacts.pricing_model,
    deal_type: rawFacts.deal_type,
    renewal_date: rawFacts.renewal_date,
    signing_deadline: rawFacts.signing_deadline,
    quote_number: rawFacts.quote_number,
    quote_created: rawFacts.quote_created,
    quote_expires: rawFacts.quote_expires ?? rawFacts.signing_deadline,
    current_sub_end: rawFacts.current_sub_end,
  }
}

function mechanicalTitle(vendor: string, dealType: DealType): string {
  const monthYear = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  return `${vendor} | ${dealType === 'New' ? 'New Purchase' : 'Renewal'} | ${monthYear}`
}

/**
 * Phase 1 output: what the deal page can render as soon as the extract exists
 * (vendor, total, term, billing, deal type, expiry) — flags, score and asks
 * arrive when analyzeFromExtract() completes. `analysis_status: 'pending'` is
 * the signal; every later consumer keeps the fields it sets here.
 */
export function buildSnapshotOutput(prepared: PreparedExtract, options: { dealType: DealType; asOf?: string }): Record<string, unknown> {
  const asOf = options.asOf ?? analysisDate()
  const { rawFacts } = prepared
  const extraction = seedFromFacts(normalizeExtraction(undefined, prepared.contractTotal), rawFacts)
  const quoteExpired = isExpired(extraction.quoteDates?.expires, asOf)
  const snapshot = snapshotFromFacts(rawFacts)
  snapshot.total_commitment = normalizeAmount(snapshot.total_commitment)
  return {
    vendor: rawFacts.vendor,
    category: rawFacts.category,
    description: rawFacts.description,
    snapshot,
    title: mechanicalTitle(rawFacts.vendor, options.dealType),
    contact_name: rawFacts.contact_name,
    red_flags: [],
    what_to_ask_for: { must_have: [], nice_to_have: [] },
    negotiation_plan: { leverage_you_have: [], trades_you_can_offer: [] },
    assumptions: [],
    extraction,
    classification: prepared.classification,
    classification_source: prepared.classificationSource,
    quote_facts: prepared.quoteFacts,
    extract: prepared.extract,
    analysis_date: asOf,
    quote_expired: quoteExpired,
    deal_type_evidence: rawFacts.deal_type_evidence || [],
    deep_analysis_status: 'idle' as const,
    analysis_status: 'pending' as const,
  }
}

export interface AnalyzeFromExtractOptions {
  dealType: DealType
  goal?: string
  notes?: string
  previousRoundOutput?: DealOutput
  userLocale?: string
  userPreferences?: UserPreferences
  timer?: Timer
  asOf?: string
}

/**
 * Steps 4-5: the judgment call (verdict, flags, asks, savings) on the extract
 * and the stored text, then the deterministic rules and score. The document is
 * never attached here — `rawText` is the persisted quote text (may be empty).
 */
export async function analyzeFromExtract(prepared: PreparedExtract, rawText: string, options: AnalyzeFromExtractOptions): Promise<DealOutputType> {
  const timer = options.timer ?? createTimer()
  const asOf = options.asOf ?? analysisDate()
  const { rawFacts, classification, quoteFacts, contractTotal } = prepared
  const { dealType, goal, notes, previousRoundOutput, userLocale, userPreferences } = options
  try {
    // ─── Step 2: FAST core analysis ───
    // Deliberately trimmed sibling of analyzeDealFacts() (see fast-analyze.ts) —
    // 3-5 highest-value red flags instead of up to 10, no full negotiation
    // strategy, no cash-flow analysis, no watch items. Reads the verified facts
    // (line items and verbatim term clauses included) plus the stored text.
    console.log('[TermLift] Step 2: Fast core analysis...')
    if (!rawText) console.warn('[TermLift] Step 2: no stored quote text; the flags call reads the extract only')
    const analysis = await timer.time('flags_ms', () => analyzeFastCore(rawFacts, classification, rawText, {
      dealType,
      goal,
      notes,
      previousRoundOutput,
      userLocale,
      userPreferences,
      asOf,
    }))
    console.log(`[TermLift timing] Step 2 (fast core analysis): ${timer.t.flags_ms}ms`)
    console.log('[TermLift] Step 2 done:', analysis.verdict_type, '|', analysis.red_flags?.length, 'flags | extraction:', analysis.extraction ? 'yes' : 'missing')

    const assembleStart = Date.now()
    // ─── Step 2a: Structured extraction, seeded from the extraction call's own fields ───
    const extraction = seedFromFacts(normalizeExtraction(analysis.extraction, contractTotal), rawFacts)
    const quoteExpired = isExpired(extraction.quoteDates?.expires, asOf)

    // ─── Step 2b: Rule flags on the renewal / date fields, merged with the model's ───
    const codeFlags = detectCodeFlags(extraction, asOf, rawFacts.total_commitment)
    const redFlags = mergeCodeFlags(analysis.red_flags || [], codeFlags)
    if (codeFlags.length) console.log('[TermLift] Step 2b: code flags:', codeFlags.map((f) => f.source_rule).join(', '))

    // ─── Step 2c: Savings normalisation (conditional asks unquantified, headline % net of line asks) ───
    const potentialSavings = normalizeSavings(analysis.potential_savings, contractTotal, quoteFacts.lines, asOf) ?? analysis.potential_savings
    if (potentialSavings && contractTotal > 0 && (potentialSavings as { total?: number }).total! > contractTotal) {
      console.warn(`[TermLift] GUARD: savings (${(potentialSavings as { total?: number }).total}) > total (${contractTotal}).`)
    }

    // ─── Step 2d: Playbook hygiene ───
    // Uplift cap policy: any proposed cap above the ceiling (4%, never above the vendor's stated minimum) is rewritten.
    const policed = enforceUpliftPolicy({ red_flags: redFlags, what_to_ask_for: analysis.what_to_ask_for, potential_savings: potentialSavings }, extraction.renewalTerms)
    if (policed.rewrites.length) console.log('[TermLift] Step 2d: uplift policy rewrites:', policed.rewrites.join(' | '))
    const policedFlags = policed.output.red_flags as typeof redFlags
    const policedAsks = policed.output.what_to_ask_for as typeof analysis.what_to_ask_for
    const policedSavings = policed.output.potential_savings
    // Concessions and asks that hinge on a date already behind today are dead; a longer term is only offered when the person opted in.
    const optedLonger = longerTermOptedIn(userPreferences)
    const hygienicAsks = {
      must_have: stripLongerTermOffers(stripPastDated(policedAsks?.must_have, asOf).kept, optedLonger).kept,
      nice_to_have: stripLongerTermOffers(stripPastDated(policedAsks?.nice_to_have, asOf).kept, optedLonger).kept,
    }
    const trades = stripLongerTermOffers(stripPastDated(analysis.negotiation_plan?.trades_you_can_offer, asOf).kept, optedLonger).kept
    const mustHave = hygienicAsks.must_have
    const solid = filterSolidAgainstFlags(analysis.quick_read?.whats_solid, policedFlags, mustHave)
    if (solid.dropped.length) console.log('[TermLift] Step 2d: dropped "solid" bullets that contradict a flag/ask:', solid.dropped.map((d) => d.bullet).join(' | '))
    let leverage = stripPastDated(analysis.negotiation_plan?.leverage_you_have, asOf).kept
    if (quoteExpired) {
      const stripped = stripDeadlineLeverage(leverage)
      leverage = stripped.kept
      if (stripped.dropped.length) console.log('[TermLift] Step 2d: quote expired; dropped deadline leverage:', stripped.dropped.join(' | '))
    }

    // ─── Step 3: Assemble output ───
    // Email generation no longer happens here — it blocked initial display
    // for ~20s to produce content most users don't read immediately.
    // email_drafts is left absent; DealScrollView.tsx already renders a
    // "Generate email" CTA when it's missing, wired to the existing
    // /api/deal/regenerate-emails route (which needs no pre-existing draft).
    const assembled: any = {
      vendor: rawFacts.vendor,
      category: rawFacts.category,
      description: rawFacts.description,
      snapshot: snapshotFromFacts(rawFacts),
      title: analysis.title,
      verdict: analysis.verdict,
      verdict_type: analysis.verdict_type,
      price_insight: analysis.price_insight,
      quick_read: { ...analysis.quick_read, whats_solid: solid.kept },
      red_flags: policedFlags,
      negotiation_plan: { ...analysis.negotiation_plan, leverage_you_have: leverage, trades_you_can_offer: trades },
      what_to_ask_for: hygienicAsks,
      potential_savings: policedSavings,
      score_rationale: analysis.score_rationale,
      assumptions: analysis.assumptions,
    }

    // ─── Step 4: Validate, then compute deterministic scores ───
    const validated = DealOutputSchema.parse(assembled)

    // Sanitize total_commitment
    if (validated.snapshot?.total_commitment) {
      validated.snapshot.total_commitment = normalizeAmount(validated.snapshot.total_commitment)
    }

    // Extract-then-compute: the LLM extracted the facts, the engine sets the numbers.
    const highTermsFlagCount = countHighTermsFlags(validated.red_flags)
    const scores = computeScores(extraction, { asOf, highTermsFlagCount })

    // Persist the extraction + deductions alongside the computed scores so the deal
    // carries everything the breakdown UI needs. (No legacy `calculateQuoteScore`.)
    // confidence/target_price_range are new fast-analysis-only fields, attached
    // after validation the same way score/score_breakdown already are —
    // DealOutputSchema is a plain z.object() (strips unknown keys on parse),
    // so this is the existing pattern for adding fields the schema doesn't
    // declare, not a new trick.
    const result: any = {
      ...validated,
      contact_name: rawFacts.contact_name,
      score: scores.overall,
      score_label: scoreLabel(scores.overall),
      score_rationale: analysis.score_rationale || '',
      score_breakdown: {
        pricing: scores.pricing,
        terms: scores.terms,
        leverage: scores.leverage,
        deductions: scores.deductions,
      },
      // The normalised extraction (renewal fields and dates included) — the exact
      // input the score was computed from, so a rescore reproduces it.
      extraction,
      deductions: scores.deductions,
      confidence: analysis.confidence,
      // Kept as the model's own estimate; the hero tile and the email use
      // lib/deal-target.ts (total − quantified asks, or the benchmark target).
      target_price_range: analysis.target_price_range,
      // Persisted so deep analysis (triggered later, on demand) can reuse it
      // instead of re-running classifyQuote() — same non-schema attach
      // pattern as everything else above.
      classification,
      classification_source: prepared.classificationSource,
      // Validated commercial facts (lib/quote-facts.ts) — persisted with the
      // round so outcomes can be compared later without the quote text.
      quote_facts: quoteFacts,
      // The persisted extract: the only view of the document later steps get.
      extract: prepared.extract,
      analysis_date: asOf,
      quote_expired: quoteExpired,
      deal_type_evidence: rawFacts.deal_type_evidence || [],
      deep_analysis_status: 'idle' as const,
      analysis_status: 'done' as const,
    }
    timer.mark('assemble_ms', Date.now() - assembleStart)
    console.log(`[TermLift timing] Step 4 (validate + score, in-process, no DB): ${timer.t.assemble_ms}ms`)
    console.log('[TermLift] Pipeline complete — score:', scores.overall, `(p${scores.pricing}/t${scores.terms}/l${scores.leverage})`, quoteExpired ? '| QUOTE EXPIRED' : '')

    // The single stored target: quote − quantified must-have savings (benchmark target once the Playbook has one).
    return attachTargetPrice(result, contractTotal) as DealOutputType
  } catch (error) {
    throw normalizePipelineError(error)
  }
}

function normalizePipelineError(error: unknown): Error {
  const msg = error instanceof Error ? error.message : String(error)
  console.error('[TermLift] Pipeline error:', msg)

  if (msg.includes('AI_PARSE_ERROR') || msg.includes('AI_VALIDATION_ERROR') || msg.includes('AI_OVERLOADED')) {
    return error instanceof Error ? error : new Error(msg)
  }

  if (error instanceof Error && error.name === 'ZodError') {
    const issues = (error as any).issues || (error as any).errors || []
    const summary = issues.map((i: any) => `${i.path?.join('.')}: ${i.message}`).join('; ')
    console.error('[TermLift] Zod validation details:', JSON.stringify(issues, null, 2))
    return new Error(`AI_VALIDATION_ERROR: ${summary || 'AI response missing required fields'}`)
  }

  if (msg.includes('overloaded') || msg.includes('529')) {
    return new Error('AI_OVERLOADED: AI service is temporarily overloaded')
  }

  return new Error('AI_ANALYSIS_ERROR: ' + msg)
}

/**
 * Main analysis pipeline — both phases in one call. Same signature as before
 * for the callers that still analyse in a single request (vendor-reply rounds,
 * the anonymous trial, the admin pipeline compare).
 */
export async function analyzeDeal(
  extractedText: string,
  dealType: DealType,
  goal?: string,
  notes?: string,
  previousRoundOutput?: DealOutput,
  imageData?: { base64: string; mimeType: string },
  allPages?: Array<{ base64: string; mimeType: string }>,
  userLocale?: string,
  pdfData?: { base64: string; mimeType: string },
  userPreferences?: UserPreferences,
  // Optional result of an earlier /api/deal/extract-preview call — when
  // present, Steps 0+1 reuse it instead of re-calling classifyQuote()/
  // extractFinancialFacts(), so the two-request flow never doubles the
  // LLM calls a single analysis makes.
  precomputed?: { classification: QuoteClassificationType; rawFacts: ExtractedFacts },
  // Text the classifier reads when the quote arrived as a file (server-side
  // pdf-parse / OCR output). Haiku cannot take a PDF, so without this it used
  // to classify "(see attached document)" with nothing attached.
  textForClassification?: string,
  timer?: Timer,
): Promise<DealOutputType> {
  if (ANALYSIS_PIPELINE_V3) {
    return runFullAnalysisPipelineV3(
      extractedText, dealType, goal, notes, previousRoundOutput,
      imageData, allPages, userLocale, pdfData, userPreferences,
    )
  }

  const t = timer ?? createTimer()
  const asOf = analysisDate()
  let prepared: PreparedExtract
  try {
    prepared = await prepareExtract({ extractedText, dealType, imageData, allPages, pdfData, precomputed, textForClassification, timer: t })
  } catch (error) {
    throw normalizePipelineError(error)
  }
  // The flags call reads the stored text — pasted text, or the parsed/transcribed
  // text of an uploaded file — never the file itself.
  const textForAnalysis = extractedText && extractedText.trim().length >= 10 && !/^\[.{0,80}\]$/.test(extractedText.trim())
    ? extractedText
    : (textForClassification || '')
  const output = await analyzeFromExtract(prepared, textForAnalysis, { dealType, goal, notes, previousRoundOutput, userLocale, userPreferences, timer: t, asOf })
  console.log(`[TermLift timing] TOTAL analyzeDeal() (excludes DB writes, done by the caller): ${t.elapsed()}ms`)
  return output
}
