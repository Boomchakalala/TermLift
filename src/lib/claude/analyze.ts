import { benchmarkForPrompt } from '@/lib/benchmark/prompt-block'
import Anthropic from '@anthropic-ai/sdk'
import { createTrackedMessage, CLAUDE_MODEL, getResponseText, parseJsonFromContent, getLanguageInstruction, buildImageContent, type ClaudeImageMediaType } from './client'
import { QUOTE_TYPE_OVERLAYS, buildSavingsDirective, buildClassificationContext } from './overlays'
import type { QuoteClassificationType } from '../schemas'
import type { DealOutput } from '@/types'
import type { ExtractedFacts } from './extract'
import { logAiRaw } from '@/lib/ai-debug'

const ANALYSIS_PROMPT = `You are a sharp buyer-side procurement expert.

You review supplier quotes the way an experienced procurement lead would. You look for every opportunity to save money, tighten terms, and strengthen the buyer's position.

You are not neutral. You are on the buyer's side. You are aggressive but honest.
You are not evaluating whether the price is fair. You are finding every way to pay less. A price can be fair AND negotiable.

You will receive:
1. VERIFIED financial facts (vendor, currency, total_commitment, term). These are ground truth. Do not recalculate them.
2. The raw quote for commercial analysis.

==================================================
HOW TO ANALYZE
==================================================

Look at the quote and react like a procurement expert would. Find what matters:

- Is the price fair or inflated? Can it be challenged?
- Are there fees, packs, bundles, or add-ons with margin in them?
- Is the vendor a broker, reseller, dealer, or intermediary? If yes, their margin is negotiable. ALWAYS flag this as a "Source Insight" red flag. Every dealer, distributor, car broker, equipment dealer, or franchise selling another brand's product is an intermediary.
- Are there unused seats, excess quantity, or scope waste? A quote only ever states CONTRACTED counts, never actual usage/adoption — so unless the document itself explicitly states usage/adoption numbers, never assert a specific count of "unused" seats or capacity as fact. Phrase it as a question to raise with the supplier or a conditional hypothesis instead (e.g. "ask the supplier to confirm active-seat utilization" or "if adoption is below X, this is leverage" — not "16 seats are unused").
- Are the terms supplier-friendly? (auto-renewal, short notice, escalation, no exit)
- Is there leverage? (deadline, cash payment, volume, competing alternatives)
- What can the buyer trade? (fast signature, longer commitment, referral)
- If the quote includes complimentary items, tickets, passes, or extras: flag them and ask for more. These are low-cost for the vendor and high-value negotiation chips.
- Your savings ask MUST reflect the actual margin you identify. If you say the vendor has 15-25% margin, ask for 15%, not 5%. Match the ask to the evidence.

Be selective with red flags. An item is a RED FLAG only if it passes BOTH tests:
1. ACTIONABLE — there is a concrete ask that changes the outcome (a number to push, a clause to add or remove).
2. MATERIAL — it affects MORE THAN 1% of contract value, OR it creates legal/financial exposure (cancellation terms, auto-renewal, liability, fraud signals).

Pure observations are NOT red flags: "priced at the high end of market", "X is not visible in the document", "typical for this category", "worth reviewing Y". Anything worth noting that fails this test goes into watchItems instead — that is your outlet, so you never need to inflate flags to feel thorough.

The count of red flags is NOT fixed and must NOT be anchored to any target number. Apply the test above item by item and report every item that passes — nothing more, nothing less. A clean, well-drafted quote may genuinely have only 1 flag, or even 0. A quote with many separate problems (stacked fees, one-sided cancellation terms, vague scope, auto-renewal traps, undisclosed intermediary margin) may genuinely have 8-10+ flags — report all of them if each individually passes the test. Do NOT pad a clean quote to look thorough, and do NOT compress a messy quote down to look tidy or "reasonable." (Savings items and asks are still uncapped — this is about red flags only.)

==================================================
DOCUMENT ANALYSIS
==================================================

You may receive quotes as images, PDFs, or extracted text.
Read everything carefully: tables, line items, fine print, dates, terms, fees, exclusions.
When analyzing text, treat tabs and repeated spaces as possible table columns.

==================================================
SAVINGS
==================================================

Find every realistic way to reduce the cost of this deal.

Each savings opportunity is either:
- must_have: you would put this in a negotiation email. It counts toward the headline number.
- nice_to_have: worth asking but not the main battle. Shown separately.

All amounts must be RAW NUMBERS (e.g., 700 not "700 EUR"). Include currency separately.
total = sum of must_have amounts.

Be aggressive. A good procurement lead would:
- Always ask for a discount on the headline price (5% minimum on any negotiated quote)
- Challenge every fee, pack, and add-on separately
- Push for volume, loyalty, early-payment, or multi-year discounts where relevant
- Include extras or accessories in the deal price
- Right-size quantity to actual usage
- Challenge intermediary/reseller/dealer margin
- On equipment, vehicles, or high-value goods: dealers typically carry roughly 10-25% margin (a rough industry heuristic, not a verified figure for this specific vendor) — use it to judge whether a price looks negotiable, but phrase any reference to it in your output as an estimate, not a stated fact. A cash buyer should push for 5-10% off minimum. "The price looks fair" is not a reason to stop pushing.

Payment term improvements are NOT savings. They go in cash_flow_improvements, not potential_savings.

If a red flag has a dollar impact, it MUST also appear as a savings item.
Each challengeable element is a SEPARATE item. Do not merge them.

==================================================
STRUCTURED EXTRACTION (for scoring)
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
- retentionPctInsideWindow: the % the vendor keeps if the buyer cancels inside the window (100 if fully non-refundable, else the tier %, else null)
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

If the quote's expiry date is earlier than the ANALYSIS DATE in the context, the quote has expired: do not present the deadline as leverage or urgency anywhere, and treat the printed prices as historical until the vendor re-quotes.

==================================================
RED FLAG SEVERITY (assign on every red flag)
==================================================

HIGH   = financial exposure or a one-sided term affecting MORE THAN 5% of contract value, or total cancellation exposure.
MEDIUM = 1-5% of contract value, or a meaningful operational risk.
LOW    = under 1% of contract value, or a convenience issue.

ALWAYS HIGH, regardless of dollar amount: any fraud indicator — changed banking or payment details, a changed contracting entity, or any request to redirect payment. These are HIGH even if the amount is small.

score_rationale: ONE or TWO short, qualitative sentences on where this deal stands for the buyer. Do NOT state or imply a number — the engine sets the score. Reference the actual issues, not generic advice.

==================================================
WRITING STYLE
==================================================

Write like an experienced procurement lead. Sharp, direct, human.
Never use en dash or em dash characters. Use commas, colons, or normal hyphens.
Do not use hedging language ("it may be worth considering"). Be direct.
Do not repeat the same point across sections.

==================================================
OUTPUT SCHEMA
==================================================

Return valid JSON only:

{
  "title": "Vendor | New Purchase or Renewal | Month Year",
  "verdict": "One clear sentence telling the buyer what to do next",
  "verdict_type": "negotiate|competitive|overpay_risk",
  "price_insight": "Optional pricing observation. Omit if none.",
  "quick_read": {
    "whats_solid": ["..."],
    "whats_concerning": ["..."],
    "conclusion": "One sentence, the dominant issue"
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
    "leverage_you_have": ["..."],
    "trades_you_can_offer": ["..."]
  },
  "what_to_ask_for": {
    "must_have": ["..."],
    "nice_to_have": ["..."]
  },
  "potential_savings": {
    "total": 950,
    "currency": "EUR",
    "must_have": [
      {"ask": "5% discount on total price", "amount": 700, "rationale": "Standard ask on negotiated quote"},
      {"ask": "Reduce pack fees from 591 to 300", "amount": 291, "rationale": "Services overpriced vs actual cost"}
    ],
    "nice_to_have": [
      {"ask": "Include accessories in the deal", "amount": 200, "rationale": "Possible if buyer commits quickly"}
    ]
  },
  "cash_flow_improvements": [
    {"recommendation": "", "category": "cash_flow|risk"}
  ],
  "watchItems": [
    {"description": "One-line note that is worth mentioning but failed the red flag test", "category": "pricing|terms|leverage|scope|other"}
  ],
  "extraction": {
    "pricingItemized": true,
    "fees": [
      {"name": "administration charge", "type": "admin", "percentage": 7, "dollarAmount": null, "isAvoidable": true, "isDisclosedAsNonService": true}
    ],
    "cancellationTerms": {"refundSchedule": "50% refundable up to 60 days out", "buyerInsideWindow": false, "retentionPctInsideWindow": null, "forceMajeurePresent": true, "rescheduleOption": true, "rescheduleFeePct": null},
    "paymentTerms": {"depositPct": 25, "balanceDueDaysBeforeDelivery": 0, "achOffered": true, "netTerms": 30},
    "vendorRights": {"unilateralSubstitution": false, "mandatoryMarketing": false, "reciprocalValue": true},
    "tbdLineItems": [{"description": "AV package (TBD)", "dollarAmount": 3000}],
    "leverageFactors": {"competingQuoteInHand": false, "daysToDeadline": 21, "soleSource": false, "dealSizeSignificant": true, "buyerInsidePenaltyWindow": false},
    "renewalTerms": {"autoRenew": true, "noticeDays": 60, "escalationMinPct": 4, "escalationCapPct": null, "extraIncreaseAllowed": true},
    "quoteDates": {"created": "November 13, 2025", "expires": "January 31, 2026", "currentSubEnd": null}
  },
  "score_rationale": "Short qualitative read for the buyer. No numbers.",
  "assumptions": ["..."],
  "disclaimer": "This analysis is commercial guidance, not legal advice. Verify final terms before signing.",
  "benchmark_interpretation": {
    "summary": "ONLY when a MARKET BENCHMARK block is provided: one or two sentences on what the benchmark means for this buyer.",
    "why_bullets": ["3-5 short bullets connecting the benchmark evidence to the negotiation. Reuse the benchmark's own numbers; add none."],
    "target_price": 0,
    "opening_ask": 0,
    "target_rationale": "Why this target and opening ask, in one or two sentences.",
    "limitations_note": "One sentence restating the benchmark's limitations in plain language."
  }
}

MARKET BENCHMARK RULES (apply only when a MARKET BENCHMARK block is present in the context; otherwise omit benchmark_interpretation entirely):
- The benchmark numbers are computed by TermLift from stored observations. They are the source of truth. Never recompute, adjust, or contradict them.
- Never invent additional comparable transactions, market medians, discounts, or sources. Do not cite any market data that is not in the block.
- target_price must sit inside [strong_outcome_low, fair_market_high]; opening_ask must be >= strong_outcome_low and <= target_price. Both in the quote currency. If the block says benchmark_available is false, set both to null and explain the evidence is directional.
- If confidence is "low", say so plainly and describe the guidance as directional. Never upgrade the confidence in your wording.
- Fold the benchmark into the playbook: the must_have asks and potential_savings may reference the target, but every amount must still trace to the quote or the benchmark block.

==================================================
GROUND RULES
==================================================

- Use the PROVIDED total_commitment. Do not recalculate it.
- Every amount must trace to the quote or simple arithmetic on quote numbers.
- Do not invent competitor prices or claim market data as fact.
- Do not ask the user questions in the output.
- Do not pad. If the deal is clean, say so.
- Keep currency consistent throughout.
- Savings amounts must be annual for recurring deals, total for one-time purchases.

Return ONLY valid JSON.`

// Leverage levels used in the pre-analysis assessment
export type LeverageLevel = 'low' | 'moderate' | 'high'
export type SavingsConfidence = 'low' | 'medium' | 'high'
export type NegotiationAngle = 'price' | 'terms' | 'structure' | 'scope_clarity' | 'billing_renewal' | 'risk'

export interface LeverageAssessment {
  price_leverage: LeverageLevel
  terms_leverage: LeverageLevel
  structural_leverage: LeverageLevel
  risk_leverage: LeverageLevel
  ambiguity_leverage: LeverageLevel
  savings_confidence: SavingsConfidence
  best_negotiation_angle: NegotiationAngle[]
}

// Type for the analysis output
export interface AnalysisOutput {
  leverage_assessment?: LeverageAssessment
  title: string
  verdict: string
  verdict_type: 'negotiate' | 'competitive' | 'overpay_risk'
  price_insight?: string
  quick_read: {
    whats_solid: string[]
    whats_concerning: string[]
    conclusion: string
  }
  red_flags: Array<{
    type: string
    severity: 'high' | 'medium' | 'low'
    score_category: 'pricing' | 'terms' | 'leverage'
    issue: string
    why_it_matters: string
    what_to_ask_for: string
    if_they_push_back: string
  }>
  negotiation_plan: {
    leverage_you_have: string[]
    trades_you_can_offer: string[]
  }
  what_to_ask_for: {
    must_have: string[]
    nice_to_have: string[]
  }
  potential_savings?: {
    total: number
    currency: string
    must_have: Array<{ ask: string; amount: number; rationale: string }>
    nice_to_have?: Array<{ ask: string; amount: number; rationale: string }>
  }
  cash_flow_improvements?: Array<{ recommendation: string; category: string }>
  /** Minor notes that failed the red flag qualification test — shown under "Worth noting". */
  watchItems?: Array<{ description: string; category: string }>
  /** Raw structured facts the deterministic scorer consumes (normalized downstream). */
  extraction?: Record<string, any>
  /** Qualitative one/two-sentence read. The numeric score is computed, not returned here. */
  score_rationale?: string
  assumptions: string[]
  disclaimer: string
  /** Present only when a market benchmark block was supplied. See MARKET BENCHMARK RULES in the prompt. */
  benchmark_interpretation?: {
    summary: string
    why_bullets: string[]
    target_price: number | null
    opening_ask: number | null
    target_rationale: string
    limitations_note: string
  }
}

export async function analyzeDealFacts(
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
    userPreferences?: { payment_terms?: string; top_priority?: string; auto_renewal?: string }
    codeFlags?: Array<{ type: string; severity: string; issue: string; what_to_ask_for: string }>
    /** Deterministic Market Benchmark result (lib/benchmark). Injected as an authoritative block; the model may only interpret it. */
    marketBenchmark?: import('@/lib/benchmark/types').BenchmarkResult
    /** Server date `YYYY-MM-DD`; lets the model see that a printed deadline is already past. */
    asOf?: string
  }
): Promise<AnalysisOutput> {
  // Build the enhanced prompt with overlays
  const overlay = QUOTE_TYPE_OVERLAYS[classification.quote_type] || ''
  const savingsDirective = buildSavingsDirective(classification)
  const preferencesDirective = buildPreferencesDirective(options.userPreferences)
  const enhancedPrompt = ANALYSIS_PROMPT + '\n\n' + overlay + '\n\n' + savingsDirective + '\n\n' + preferencesDirective

  // Build context parts — no code flags injected, let the AI think freely
  const contextParts = [
    `Deal Type: ${options.dealType}`,
    options.asOf && `ANALYSIS DATE: ${options.asOf}`,
    buildClassificationContext(classification),
    `\nVERIFIED FINANCIAL FACTS (use these as ground truth, do NOT recalculate):\n${JSON.stringify(facts, null, 2)}`,
    options.goal && `User Goal: ${options.goal}`,
    options.notes && `User Notes: ${options.notes}`,
    options.previousRoundOutput && `MULTI-ROUND ANALYSIS CONTEXT:\nThis is a follow-up round. Previous analysis: ${JSON.stringify(options.previousRoundOutput, null, 2)}\nKeep findings and extraction consistent. Only change them if the quote materially changed.`,
    options.marketBenchmark && `MARKET BENCHMARK (computed by TermLift from stored observations — authoritative, do not recompute or extend):\n${JSON.stringify(benchmarkForPrompt(options.marketBenchmark), null, 2)}`,
  ].filter(Boolean)

  const visualContent = buildImageContent(options.imageData, options.allPages, options.pdfData)
  const hasVisualInput = !!visualContent

  const userPrompt = hasVisualInput
    ? `${contextParts.join('\n\n')}\n\nPlease analyze the quote/contract shown in the attached document. Read the entire document carefully, pay close attention to tables, pricing, terms, dates, and any fine print.${rawText ? `\n\nExtracted text (for reference):\n${rawText}` : ''}`
    : `${contextParts.join('\n\n')}\n\nSupplier Document/Quote:\n${rawText}`

  let userContent: Anthropic.MessageParam['content']
  if (visualContent) {
    userContent = [{ type: 'text', text: userPrompt }, ...visualContent as any[]]
  } else {
    userContent = userPrompt
  }

  const response = await createTrackedMessage('full_analyze', {
    model: CLAUDE_MODEL,
    max_tokens: 8192,
    system: enhancedPrompt + getLanguageInstruction(options.userLocale || 'en'),
    messages: [{ role: 'user', content: userContent }],
    temperature: 0,
    // 'medium' is the balanced default; Sonnet 4.6 otherwise runs 'high' which is
    // overkill for this task and roughly doubles latency. Bump to 'high' if analysis
    // quality regresses.
    output_config: { effort: 'medium' },
  })

  if (response.stop_reason === 'max_tokens') {
    console.error('[TermLift] Analysis response truncated')
    throw new Error('AI_PARSE_ERROR: Analysis response truncated')
  }

  const content = getResponseText(response)
  if (!content) throw new Error('No response from AI')
  logAiRaw('Analyze raw response', content)

  const parsed = parseJsonFromContent(content) as AnalysisOutput
  console.log('[TermLift] Analyze parsed keys:', Object.keys(parsed))

  // Basic validation
  if (!parsed.verdict || !parsed.red_flags || !parsed.what_to_ask_for) {
    const keys = Object.keys(parsed)
    const sample = JSON.stringify(parsed).substring(0, 300)
    console.error('[TermLift] Analysis validation failed. Keys:', keys, 'Sample:', sample)
    throw new Error(`AI_VALIDATION_ERROR: Analysis missing required fields. Got keys: [${keys.join(', ')}]. Sample: ${sample}`)
  }

  return parsed
}

/** The subset of the engine result the model needs — no per-observation detail, no source URLs to "quote". */
export function buildPreferencesDirective(prefs?: { payment_terms?: string; top_priority?: string; auto_renewal?: string; contract_term_strategy?: string }): string {
  if (!prefs) return ''

  const parts: string[] = []

  if (prefs.payment_terms && prefs.payment_terms !== 'no_preference') {
    const label = prefs.payment_terms === 'net_30' ? 'Net 30' : prefs.payment_terms === 'net_60' ? 'Net 60' : 'Net 90'
    parts.push(`- PAYMENT TERMS: User prefers ${label}. If the quote is worse and payment terms are commercially relevant, flag it in cash_flow_improvements. If the quote already matches, do not flag it.`)
  }

  if (prefs.top_priority) {
    if (prefs.top_priority === 'lowest_price') {
      parts.push(`- TOP PRIORITY: LOWEST PRICE. Lean harder into savings and cost structure. Weight pricing issues higher.`)
    } else if (prefs.top_priority === 'best_terms') {
      parts.push(`- TOP PRIORITY: BEST CONTRACT TERMS. Lean harder into renewal, caps, and protections. Weight contract terms higher than pricing.`)
    } else if (prefs.top_priority === 'max_flexibility') {
      parts.push(`- TOP PRIORITY: MAXIMUM FLEXIBILITY. Lean harder into lock-in, minimums, and exit or scaling rights. Flag anything that reduces the buyer's ability to change course.`)
    }
  }

  if (prefs.auto_renewal === 'fine') {
    parts.push(`- AUTO-RENEWAL: User is fine with auto-renewal. Do not flag it unless the notice window, escalation right, or lock-in effect is commercially aggressive.`)
  } else if (prefs.auto_renewal === 'prefer_opt_in') {
    parts.push(`- AUTO-RENEWAL: User prefers opt-in renewal. Flag supplier-friendly auto-renewal and recommend a tighter structure.`)
  }

  if (prefs.contract_term_strategy === 'match_quote') {
    parts.push(`- CONTRACT TERM: Do NOT suggest extending the contract term beyond what is in the quote. Stick to the quoted term. Only flag term-related issues if the term creates unusual lock-in or risk, not as a negotiation angle.`)
  } else if (prefs.contract_term_strategy === 'push_longer') {
    parts.push(`- CONTRACT TERM: If committing to a longer term could unlock meaningful savings or better conditions, flag it as a leverage option.`)
  }

  if (parts.length === 0) return ''

  return `
USER PREFERENCES (apply when relevant):

${parts.join('\n\n')}`
}
