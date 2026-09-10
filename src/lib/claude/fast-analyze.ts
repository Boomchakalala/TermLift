import Anthropic from '@anthropic-ai/sdk'
import { createTrackedMessage, CLAUDE_MODEL, getResponseText, parseJsonFromContent, getLanguageInstruction, buildImageContent } from './client'
import { QUOTE_TYPE_OVERLAYS, buildSavingsDirective, buildClassificationContext } from './overlays'
import { buildPreferencesDirective } from './analyze'
import type { QuoteClassificationType } from '../schemas'
import type { DealOutput } from '@/types'
import type { ExtractedFacts } from './extract'
import { logAiRaw } from '@/lib/ai-debug'

// ─────────────────────────────────────────────────────────────────────────────
// Fast core analysis — a deliberately trimmed sibling of analyze.ts's
// analyzeDealFacts(), used for the blocking initial-display path. Same model,
// same "extraction" sub-schema (still required — lib/scoring.ts's
// computeScores() needs it for the deal score), but asks for a small fraction
// of the output volume: 3-5 short red flags instead of up to 10 detailed ones,
// no full negotiation strategy, no cash-flow analysis, no watch items, no
// email drafts. analyzeDealFacts() itself is untouched and still available —
// this file does not replace it, it sits alongside it for the fast path.
// ─────────────────────────────────────────────────────────────────────────────

const FAST_ANALYSIS_PROMPT = `You are a sharp buyer-side procurement expert giving a FAST first read of a vendor quote.

You are not neutral. You are on the buyer's side. You are aggressive but honest.

LATENCY AND BREVITY ARE CRITICAL. Return the minimum text necessary to communicate the finding. Do not elaborate unless required for correctness.

This is a SPEED-CRITICAL pass. The buyer needs to know in seconds whether this quote is negotiable and what the single most important move is. A deeper pass happens later if they ask for it. Do NOT try to be exhaustive here — being complete is the deeper pass's job, not this one.

You will receive:
1. VERIFIED financial facts (vendor, currency, total_commitment, term). Ground truth — do not recalculate.
2. The raw quote for commercial analysis.

==================================================
WHAT TO PRODUCE — KEEP EVERYTHING SHORT
==================================================

- verdict: MAXIMUM 1-2 sentences telling the buyer what to do next. This is the ONLY place you state the bottom line — do not restate it elsewhere.
- quick_read.whats_solid: max 2 short bullets, phrases not sentences.
- red_flags: MAXIMUM 3 — the highest-value issues only, by dollar impact or legal/financial exposure. Fewer is fine and often correct; do not pad. Skip entirely if the quote is clean. For each: issue (one short sentence), why_it_matters (ONE short sentence — the dollar/legal consequence only, no background), what_to_ask_for (one short concrete ask), if_they_push_back (one short fallback, as brief as the ask itself). Never combine unrelated commercial issues into one red flag simply to fit the maximum count — select only the three highest-impact INDEPENDENT issues and omit lower-priority issues entirely rather than merging them into a flag about something else.
- negotiation_plan.leverage_you_have: MAXIMUM 3 — short phrases, not sentences (e.g. "Deadline in 6 days", not "The vendor has set a deadline in 6 days which creates urgency").
- what_to_ask_for.must_have: pull directly from the red flags' asks — do NOT restate them in different words, just list the ask itself tersely. Do not add asks unrelated to a red flag unless it's the standard baseline discount ask.
- potential_savings: 2 must_have items MAXIMUM, each with a rationale of one short clause (not a sentence — "standard on new-logo deals", not "This is a standard ask that buyers typically make on new-logo deals of this size"). Also a top-level low/high range: most conservative defensible number as "low", most aggressive still-defensible number as "high". total = sum of must_have amounts.
- assumptions: MAXIMUM 2 — only include one if omitting it could materially mislead the buyer.
- confidence: "low" | "medium" | "high" — how confident you are in this read given what's actually in the document.
- target_price_range: {"low": number, "high": number} representing a realistic negotiated total if you can support one from the quote, else null. Do not invent a number you can't ground in the document.
- verdict_type: "negotiate|competitive|overpay_risk" — your overall read of the deal.

Do NOT produce: title (constructed in code from facts you already provided), quick_read.whats_concerning (redundant with red_flags — not shown to the user in this pass), price_insight (not used in this pass), score_rationale (derived from your verdict in code), negotiation_plan.trades_you_can_offer (empty here — that detail is for the deeper pass), nice_to_have savings, cash_flow_improvements, watchItems, or long-form rationale anywhere.

AVOID REPEATING YOURSELF: verdict, red_flags, leverage_you_have, and assumptions must each say something DIFFERENT. Do not restate the same point in two of these sections with different wording — say it once, in the section it belongs to.

==================================================
STRUCTURED EXTRACTION (for scoring — unchanged, still required)
==================================================

You do NOT score the deal. A separate deterministic engine computes pricing, terms, and leverage scores from the facts you extract. Your only job here is to extract those facts precisely into the "extraction" object. Be literal: report what the quote says, not how it feels. If a fact is genuinely not in the quote, use null or omit it — do NOT invent terms.

extraction.fees: every fee, surcharge, service charge, gratuity, admin or processing charge, or markup line. For each:
- name, type (admin|processing|gratuity|tax|other)
- percentage: of subtotal when expressed as a %, else null
- dollarAmount: when expressed as an amount, else null
- isAvoidable: true if the buyer could realistically get it waived or removed (admin, processing, "service charge"); false for genuine government taxes
- isDisclosedAsNonService: true if it is not payment for a real service the buyer receives

extraction.cancellationTerms:
- refundSchedule: short text of the refund/cancellation tiers
- buyerInsideWindow: true if the buyer is already inside a cancellation/penalty window
- retentionPctInsideWindow: the % the vendor keeps if cancelled inside the window (100 if fully non-refundable, else the tier %, else null)
- forceMajeurePresent, rescheduleOption, rescheduleFeePct

extraction.paymentTerms: depositPct, balanceDueDaysBeforeDelivery (days before delivery the balance is due), achOffered, netTerms (net payment days, else null)

extraction.vendorRights:
- unilateralSubstitution: vendor may swap product/service/personnel without consent
- mandatoryMarketing: buyer must provide testimonials/logo/marketing
- reciprocalValue: true if the buyer gets something of value in return for any mandatory obligation

extraction.tbdLineItems: any line priced as TBD / "to be determined" / estimate / not finalized. For each: description, dollarAmount (best estimate of the exposure).

extraction.leverageFactors:
- competingQuoteInHand, daysToDeadline (days to the signing deadline, else null), soleSource (no realistic alternative vendor), dealSizeSignificant (meaningful revenue for the vendor), buyerInsidePenaltyWindow

extraction.pricingItemized: true if pricing is broken out line-by-line; false if it is a lump sum or bundled.

extraction.renewalTerms (literal reads; null when the document is silent):
- autoRenew: true if the agreement renews automatically, false if it says it does not, else null
- noticeDays: days of notice required to prevent renewal / cancel, as a number, else null
- escalationMinPct: the stated minimum annual increase on renewal as a number ("at least 4%" = 4), else null
- escalationCapPct: the stated maximum annual increase, ONLY if the document states a ceiling; a "minimum of X%" with no ceiling is null here
- extraIncreaseAllowed: true if the vendor reserves the right to increase beyond the stated percentage, false if the stated percentage is the ceiling, else null

extraction.quoteDates (copied as printed, null when absent): created (date the quote was issued), expires (valid-until / signing deadline), currentSubEnd (end date of an existing subscription the quote mentions, e.g. "Sub end date"). Do NOT compute days from these; report the dates.

==================================================
WRITING STYLE
==================================================

Sharp, direct, human. Never use en dash or em dash characters. No hedging language. Every sentence should be shorter than you'd write for a full report — this is a fast read, not deep analysis.

==================================================
OUTPUT SCHEMA
==================================================

Return valid JSON only. Do NOT include title, price_insight, quick_read.whats_concerning, score_rationale, or negotiation_plan.trades_you_can_offer — they are not part of this schema:

{
  "verdict": "Max 1-2 sentences telling the buyer what to do next",
  "verdict_type": "negotiate|competitive|overpay_risk",
  "quick_read": {
    "whats_solid": ["...", "..."]
  },
  "red_flags": [
    {
      "type": "Commercial|Renewal|Scope|Payment Terms|Source Insight|Implementation|Usage Risk|Deposit|Bundling",
      "severity": "high|medium|low",
      "score_category": "pricing|terms|leverage",
      "issue": "",
      "why_it_matters": "",
      "what_to_ask_for": "",
      "if_they_push_back": ""
    }
  ],
  "negotiation_plan": {
    "leverage_you_have": ["...", "...", "..."]
  },
  "what_to_ask_for": {
    "must_have": ["..."]
  },
  "potential_savings": {
    "total": 700,
    "currency": "EUR",
    "low": 700,
    "high": 1400,
    "must_have": [
      {"ask": "5% discount on total price", "amount": 700, "rationale": "standard on negotiated quotes"}
    ]
  },
  "confidence": "medium",
  "target_price_range": {"low": 34000, "high": 36000},
  "assumptions": ["..."],
  "extraction": {
    "pricingItemized": true,
    "fees": [
      {"name": "administration charge", "type": "admin", "percentage": 7, "dollarAmount": null, "isAvoidable": true, "isDisclosedAsNonService": true}
    ],
    "cancellationTerms": {"refundSchedule": "50% refundable up to 60 days out", "buyerInsideWindow": false, "retentionPctInsideWindow": null, "forceMajeurePresent": true, "rescheduleOption": true, "rescheduleFeePct": null},
    "paymentTerms": {"depositPct": 25, "balanceDueDaysBeforeDelivery": 0, "achOffered": true, "netTerms": 30},
    "vendorRights": {"unilateralSubstitution": false, "mandatoryMarketing": false, "reciprocalValue": true},
    "tbdLineItems": [],
    "leverageFactors": {"competingQuoteInHand": false, "daysToDeadline": 21, "soleSource": false, "dealSizeSignificant": true, "buyerInsidePenaltyWindow": false},
    "renewalTerms": {"autoRenew": true, "noticeDays": 60, "escalationMinPct": 4, "escalationCapPct": null, "extraIncreaseAllowed": true},
    "quoteDates": {"created": "November 13, 2025", "expires": "January 31, 2026", "currentSubEnd": null}
  }
}

==================================================
GROUND RULES
==================================================

- Use the PROVIDED total_commitment. Do not recalculate it.
- Every amount must trace to the quote or simple arithmetic on quote numbers.
- PERIODS: a printed line total is the total for the term the quote shows (annual on a 12-month order), never a monthly figure. A monthly figure is quantity × unit price for ONE month; the term figure is that × term months. Never multiply a line total by the term. No single savings item can equal or exceed the quote total.
- Do not invent competitor prices or claim market data as fact.
- Do not ask the user questions in the output.
- Keep currency consistent throughout.
- If the VERIFIED FACTS state quote_expires / signing_deadline earlier than the ANALYSIS DATE given in the context, the quote has expired: do not list the deadline as leverage or urgency, and say the numbers are historical until the vendor re-quotes.
- HARD LIMITS: 3 red flags maximum, 3 leverage points maximum, 2 savings items maximum, 2 assumptions maximum. These are ceilings, not targets — fewer is fine when fewer is genuinely correct.
- This is the FAST pass — brevity is correct, not a shortcoming. Do not apologize for or mention the brevity in the output.

Return ONLY valid JSON.`

/** Raw shape actually requested from the LLM — narrower than FastAnalysisOutput.
 *  title/quick_read.conclusion/score_rationale/negotiation_plan.trades_you_can_offer/
 *  price_insight/quick_read.whats_concerning are NOT asked for here; they're
 *  either derived in code from `verdict` or left as schema defaults. See
 *  analyzeFastCore()'s post-processing below. */
type FastAnalysisRaw = Omit<FastAnalysisOutput, 'title' | 'quick_read' | 'score_rationale' | 'negotiation_plan'> & {
  quick_read: { whats_solid: string[] }
  negotiation_plan: { leverage_you_have: string[] }
}

export interface FastAnalysisOutput {
  title: string
  verdict: string
  verdict_type: 'negotiate' | 'competitive' | 'overpay_risk'
  price_insight?: string
  quick_read: { whats_solid: string[]; whats_concerning: string[]; conclusion: string }
  red_flags: Array<{
    type: string
    severity: 'high' | 'medium' | 'low'
    score_category: 'pricing' | 'terms' | 'leverage'
    issue: string
    why_it_matters: string
    what_to_ask_for: string
    if_they_push_back: string
  }>
  negotiation_plan: { leverage_you_have: string[]; trades_you_can_offer: string[] }
  what_to_ask_for: { must_have: string[]; nice_to_have: string[] }
  potential_savings?: {
    total: number
    currency: string
    low?: number
    high?: number
    must_have: Array<{ ask: string; amount: number; rationale: string }>
    nice_to_have?: Array<{ ask: string; amount: number; rationale: string }>
  }
  confidence?: 'low' | 'medium' | 'high'
  target_price_range?: { low: number; high: number } | null
  score_rationale?: string
  assumptions: string[]
  extraction?: Record<string, any>
}

/** Deterministically splits a 1-2 sentence verdict into a diagnostic half
 *  (score_rationale) and an action half (quick_read.conclusion), so the two
 *  don't render as a literal duplicate of `verdict` elsewhere on the page.
 *  No LLM call — regex sentence split only. Falls back to the same text for
 *  both when the verdict is a single sentence (nothing to split). */
function deriveVerdictVariants(verdict: string): { scoreRationale: string; quickReadConclusion: string } {
  const sentences = verdict.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()).filter(Boolean) || [verdict.trim()]
  if (sentences.length >= 2) {
    return { scoreRationale: sentences[0], quickReadConclusion: sentences[sentences.length - 1] }
  }
  return { scoreRationale: verdict, quickReadConclusion: verdict }
}

export async function analyzeFastCore(
  facts: ExtractedFacts,
  classification: QuoteClassificationType,
  rawText: string,
  options: {
    dealType: 'New' | 'Renewal'
    goal?: string
    notes?: string
    previousRoundOutput?: DealOutput
    userLocale?: string
    imageData?: { base64: string; mimeType: string }
    allPages?: Array<{ base64: string; mimeType: string }>
    pdfData?: { base64: string; mimeType: string }
    userPreferences?: { payment_terms?: string; top_priority?: string; auto_renewal?: string; contract_term_strategy?: string }
    /** Server date `YYYY-MM-DD`; lets the model see that a printed deadline is already past. */
    asOf?: string
  },
): Promise<FastAnalysisOutput> {
  const overlay = QUOTE_TYPE_OVERLAYS[classification.quote_type] || ''
  const savingsDirective = buildSavingsDirective(classification)
  // Same preferences block the Playbook uses — Round 1 and vendor-reply rounds
  // used to ignore them (the option was accepted and never read).
  const preferencesDirective = buildPreferencesDirective(options.userPreferences)
  const enhancedPrompt = FAST_ANALYSIS_PROMPT + '\n\n' + overlay + '\n\n' + savingsDirective + '\n\n' + preferencesDirective

  const contextParts = [
    `Deal Type: ${options.dealType}`,
    options.asOf && `ANALYSIS DATE: ${options.asOf}`,
    buildClassificationContext(classification),
    `\nVERIFIED FINANCIAL FACTS (use these as ground truth, do NOT recalculate):\n${JSON.stringify(facts, null, 2)}`,
    options.goal && `User Goal: ${options.goal}`,
    options.notes && `User Notes: ${options.notes}`,
  ].filter(Boolean)

  const visualContent = buildImageContent(options.imageData, options.allPages, options.pdfData)
  const hasVisualInput = !!visualContent

  const userPrompt = hasVisualInput
    ? `${contextParts.join('\n\n')}\n\nPlease analyze the quote/contract shown in the attached document. Read it carefully but keep your output short per the instructions.${rawText ? `\n\nExtracted text (for reference):\n${rawText}` : ''}`
    : `${contextParts.join('\n\n')}\n\nSupplier Document/Quote:\n${rawText}`

  let userContent: Anthropic.MessageParam['content']
  if (visualContent) {
    userContent = [{ type: 'text', text: userPrompt }, ...(visualContent as any[])]
  } else {
    userContent = userPrompt
  }

  const response = await createTrackedMessage('fast_analyze', {
    model: CLAUDE_MODEL,
    // Lowered from 4096 after the Step 2 schema/prompt reduction (5 flags -> 3,
    // shorter fields, 2 fewer duplicate one-liners, price_insight/
    // whats_concerning/trades_you_can_offer dropped entirely). Verified live
    // against the same test document before landing here — see the session
    // report — not lowered blindly. Still real headroom above expected output.
    max_tokens: 3072,
    system: enhancedPrompt + getLanguageInstruction(options.userLocale || 'en'),
    messages: [{ role: 'user', content: userContent }],
    temperature: 0,
    output_config: { effort: 'low' },
  })

  if (response.stop_reason === 'max_tokens') {
    console.error('[TermLift] Fast analysis response truncated')
    throw new Error('AI_PARSE_ERROR: Fast analysis response truncated')
  }

  const content = getResponseText(response)
  if (!content) throw new Error('No response from AI')
  logAiRaw('Fast analysis raw response', content, 300)

  const raw = parseJsonFromContent(content) as FastAnalysisRaw

  if (!raw.verdict || !raw.what_to_ask_for) {
    const keys = Object.keys(raw)
    const sample = JSON.stringify(raw).substring(0, 300)
    console.error('[TermLift] Fast analysis validation failed. Keys:', keys, 'Sample:', sample)
    throw new Error(`AI_VALIDATION_ERROR: Fast analysis missing required fields. Got keys: [${keys.join(', ')}]. Sample: ${sample}`)
  }

  // ── Code-derived fields — not asked of the LLM (see the audit) ──
  // title: purely mechanical formatting from facts already known before this
  // call ran. verdict_type is still LLM-authored (see analyzeFastCore's own
  // comment below) — tested deriving it from score bands and found it doesn't
  // match the LLM's nuanced read closely enough (a 89-score renewal came back
  // "negotiate" from the LLM, not "competitive" a pure threshold would give),
  // so that one stayed put; it's a single enum word, negligible cost anyway.
  const monthYear = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const title = `${facts.vendor} | ${options.dealType === 'New' ? 'New Purchase' : 'Renewal'} | ${monthYear}`

  // quick_read.conclusion and score_rationale both restate the bottom line
  // in different UI spots (hero, quick-read card). Asking the LLM to write
  // that sentence three times was pure duplication — but reusing the exact
  // same string for all three read as a bug once visible in the actual UI.
  // deriveVerdictVariants() splits the (1-2 sentence) verdict deterministically
  // instead: the diagnostic half becomes score_rationale, the action half
  // becomes quick_read.conclusion — no extra LLM call, no literal repeat.
  const { scoreRationale, quickReadConclusion } = deriveVerdictVariants(raw.verdict)

  const result: FastAnalysisOutput = {
    title,
    verdict: raw.verdict,
    verdict_type: raw.verdict_type,
    quick_read: {
      whats_solid: raw.quick_read?.whats_solid || [],
      whats_concerning: [],
      conclusion: quickReadConclusion,
    },
    red_flags: raw.red_flags || [],
    negotiation_plan: {
      leverage_you_have: raw.negotiation_plan?.leverage_you_have || [],
      trades_you_can_offer: [],
    },
    what_to_ask_for: {
      must_have: raw.what_to_ask_for?.must_have || [],
      nice_to_have: [],
    },
    potential_savings: raw.potential_savings,
    confidence: raw.confidence,
    target_price_range: raw.target_price_range,
    score_rationale: scoreRationale,
    assumptions: raw.assumptions || [],
    extraction: raw.extraction,
  }

  return result
}
