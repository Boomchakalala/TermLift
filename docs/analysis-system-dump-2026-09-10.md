# TermLift analysis system — live dump for external review

Snapshot of the system **as it runs on 2026-09-10** (branch `redesign` = `main` at `779ad48`). Every rule below is quoted from the code or prompt that runs in production. Nothing is redesigned here; sections 9 and 10 are review notes only.

Fixture used throughout: the Equativ / KnowBe4 quote — $36,330, 24 months, 750 KSAT Diamond seats + 750 Compliance Plus seats, 38.1% / 30.85% off list, auto-renew, 90-day notice, "minimum 4%" uplift that "may increase", quote created 2025-11-13, expired 2026-01-31, analysed 2026-09-10 19:46 UTC (deal `7c161277…`, round `b1781f07…`). The stored `output_json` of that round is the evidence for every fixture number; the raw quote text was purged when the Playbook completed (see §0, retention).

Conventions: `code` = file or field name; "LLM" = a Claude call; "code" = deterministic TypeScript. Model IDs are the strings in `src/lib/claude/client.ts`: Sonnet = `claude-sonnet-4-6`, Haiku = `claude-haiku-4-5-20251001`.

---

## 0. Pipeline map

### 0.1 Ordered stages, raw quote → UI

| # | Stage | Where | Model | Deterministic or LLM | Notes |
|---|---|---|---|---|---|
| 1 | Upload | `POST /api/upload` | none | code | PDF → returned to the browser as base64 `pdfData` (native PDF, no text extraction). Image → `imageData`. Pasted text stays text. The browser sets `extractedText: ''` when a file is attached (`NewAnalysisClient.tsx`). |
| 2 | Preview: classify ∥ extract | `POST /api/deal/extract-preview` | Haiku (classify), Sonnet (extract) | LLM ×2, in parallel | Classification (`classify.ts`) and fact extraction (`extract.ts`). Result echoed back by the browser to step 4 as `precomputedClassification` / `precomputedFacts` so it is not recomputed. **For a PDF upload Haiku receives no document and no text** (see §2.4). |
| 3 | Total sanity | same route and again in step 4 | none | code | `normalizeAmount` → `validateTotalCommitment` (12× / 2× override) → in step 4 also `reconcileTotalWithLines` and `buildQuoteFacts`. |
| 4 | Create deal: fast analysis | `POST /api/deal/create` → `analyzeDeal()` (`lib/claude/index.ts`) | Sonnet, `effort: low`, no thinking | LLM ×1 (`fast_analyze`) | Produces verdict, ≤3 flags, ≤3 leverage bullets, must-have asks, ≤2 savings items, `target_price_range`, `confidence`, and the `extraction` object the scorer needs. `title` and `score_rationale` / `quick_read.conclusion` are derived in code from the verdict. |
| 5 | Score | `computeScores()` (`lib/scoring.ts`) | none | code | Pricing / Terms / Leverage / Overall from step 4's `extraction`. Persisted as `score`, `score_breakdown`, `deductions`. **Computed once, here; never recomputed later.** |
| 6 | Persist Round 1 | same route | none | code | `rounds.output_json` (+ `generated_locale`), `extracted_data` (`toStructuredExtraction`), `extracted_text` (pasted text, else server-side pdf-parse/OCR of the file, best effort), `deals.deal_type` = the hard-coded `'New'` from the client. |
| 7 | Deal page (quick stage) | `app/app/deal/[dealId]/page.tsx` → `DealWorkspace` → `DealScrollView` | none | code | Render-time redaction: `stripFlagDetailForQuick` removes each flag's `what_to_ask_for` / `if_they_push_back` until the Playbook exists. Deal type shown = `snapshot.deal_type` (LLM string). `inferDealType()` runs server-side for the email route only. |
| 8 | Negotiation Playbook ("Deep Analysis") | `POST /api/deal/[dealId]/deep-analysis` → `analyzeDealFacts()` (`analyze.ts`) | Sonnet, `effort: medium`, no thinking; Haiku for `benchmark_input` when `quote_facts` are insufficient | LLM ×1–2 + code benchmark engine | Reuses persisted facts + `extracted_text`. Market benchmark: `benchmarkInputFromQuoteFacts` → `computeMarketBenchmark` (pure code) → injected into the prompt as authoritative → `clampInterpretation` forces the model's target inside the evidence band. **Merge keeps score / breakdown / extraction / verdict / target_price_range / snapshot from step 4 and replaces** `quick_read`, `red_flags`, `negotiation_plan`, `what_to_ask_for`, `potential_savings`, `cash_flow_improvements`, `watchItems`, `assumptions`, `price_insight`. Then `extracted_text` is set to null (retention). |
| 9 | Email | `POST /api/deal/regenerate-emails` | Sonnet, temperature 0.7, `max_tokens` 2000 | LLM ×1 (`email_regenerate`) | One call returns neutral / firm / final_push. Tone to show first = `recommendTone()` (code). Persisted to `output_json.email_drafts`, `email_context`, `email_recommended_tone`. Requires the deal to have a Playbook (`dealHasFullAnalysis`). Cap 3 regenerations per round (admins 99). |
| 10 | Round 2+ | `POST /api/deal/[dealId]/round` | Sonnet ×1 (`fast_analyze` again via `analyzeDeal`, with `previousRoundOutput`) + Sonnet ×1 (`round_delta`) | LLM ×2 + code | Vendor reply is analysed with the same fast pipeline (new score), `compareRounds` produces `round_delta` (sanitised in code), `extractVendorOffer` reads the vendor's figure deterministically with provenance. Max 6 rounds per deal. |
| 11 | Close | `POST /api/deal/[dealId]/close` | Sonnet ×1 (`close_summary`, won deals only) | code for the numbers, LLM for narrative | `deriveCloseOutcome`: savings = initial − final, floored at 0; requires a confirmed final total. Text purged again. |
| 12 | Translation (on demand) | `POST /api/deal/[dealId]/translate` | Haiku (`translate_output`) | LLM | Cached in `round_translations`; never rewrites `output_json`. |
| — | Anonymous `/try` | `POST /api/trial` | same as 4–5 | same | Same `analyzeDeal` + both strips. |

Dormant code, not called by any live route (only by the admin-only `/api/pipeline-compare`): `lib/claude/extract-rigid.ts`, `lib/claude/red-flags.ts` (15 rule-based flags), `lib/claude/score-deterministic.ts`, and the whole `lib/analysis/` v3 pipeline (`ANALYSIS_PIPELINE_V3 = false`). They are listed in §5.4 because they contain the rule-based detectors the live path lacks.

### 0.2 What is deterministic vs LLM

| Deterministic (code) | LLM |
|---|---|
| Total sanity (12×/2× override, line-sum reconciliation), `quote_facts` cross-checks, score and deductions, score band label, deal-type inference for emails, flag sort order and severity fallback, savings total on the page (sum of must-have amounts), hero "Target price" (= total − savings), estimated target rounding (`roundAnchor`), tone recommendation, email ask candidates (v1 only, not live), benchmark ranges/confidence/clamp, vendor-offer provenance, close savings arithmetic, retention purges, `title`. | Classification (type, size, recurring, leverage level, savings % range, approach), every extracted fact, the `extraction` object that feeds the score, verdict + `verdict_type`, all red flags (issue, severity, category, ask, fallback), "what's already solid", leverage bullets, trades, must/nice asks and their order, every savings amount and `target_price_range`, `confidence`, assumptions, watch items, cash-flow items, benchmark commentary (clamped), all three emails and which asks they include, round delta, close narrative, translation. |

### 0.3 What the user can override

| Input | Where | Effect |
|---|---|---|
| Deal type | **Nowhere.** `NewAnalysisClient.tsx` sends `dealType: 'New'` on every upload. | Every prompt receives `Deal Type: New`; `deals.deal_type = 'New'`; title says "New Purchase". The only renewal signals reach the UI via the LLM's `snapshot.deal_type` string and, for emails only, `inferDealType()`. |
| Goal / context text | New-analysis form (`goal`), round note (`note`) | Appended to the fast and deep prompts as `User Goal:` / `User Notes:`. |
| Negotiation preferences (`payment_terms`, `top_priority`, `auto_renewal`, `contract_term_strategy`) | Settings → `profiles.negotiation_preferences` | `buildPreferencesDirective()` — **applied in the deep prompt only.** `analyzeFastCore` receives `userPreferences` and never uses them. |
| Playbook trigger | Deal page | Runs step 8 (free during early access / first free / €29). |
| Email context: target outcome, budget ceiling, competing quote, walk-away flexibility (`flexible` / `prefer_stay` / `can_walk`), internal deadline, additional instructions | Deal page "Prepare your negotiation" | Injected into the email prompt (§8.6). Persisted on the round as `email_context`, carried to the next round. |
| Email subject and body | Inline editable textarea | Local edit only; not persisted. |
| Vendor offer figure (Round 2+) | `VendorOfferField` | `confirmVendorOffer()`; provenance can only rise to the ceiling computed at extraction. |
| Final total on close | `CloseDealModal` | Must be confirmed; savings derived in code. |
| Output language | `TranslateControl` | One-off cached translation. |
| Nothing else | — | No override of score, flags, severities, savings amounts, asks, classification, currency, or extracted numbers. |

---

## 1. Extraction schema

Two objects are extracted per quote. **A** = `ExtractedFacts` from `extract.ts` (Sonnet, `thinking: disabled`, `effort: low`, `max_tokens` 1024, temperature 0, language-agnostic). **B** = `extraction` inside the fast-analysis output (`fast-analyze.ts`), consumed only by the scorer. Both are LLM reads of the document; **A** is then cross-checked by `buildQuoteFacts()`.

Prompt A, verbatim field list:

> 1. vendor … 2. vendor_product … 3. category … 4. description … 5. term … 6. total_commitment … 7. contact_name … 7. billing_payment … 8. pricing_model … 9. currency: "USD", "EUR", "GBP", "CAD", "AUD" … 10. deal_type: "New purchase" or "Renewal" … 11. renewal_date: If stated, otherwise omit … 12. signing_deadline: If stated, otherwise omit … 13. main_line … 14. printed_line_totals … 15. term_months … 16. pricing_metric

> CRITICAL RULES FOR total_commitment: SEARCH for a stated total FIRST: "Net Amount Due", "Total", "Grand Total", "Total Contract Value", "Annual Total", "Montant Total", "Total HT", "Total TTC" … If you find a stated total, USE IT AS-IS. Do NOT multiply by anything … ONLY multiply by term if amounts are explicitly labeled "/month" or "per month" AND no total exists.

> STRUCTURED COMMERCIAL FACTS (optional — copy printed figures only, never compute) … Omit main_line entirely if the document shows only one total with no lines.

Hard requirement in code (`extract.ts`): `if (!parsed.vendor || !parsed.total_commitment) throw AI_VALIDATION_ERROR`.

### 1.1 Field table (what is pulled today)

Source column uses: text = the model reads it anywhere in the document; table = the model is told to copy a printed line; T&Cs = fine print. There is no separate table/T&Cs parser; every source is the same LLM read.

| Field | Type | Required | Source | Default if missing | Notes |
|---|---|---|---|---|---|
| `vendor` | string | **yes** (throws) | text | — | |
| `vendor_product` | string | no | text | `vendor` (deep-analysis route) | "Vendor / Product" format |
| `category` | string | no | text | — | free text, e.g. "SaaS - Security Awareness Training" |
| `description` | string | no | text | — | |
| `term` | string | no | text | `''` | free text; `termToMonths()` parses months/years/annual/monthly/quarter |
| `total_commitment` | string (money) | **yes** (throws) | text | — | then `normalizeAmount`, `validateTotalCommitment`, `reconcileTotalWithLines` |
| `contact_name` | string | no | text | — | first name only |
| `billing_payment` | string | no | text | `''` | e.g. "Net 30", "Annual upfront" — **this is where payment terms live** |
| `pricing_model` | string | no | text | `''` | |
| `currency` | enum USD/EUR/GBP/CAD/AUD | no | text | `'USD'` (`DealOutputSchema`) | **CHF / JPY are not in the enum: a quote extracted as "CHF" fails `DealOutputSchema.parse` → `AI_VALIDATION_ERROR` → HTTP 500** |
| `deal_type` | string "New purchase" / "Renewal" | no | text | `deals.deal_type` | LLM free string; `snapshot.deal_type` on the UI |
| `renewal_date` | string | no | text | omitted | any format; `getRenewalDate` uses `new Date(raw)` |
| `signing_deadline` | string | no | text | omitted | closest thing to **quote expiry** |
| `main_line.description` | string | no | table | null | highest-value printed line |
| `main_line.quantity` | number | no | table | null | seat / unit count |
| `main_line.unit_price` | number | no | table | null | **dropped by code unless `quantity × unit_price × multiplier` reproduces `line_total` or `total` within 5%** |
| `main_line.unit_period` | enum month/year/term/one_time | no | table | null | |
| `main_line.list_unit_price` | number | no | table | null | dropped if below `unit_price` |
| `main_line.line_total` | number | no | table | null | |
| `printed_line_totals` | number[] | no | table | null | sum → `printed_lines_sum`; used to reconcile the total |
| `term_months` | number | no | text | null | text term wins over the model number when they disagree |
| `pricing_metric` | enum (9 values) | no | text | null | dropped when a per-month/year metric conflicts with a per-term unit price |
| **B** `extraction.pricingItemized` | bool | no | text | `true` | |
| **B** `extraction.fees[]` | `{name, type admin/processing/gratuity/tax/other, percentage, dollarAmount, isAvoidable, isDisclosedAsNonService}` | no | text | `[]` | |
| **B** `extraction.cancellationTerms` | `{refundSchedule, buyerInsideWindow, retentionPctInsideWindow, forceMajeurePresent, rescheduleOption, rescheduleFeePct}` | no | T&Cs | `forceMajeurePresent: true`, `buyerInsideWindow: false`, others null/false | **auto-renewal and notice period have no field; they only appear inside the free-text `refundSchedule`** |
| **B** `extraction.paymentTerms` | `{depositPct, balanceDueDaysBeforeDelivery, achOffered, netTerms}` | no | T&Cs | nulls / `achOffered: false` | |
| **B** `extraction.vendorRights` | `{unilateralSubstitution, mandatoryMarketing, reciprocalValue}` | no | T&Cs | false / false / `reciprocalValue: true` | |
| **B** `extraction.tbdLineItems[]` | `{description, dollarAmount}` | no | table | `[]` | items with `dollarAmount ≤ 0` dropped |
| **B** `extraction.leverageFactors` | `{competingQuoteInHand, daysToDeadline, soleSource, dealSizeSignificant, buyerInsidePenaltyWindow}` | no | text + model judgement | all false, `daysToDeadline: null` | **`daysToDeadline` is the model's arithmetic, not the server clock** |

`normalizeExtraction()` comment, verbatim: "Defaults are conservative — when a fact is missing we assume the benign value (force majeure present, reciprocal value, pricing itemized) so absent data never invents a deduction."

### 1.2 Fields the brief asks for that are **not** extracted

| Requested field | Status today |
|---|---|
| Line items as a list (sku, qty, list, discount %, net, term months per line) | Not extracted. Only the single `main_line` plus `printed_line_totals` (numbers only). No SKU, no discount %, no per-line term. |
| Discount % | Not extracted as a field. Appears only in LLM prose (`price_insight`, flags). |
| Start / end dates | Not extracted. Only `renewal_date` and `signing_deadline` strings. |
| Quote created date | Not extracted. (The fixture's "November 13, 2025" exists only inside an LLM assumption sentence.) |
| Quote expiry | Only as `signing_deadline` (string). Never compared to today's date anywhere in code. |
| Payment terms | Free text `billing_payment` + `extraction.paymentTerms.netTerms` (number, scorer only). |
| Auto-renew flag | Not extracted. |
| Notice period | Not extracted. |
| Price-increase / uplift language | Not extracted. |
| Deal-type signals found in text | Only via `inferDealType()` keyword counts (§2.2), computed for the email route; never stored. |
| Tax / VAT status | Not extracted. |

### 1.3 Post-extraction code checks (`quote-facts.ts`, `validate-total.ts`)

- `validateTotalCommitment`: regex-scan the raw text for "net amount due / total amount due / grand total / total contract value / annual total / total commitment / total: / amount due"; if AI total ÷ stated total is in [10.5, 13.5] → replace (12× error); if in [1.8, 2.2] → replace (double count). Otherwise trust the AI.
- `reconcileTotalWithLines`: with ≥2 printed line totals whose sum differs from the AI total by >5%, replace the total **only if** the document prints that sum within 40 characters after "total / montant / amount due / somme"; otherwise keep and record a note.
- `buildQuoteFacts`: term text beats model `term_months`; `quantity × unit_price` must hit `line_total` or `total` (multipliers tried: term months, term/12, 1, 12) within 5% or the unit price is **dropped**; a unit price with no quantity is kept only if it equals a printed total (quantity := 1); list price below unit price is dropped; `checks.total = 'verified'` only when `printed_lines_sum ≈ total`.

Fixture result (stored `quote_facts`): `quantity 750 (unchecked)`, `unit_price null (dropped)`, note `"quantity 750 × unit 56.4 does not reproduce line_total 26182.5 or total 36330; unit price dropped"` — the model copied the **list** price ($56.40) into `unit_price`; the net price is $34.91. `list_unit_price` also dropped (no surviving unit price to compare). `term_months 24 (verified)`, `printed_lines_sum 36330`, `checks.total verified`, `pricing_metric per_seat_year` — although the printed Compliance Plus unit price ($13.53) covers the whole 24-month term.

---

## 2. Deal classification

There are **three unrelated deal-type signals** and no reconciliation between them.

### 2.1 Signal 1 — the hard-coded input

`NewAnalysisClient.tsx`: `dealType: 'New'` for every new analysis. Stored on `deals.deal_type`. Passed into every prompt as `Deal Type: New` (classify, extract, fast analysis, deep analysis, rounds). Used by `deep-analysis/route.ts` as the fallback `deal_type` and by the benchmark query (`dealTypeKey`). There is no "Renewal" option in the UI.

### 2.2 Signal 2 — the LLM string `snapshot.deal_type`

Extract prompt: `10. deal_type: "New purchase" or "Renewal"`. No trigger phrases are given to the model. Shown on the deal page snapshot ("Deal type"). Feeds `getDealType()` on Home. No confidence.

### 2.3 Signal 3 — `inferDealType()` (`lib/deal-type-inference.ts`, code, email route only)

Verbatim signal lists:

```
RENEWAL_SIGNALS = ['renewal','renew','extension','extend','existing subscription','current customer','co-term','coterm','renewal date','prior subscription','previous term','uplift','existing contract','existing agreement','anniversary date']
NEW_PURCHASE_SIGNALS = ['initial order','new subscription','implementation fee','onboarding fee','first year','initial term','new customer','welcome to','kickoff']
EXPANSION_SIGNALS = ['additional seats','additional licenses','incremental license','incremental seat','add-on','add on','upgrade','expansion','additional usage','additional capacity','increase in seats','seat increase']
```

Rules, in order (substring counts on `extracted_text.toLowerCase()`):

1. `expansionHits >= 2` → expansion (high); `expansionHits >= 1 && renewalHits === 0 && newHits === 0` → expansion (low).
2. snapshot says "renew" and (`renewalHits > 0` or `recurring === true`) → renewal (high).
3. snapshot says "new" (and not "renew") and (`newHits > 0` or `renewalHits === 0`) → new_purchase (high).
4. snapshot alone → renewal / new_purchase (low).
5. text only: more renewal hits → renewal (low); more new hits → new_purchase (low); `recurring` true → renewal (low); false → new_purchase (low).
6. else unknown (low).

Called from `page.tsx` as `inferDealType(snapshot.deal_type, undefined, latestRound.extracted_text)` — `recurring` is **always undefined**, and `extracted_text` is **null after the Playbook ran or the deal closed** (purged), so from that point rule 3 fires on `renewalHits === 0` and returns `new_purchase` / high for any snapshot that says "New purchase". Confidence is computed but **not passed** to the client (only `inferred.type`).

### 2.4 Classification proper (`classify.ts`, Haiku)

Produces `quote_type` (15 values), `deal_size_bracket`, `recurring`, `leverage_level`, `audience`, `savings_strategy {target_percent_min, target_percent_max, approach, rationale}`. Verbatim leverage rule:

> "high" = Large deal, multiple alternatives exist, buyer has volume, or it's a renewal (vendor doesn't want to lose you) … "unclear" = Not enough info to determine

Verbatim savings guideline rows relevant to SaaS: `saas + recurring + medium+ deal: 10-20%`, `saas + recurring + renewal: 15-25%`, `Renewal with incumbent = add 5% to range`.

Zod `.catch` defaults when the model returns an invalid value: `quote_type → 'professional_services'`, `deal_size_bracket → 'medium'`, `recurring → false`, `leverage_level → 'medium'`, `audience → 'business'`, `savings_strategy → {5, 15, package_discount}`.

**PDF inputs:** `classify.ts` comment: "Haiku doesn't support PDF document input — for PDFs, classify from text only". The user prompt becomes `Classify this quote:\n(see attached document)` with nothing attached, because the browser sends `extractedText: ''` for files. Telemetry confirms a constant ~1,384 input tokens per classify call regardless of the document.

Fixture (stored `classification`): `quote_type: professional_services`, `recurring: false`, `leverage_level: unclear`, `deal_size_bracket: medium`, `savings_strategy: {0, 0, competitive_leverage, "Unable to classify without access to the attached document."}`. Consequences downstream: the **professional-services overlay** (not the SaaS one) was appended to both analysis prompts, and the savings frame read "Expected realistic savings ceiling for this quote type and deal shape: 0-0%".

### 2.5 Conflict handling

None. Fixture: `deals.deal_type = New`, `snapshot.deal_type = "New purchase"`, title "New Purchase", `classification.recurring = false`, while the deep pass wrote a watch item: "The quote notes 'Sub end date: 11th Jan 2026' … may indicate an existing subscription expiring imminently". "sub end date" matches none of the renewal signals, so `inferDealType` = new_purchase (high) and the email prompt received: "This is a NEW PURCHASE — the buyer is not yet a customer. Frame asks around new-logo competitive pressure and fast-signature leverage."

### 2.6 What classification changes

| Consumer | Uses |
|---|---|
| Fast + deep prompts | `QUOTE_TYPE_OVERLAYS[quote_type]` (domain heuristics + "type-specific red flags"), `buildSavingsDirective` (the % range, plus a multi-year hint only when `recurring` and bracket ≥ medium), `buildClassificationContext` (all fields echoed). |
| Score | **Nothing.** `computeScores` never reads classification. |
| Email | `leverage_level` → `recommendTone()`; `inferredDealType` → the three `dealTypeContext` sentences. |
| Leverage bullets | LLM-written; classification is only context. |
| Benchmark | `quote_type` as category, `deal_size_bracket` stored on the query. |
| Home category chip | `normalizeCategory(output.category)` — regex on the free-text category, not on `quote_type`. |

---

## 3. Quote hygiene / hard stops

### 3.1 What actually blocks

| Condition | Where | Effect |
|---|---|---|
| Text < 10 chars and no file | `CreateDealSchema.refine` | 400 before any model call. |
| Extraction returns no `vendor` or no `total_commitment` | `extract.ts` | `AI_VALIDATION_ERROR` → retried up to 3× (`withRetry`) → 500 "The AI response was incomplete. Please try again." |
| `currency` outside USD/EUR/GBP/CAD/AUD | `DealOutputSchema.parse` | ZodError → `AI_VALIDATION_ERROR` → 500. |
| Fast analysis missing `verdict` or `what_to_ask_for`, or truncated at `max_tokens` (3072) | `fast-analyze.ts` | `AI_VALIDATION_ERROR` / `AI_PARSE_ERROR` → retry → 500. |
| Deep analysis with no `extracted_text` (legacy or purged) | `deep-analysis/route.ts` | 422: "…the Negotiation Playbook can't be built on it. Start a new analysis with the same quote to unlock it." |
| Round 2+ without a Playbook; > 6 rounds | `round/route.ts` | 403 / 429. |
| Email without a Playbook; > 3 regenerations | `regenerate-emails/route.ts` | 403 / 429. |
| Won close without a confirmed final total | `deriveCloseOutcome` | 400. |
| Rate limits / free quota (4 free analyses) | `checkRateLimit`, `checkFreeQuota` | 429. |

### 3.2 What is a banner, footnote, or nothing

| Hygiene concern | Rule today | Surface |
|---|---|---|
| Expired quote / past signing deadline | **No rule.** `signing_deadline` is a string; no code compares it to today. `daysToDeadline` is whatever the model wrote. | Snapshot row "Signing deadline: Jan 31, 2026" rendered without warning. Leverage bullet still says the rep "needs this closed". |
| Missing T&Cs | No rule. | Fixture: deep-pass watch item "KnowBe4's Terms of Service govern the agreement by reference … not attached". Collapsed under "Show 4 minor items". |
| Missing quantity | `quote_facts.quantity = null`, `checks.quantity = 'dropped'`; benchmark falls back to Haiku `benchmark_input`. | Nothing user-facing. |
| Unverifiable unit price | Dropped (see §1.3). | Nothing user-facing; benchmark loses the unit basis. |
| Tax / VAT unknown | No rule. | Fixture: watch item + assumption text from the LLM only. |
| Stale SKU / generation change | No rule; no SKU field. | — |
| Currency mismatch across rounds | `extractVendorOffer` records `checks.currency = 'mismatch'` and a note. | Note stored on the offer; no banner. |
| Total corrected by code | `quote_facts.checks.total = 'corrected'`, note appended. | Not shown. |
| "Not enough observed pricing data" | `benchmark_available = false`. | One line under the tiles: "TermLift doesn't yet have enough observed pricing data for this vendor. Targets are estimated from the quote and commercial terms." Benchmark section hidden (`shouldRenderBenchmark`). |

### 3.3 What the UI still allows after a blocker

Nothing is a blocker after Round 1 exists. With an expired quote, missing T&Cs or unverified quantity the user can still build the Playbook, generate and copy all three emails, add rounds, and close the deal as won with any confirmed final total.

---

## 4. Scoring rubric

Source: `lib/scoring.ts`. Constants: `FEE_STACK_CAP = 40`, `TBD_ITEM_CAP = 15`, `FLOOR = 5`, `LEVERAGE_NEUTRAL = 50`, `LEVERAGE_MIN = 5`, `LEVERAGE_MAX = 95`, `WEIGHTS = { pricing: 0.4, terms: 0.35, leverage: 0.25 }`.

Inputs: only the fast pass's `extraction` object (normalised) and `contractTotal = parseMoney(rawFacts.total_commitment).amount`. **Red flags, severities, classification, savings, deal type, dates and the deep analysis never touch the score.**

### 4.1 Pricing (start 100, floor 5)

| Rule | Points |
|---|---|
| Each fee with `isAvoidable || isDisclosedAsNonService` and a positive % (or `dollarAmount / subtotal × 100`) | `−2 × pct`, whole stack capped at −40 |
| Each TBD item with `dollarAmount > 0` | `−min(15, dollarAmount / contractTotal × 100)` |
| `pricingItemized === false` | −10 |

Nothing about discount depth, list-vs-net, seat count, uplift, or benchmark position.

### 4.2 Terms (start 100, floor 5)

| Rule | Points |
|---|---|
| `buyerInsideWindow && retentionPctInsideWindow >= 100` | −25 |
| `buyerInsideWindow && 0 < retentionPctInsideWindow < 100` | −15 |
| `forceMajeurePresent === false` | −10 |
| `unilateralSubstitution` | −10 |
| `mandatoryMarketing && !reciprocalValue` | −10 |
| `depositPct > 40 && balanceDueDaysBeforeDelivery > 7` | −10 |

Nothing about auto-renewal, notice period, price escalation, exit rights, liability, or term length. Maximum possible Terms deduction is −75 only if every field is adverse; for a typical SaaS quote the only reachable deduction is force majeure (−10).

### 4.3 Leverage (start 50, clamp 5–95)

| Rule | Points |
|---|---|
| `competingQuoteInHand` | +20 |
| `dealSizeSignificant` | +10 |
| `buyerInsidePenaltyWindow` | −20 |
| `soleSource` | −15 |
| `daysToDeadline > 30` | +10 |
| `daysToDeadline < 14` | −10 |

### 4.4 Overall and label

`overall = round(pricing × 0.4 + terms × 0.35 + leverage × 0.25)`. Bands (`scoreHeadline` / `scoreLabel`): ≥80 "Solid quote — small gains still on the table"; ≥65 "Decent quote — push on a few points"; ≥45 "Real leverage — negotiate before signing"; ≥25 "Weak quote — serious issues to fix first"; else "Don't sign this as it stands".

### 4.5 Caps, floors, and the flag question

- Caps: fee stack −40; each TBD −15; floors 5; leverage 5–95.
- **Can Terms stay at 90 with an uncapped uplift flag?** Yes. There is no uplift, auto-renew or notice field. Terms = 100 − 10 (no force majeure) = 90 regardless of the flag.
- **Must adding a HIGH flag move the score?** No. Flags and score are produced by the same LLM call but are independent outputs; the deep pass replaces the flag list without touching the score. The `score_category` on each flag is stored and never read by the scorer (it is only used to group nothing; the breakdown groups by `deductions[].category`).
- The scorer is clock-free by design ("no randomness, no clock, no I/O"), so a past deadline can still earn +10.

### 4.6 Worked example — KnowBe4 fixture (stored values)

`extraction` as returned by the fast pass on 2026-09-10:

```
pricingItemized: true            fees: []                tbdLineItems: []
cancellationTerms: { buyerInsideWindow: false, retentionPctInsideWindow: null, forceMajeurePresent: false,
                     refundSchedule: "Not specified; auto-renews unless 90-day written notice given before term end" }
vendorRights: { unilateralSubstitution: false, mandatoryMarketing: false, reciprocalValue: false }
paymentTerms: { depositPct: 0, balanceDueDaysBeforeDelivery: 0, netTerms: 30, achOffered: null }
leverageFactors: { competingQuoteInHand: false, daysToDeadline: 79, soleSource: false, dealSizeSignificant: true, buyerInsidePenaltyWindow: false }
contractTotal = parseMoney("$36,330") = 36330
```

Pricing: no fees, no TBD, itemized → **100**.
Terms: `buyerInsideWindow` false → 0; `forceMajeurePresent` false → −10; substitution false → 0; `mandatoryMarketing` false (so `reciprocalValue: false` is ignored) → 0; deposit 0 → 0. 100 − 10 = **90**.
Leverage: 50 + 10 (`dealSizeSignificant`) + 10 (`daysToDeadline` 79 > 30) = **70**.
Overall: 100 × 0.4 + 90 × 0.35 + 70 × 0.25 = 40 + 31.5 + 17.5 = **89** → "Solid quote — small gains still on the table". Matches the stored `score: 89` and `deductions` exactly.

Where 79 came from — stored assumption, verbatim: "Daystoadeadline calculated from November 13, 2025 (quote creation date) to January 31, 2026 expiration." On the analysis date the deadline was 222 days in the past. Had the model used the server date: `daysToDeadline = −222 < 14` → −10 → leverage 50 → overall 40 + 31.5 + 12.5 = 84, still "Solid".

What the 24-month auto-renew, 90-day notice and "minimum 4%" uplift contribute to the score: **0 points**, because none of them is a scorer input. What the two HIGH terms flags contribute: **0 points**.

---

## 5. Flag taxonomy

### 5.1 The live detector is one LLM call

There is no flag catalogue in the live path. The fast prompt asks for ≤3 flags; the deep prompt asks for "every item that passes" an actionable + material test. The only enumerations are the `type` list and the severity rubric.

`type` enum (both prompts): `Commercial | Renewal | Scope | Payment Terms | Source Insight | Implementation | Usage Risk | Deposit | Bundling`. `score_category`: `pricing | terms | leverage`. Severity, verbatim from the deep prompt:

> HIGH = financial exposure or a one-sided term affecting MORE THAN 5% of contract value, or total cancellation exposure. MEDIUM = 1-5% of contract value, or a meaningful operational risk. LOW = under 1% of contract value, or a convenience issue. ALWAYS HIGH, regardless of dollar amount: any fraud indicator — changed banking or payment details, a changed contracting entity, or any request to redirect payment.

The fast prompt gives **no** severity rubric; the model picks freely. `getFlagSeverity()` (code) trusts the model's value and, only when absent, falls back to the largest currency amount in `why_it_matters` (≥5,000 high, ≥1,000 medium).

Materiality test (deep prompt, verbatim): "An item is a RED FLAG only if it passes BOTH tests: 1. ACTIONABLE — there is a concrete ask that changes the outcome … 2. MATERIAL — it affects MORE THAN 1% of contract value, OR it creates legal/financial exposure … Pure observations are NOT red flags … goes into watchItems instead."

Forced flag (deep prompt): "Is the vendor a broker, reseller, dealer, or intermediary? If yes … ALWAYS flag this as a 'Source Insight' red flag."

Deep prompt rule linking flags to money: "If a red flag has a dollar impact, it MUST also appear as a savings item."

### 5.2 Table — flag types as the live system can emit them

Because detection is free-form, the table is per `type`, with the evidence, ask, fallback and $ formula as **the prompts instruct** (no code enforces any of it). "Applies to" is `New | Renewal | both`; the prompt never restricts by deal type.

| id | name (type) | severity | detector | evidence required | must-have vs nice-to-have | default ask | default fallback | estimated $ impact formula | applies to |
|---|---|---|---|---|---|---|---|---|---|
| `Commercial` | Commercial (price, discount depth, fees, add-on parity, multi-year premium) | model-chosen (rubric §5.1) | LLM | "Every amount must trace to the quote or simple arithmetic on quote numbers" | model-chosen; must-have items "count toward the headline number" | model-written `what_to_ask_for` | model-written `if_they_push_back` | none in code; prompt: "Your savings ask MUST reflect the actual margin you identify" | both |
| `Renewal` | Renewal (auto-renew, notice, escalation, lock-in) | model-chosen | LLM | same | same | same | same | none | both |
| `Scope` | Scope (vague scope, missing SLA, deliverables) | model-chosen | LLM | same | same | same | same | none | both |
| `Payment Terms` | Payment Terms | model-chosen | LLM | same | "Payment term improvements are NOT savings. They go in cash_flow_improvements" | same | same | none | both |
| `Source Insight` | Intermediary / reseller margin | model-chosen ("ALWAYS flag" when intermediary) | LLM | dealer/broker/reseller identified in text | same | prompt heuristic: "dealers typically carry roughly 10-25% margin … phrase … as an estimate" | same | none | both |
| `Implementation` | Implementation / onboarding charges | model-chosen | LLM | same | same | same | same | none | both |
| `Usage Risk` | Seats / capacity vs need | model-chosen | LLM | deep prompt: "never assert a specific count of 'unused' seats … Phrase it as a question … or a conditional hypothesis" | same | same | same | none | both |
| `Deposit` | Deposit / prepayment | model-chosen | LLM | same | same | same | same | none | both |
| `Bundling` | Bundled modules / transparency | model-chosen | LLM | same | same | same | same | none | both |

Fraud indicators are "ALWAYS HIGH" but have no `type` of their own.

Fixture flags (deep pass, stored): Renewal/high "90-day written cancellation notice"; Renewal/high "Minimum 4% compounded annual fee escalation"; Commercial/medium "Compliance Plus discount (30.85%) is materially lower than the KSAT discount (38.1%)"; Usage Risk/medium "750 seats provisioned with no confirmation of actual headcount"; Commercial/medium "No additional discount requested for the 24-month commitment length". The fast pass had produced 3 flags; the deep merge replaced them.

### 5.3 Flags that should exist but are not implemented in the live path

| Missing flag | Status |
|---|---|
| Expired quote / past validity date | Not implemented anywhere live. The dormant `red-flags.ts` has rule 10 ("Signing deadline has passed … This removes time pressure", Leverage/low, 0 points) and rule 11 ("Quote expires in N days", ≤7 days) — both unused. |
| Incumbent / renewal language ("Sub end date", "existing subscription") | Not implemented. `inferDealType` counts renewal words for the email only; no flag, no score effect. |
| Seat count vs headcount / utilisation | Not implemented as a rule. Dormant rule 6 needs `seats_or_units_active`, which nothing extracts. The live path leaves it to the model ("Usage Risk"). |
| SKU generation change / stale SKU | Not implemented; no SKU field. |
| Auto-renewal with short or long notice (as a rule) | Not implemented live. Dormant rule 1 exists (≤30 days high, ≤60 medium, unspecified medium). |
| Price escalation cap / uncapped uplift (as a rule) | Not implemented live. Dormant rule 2 exists (cap >5% high, >3% medium, no cap high). |
| No exit clause on >12-month term | Dormant rule 3 only. |
| Annual upfront with no prepayment discount | Dormant rule 8 only. |
| Missing T&Cs / terms by reference | Not implemented; LLM watch item at best. |
| Currency not in enum | Not a flag; a crash (§3.1). |

### 5.4 Dormant rule-based catalogue (`lib/claude/red-flags.ts`, not wired)

For completeness, the 15 code rules that exist but are never called: auto-renewal notice (≤30 d high / ≤60 d medium / unspecified medium; 10/6/6 pts), price escalation (cap >5% high 10, >3% medium 5, no cap high 12), no exit clause (>12 mo high 10, =12 mo medium 5), exclusivity (medium 7), no SLA on services (medium 5), unused seats ≥20% waste (high if ≥35% 12, else 7), intermediary (medium 6), upfront with no discount (low 3), deposit required (low 3), signing deadline ≤7 days (medium 4) / passed (low 0), quote expires ≤7 days (low 2), non-compete (medium 5), payment terms not stated (low 2), vague scope on >10k (medium 6), no liability cap on >20k ongoing (low 3). These depend on `extractRigid()` fields (`auto_renewal_notice_days`, `price_escalation_cap_percent`, `exit_clause_exists`, `quote_valid_until`, …) that the live extraction does not produce.

---

## 6. Savings engine

### 6.1 Who computes what

| Quantity | Producer | Rule |
|---|---|---|
| Each savings item `{ask, amount, rationale}` | LLM | Fast: "2 must_have items MAXIMUM … low/high range: most conservative defensible number as low, most aggressive still-defensible number as high". Deep: uncapped; "Be aggressive … Always ask for a discount on the headline price (5% minimum on any negotiated quote)"; "Savings amounts must be annual for recurring deals, total for one-time purchases." |
| `potential_savings.total` | code after the fast pass: `ps.total = sum(must_have.amount)`; guard `if savings > contractTotal → console.warn` only. After the deep pass: **not recomputed** (the LLM's total is stored as-is). | |
| Page "Savings impact" total | code (`DealScrollView.savingsData`): sum of must-have amounts; display % = `min(round(total / dealTotal × 100), 50)` | |
| Home / header "Savings potential" | code (`getPotentialSavings`): sum of `must_have.amount`, else `total`, else legacy shapes | |
| Hero savings tile (quick stage) | `range.high` if `potential_savings.low/high` exist → "up to $X · low – high realistic range" | fast pass only; the deep pass drops `low/high` |
| Hero **Target price** (Playbook exists) | code: `fmtMoney(totalNum − potential)` = quote total − sum of must-have amounts | |
| Hero **Estimated target** (quick stage) | code: `≈ roundAnchor(totalNum − (range.high ?? potential))` — nearest 100 under 20k, 500 under 200k, 1,000 above | |
| `target_price_range {low, high}` | LLM (fast pass), kept through the deep merge, **not displayed**; passed to the email prompt as "Realistic target price range" | |
| Benchmark target / opening ask | LLM proposal clamped by code into `[strong_outcome_low, fair_market_high]`; nulled when `benchmark_available` is false | |
| Email anchor | LLM, instructed: "round it to a clean figure … nearest 500 below 200,000" | |

### 6.2 Order of operations

There is none. The prompt lists levers ("quantity correction, modest package discount, setup fee reduction, module removal, renewal cap or price freeze, usage cap" for SaaS; "Right-size quantity … Challenge intermediary margin … Push for volume, loyalty, early-payment, or multi-year discounts") without precedence. Seat cut vs unit discount vs add-on parity vs term swap are whatever the model lists, in the order it lists them.

### 6.3 Stacking and double counting

No code checks overlap. The deep prompt says "Each challengeable element is a SEPARATE item. Do not merge them." and "If a red flag has a dollar impact, it MUST also appear as a savings item." Fixture must-haves: (1) "5% discount on total contract value" = **$1,817** (5% × 36,330 = 1,816.5) and (2) "Match Compliance Plus discount to KSAT rate" = **$1,073** (750 × (13.53 − 12.10) = 1,072.5). Item 1 is 5% of a total that still contains the Compliance Plus line, so applying both double-counts 5% × 1,073 ≈ **$54**. Nice-to-have (3) "Right-size seat count if headcount is below 750" = $1,206 (50 seats × $2.01 × 12; the flag's own text says "every 50 excess seats", i.e. a hypothetical count) is quantified despite the prompt rule against asserting unused seats.

### 6.4 Cash-now vs renewal TCO

Not modelled. The system produces a single "savings" figure against the quoted total; there is no Year 3 / Year 4 or renewal-term computation anywhere in code. The only uplift arithmetic in the fixture is LLM prose: "the next 24-month term starts at roughly $38,000+". For the reviewer, the arithmetic the system does **not** do: annualised $18,165; at the stated minimum 4%/yr compounding from the current rate, Year 3 ≈ 18,165 × 1.04² = **$19,647**, Year 4 ≈ **$20,433**; renewal term (Y3+Y4) ≈ **$40,080** before any discretionary increase, versus $36,330 today. None of this reaches a tile, a flag amount, or the score.

### 6.5 When vendor comps are missing

`runBenchmark`: fewer than 3 same-vendor same-product comparables (levels 1–2), or effective weight < 1.2, or no comparable basis → `benchmark_available: false` with `reason`. `clampInterpretation` then nulls `target_price` and `opening_ask`. UI: benchmark section hidden; one-line note "TermLift doesn't yet have enough observed pricing data for this vendor. Targets are estimated from the quote and commercial terms." The email prompt then falls back to `target_price_range` from the fast pass. Fixture: `comparable_count: 0`, `reason: "Insufficient comparable market data: no same-vendor, same-product observations."`, interpretation `target_price: null`.

### 6.6 Why Pricing can be 100 while a savings number prints

Pricing only loses points for avoidable fees, TBD lines and non-itemised pricing (§4.1). Discount depth, add-on parity, multi-year premium, seat right-sizing and uplift are savings levers the LLM writes about but the scorer has no input for. So a clean, itemised, fee-free quote scores Pricing 100 and still carries $2,889 of "must-have" savings and a $33,441 target. Fixture: Pricing 100, savings $2,889 (8.0% of total), target = 36,330 − 2,889 = **$33,441**.

---

## 7. Playbook composer

### 7.1 Ordering

`what_to_ask_for.must_have` and `nice_to_have` are rendered **in the LLM's array order**, numbered 1…n, then "+" items (`DealScrollView`, "Push for"). No code sorts, dedupes or caps them. Fast prompt: "must_have: pull directly from the red flags' asks … Do not add asks unrelated to a red flag unless it's the standard baseline discount ask." Deep prompt: no ordering instruction at all.

Red flags are sorted in code by severity (HIGH → MEDIUM → LOW, stable within a band).

### 7.2 Must-have vs stretch

Deep prompt, verbatim: "must_have: you would put this in a negotiation email. It counts toward the headline number. nice_to_have: worth asking but not the main battle. Shown separately." There are two parallel lists — `what_to_ask_for.{must_have,nice_to_have}` (strings) and `potential_savings.{must_have,nice_to_have}` (amounts) — with no key linking them; `buildCandidateAsks` (v1 email path, not live) matches them by index, then by ≥0.4 token overlap.

### 7.3 Leverage bullets

`negotiation_plan.leverage_you_have`: fast pass "MAXIMUM 3 — short phrases"; deep pass uncapped, no rule. Rendered verbatim under "Your leverage". Fixture has 5, including "Quote expires January 31, 2026 — the rep needs this closed before quarter or year-end" (222 days after the fact) and "New purchase, not a renewal — KnowBe4 has not yet earned loyalty".

### 7.4 "What's already solid"

`quick_read.whats_solid`: fast pass "max 2 short bullets, phrases not sentences"; deep pass replaces it with its own uncapped list. No code compares it with the flags, so it **can contradict a flag**. Fixture: solid #1 "24-month term locks in pricing and gives the buyer leverage to negotiate a steeper upfront discount" vs flag #5 "No additional discount requested for the 24-month commitment length".

### 7.5 Maximum asks in Round 1

Playbook: unlimited (fixture: 5 must-have + 3 nice-to-have). Email: see §8.3 — the rules say 3, the route prompt says "3-4".

### 7.6 Which asks may reach the email

All of them are offered. `DealScrollView.handleGenerate` sends `mustHaveAsks` + `niceToHaveAsks` + `redFlagAsks` (every flag's `what_to_ask_for`); the route concatenates them into "ALL AVAILABLE ASKS" without dedupe. Selection is entirely the model's, guided by `EMAIL_RULES` §"SELECTION LOGIC" (§8.3). `buildCandidateAsks` / `defaultSelectedLabels` (HIGH first, then largest savings, top 3) exist but are only used by `generateEmailDrafts`, which no route calls.

---

## 8. Email composer

Live path: `regenerate-emails/route.ts` builds `basePrompt`; system = `KEVIN_SYSTEM_PROMPT + language instruction`; Sonnet, temperature 0.7, `max_tokens` 2000; expects `{ emails: [ {label, subject, body} ×3 ] }`. The only validation is "3 emails present"; nothing checks content.

### 8.1 Template slots (`EMAIL_RULES` → STRUCTURE, verbatim)

> 1. "Hi [Name]," — use first name if known, otherwise "Hi,"
> 2. "Hope all is well" or "Thanks for getting back to me / for sharing the proposal."
> 3. Quick context: "After discussing internally…" / "Following our call…" / "I reviewed this on my side…"
> 4. Main ask: updated quote, discount, documents, clarification, contract change, signature step.
> 5. Explain why: budget, legal review, internal approval, security review, deadline, scope alignment.
> 6. Close: "Thanks in advance", "Please let me know", "From there I should be able to move forward."

Sign-off: "Best regards," + `SENDER NAME` (from `profiles.contact_name`, else "[Your Name]"). Subject: "Vendor name + plain reference … Nothing clever." Length "120–180 words. Never over 220." No lists, no enumeration, no dashes. `[DATE]` placeholders are replaced client-side with the 5th business day from today.

### 8.2 Tone rules (verbatim)

> neutral: Kevin's default opening move. Warm, collaborative, polite. … firm: Kevin being direct when needed. Clear asks, no hedging, still respectful. … final_push: Kevin going for the last squeeze. Deadline-driven, signals momentum, frames the decision clearly. … Urgent but never aggressive.

Which one opens by default — `recommendTone()` (code): `can_walk` or (`internalDeadline` and leverage high) → final_push; leverage high or `highSeverityFlagCount >= 2` → firm; renewal with low/unclear/no leverage → neutral; `prefer_stay` → neutral; else neutral. Fixture: leverage `unclear`, 2 HIGH flags → **firm** (stored `email_recommended_tone: firm`).

### 8.3 Mandatory playbook items

None are mandatory in code. Rules given to the model: "Pick the 3 most commercially important ones. Rank … 1. Price / discount / cost reduction (always the top ask if present) 2. Payment terms … 3. Signature blockers … 4. Missing documents … 5. Contractual ambiguity … 6. Scope mismatch … 7. Timeline"; "Maximum 3 asks per email"; but the route's own line says "pick the 3-4 most commercially important ones". The route also injects: "Never suggest a longer contract term than what is in the quote unless … the user preferences say to push longer."

### 8.4 "New customer" wording

There is **no rule** forbidding "new customer" / "new logo". The only deal-type input is the `dealTypeContext` sentence, injected when `inferredDealType` is not `unknown` (§2.3); confidence is not consulted. Fixture: new_purchase (high, because the purged text yields zero renewal hits) → "frame asks around new-logo competitive pressure". All three stored drafts say "as a new customer" / "We are a new logo".

### 8.5 Subject, AE name, quote number, deadline

| Item | Required? |
|---|---|
| Subject | Yes — part of the JSON shape; rule "plain and specific". |
| AE / contact first name | Used if `contact_name` was extracted ("Use 'Hi {name},' in every email"); otherwise "Hi,". Fixture: not extracted → "Hi,". |
| Quote number | Never extracted, never passed. |
| Deadline | Only if the user typed `internalDeadline`; the quote's own `signing_deadline` is **not** passed to the email prompt. |

### 8.6 User context overrides (route prompt, verbatim fragments)

- `negotiationObjective` → "BUYER'S STATED OBJECTIVE FOR THIS NEGOTIATION: …"
- `budgetCeiling` → "BUYER'S BUDGET CEILING: … negotiate toward this, but do not reveal the exact ceiling number to the supplier unless it naturally helps close"
- `competingQuote` → "COMPETING QUOTE / ALTERNATIVE THE BUYER HAS: … this is real leverage; reference it naturally and factually, do not exaggerate or invent details"
- `walkAwayFlexibility` → one of three sentences (`flexible` / `prefer_stay` "do not frame the email as a threat to leave" / `can_walk` "genuine leverage, but stay professional, do not bluff")
- `internalDeadline` → "use this to create realistic urgency where it fits"
- `additionalInstructions` → "ADDITIONAL INSTRUCTIONS FROM THE BUYER (honor these)"; `customPrompt` → "USER'S CUSTOM REQUEST (honor this above all else)"
- Benchmark (when available) → "INTERNAL PRICE TARGET … NEVER write 'TermLift', 'benchmark', 'our data'"; else `target_price_range` → "Realistic target price range: low–high — push toward this range"
- `potentialSavingsTotal` → "this is the internal estimate, not a number to quote directly to the supplier"

Guard rails (`EMAIL_RULES`): "Never mention TermLift, AI, 'score', 'red flag', 'leverage level'"; "Do not invent facts, figures, or claims not present in the deal context provided (e.g. a competing quote, a budget figure, a deadline)". Fixture firm draft nevertheless says "we are also looking at alternatives" with `competingQuote: null`.

---

## 9. Known contradictions to resolve (KnowBe4 fixture)

Review notes. Each item cites the stored round and the rule that produced it.

1. **Score 89 "Solid quote" beside two HIGH terms flags.** Score came from the fast pass's `extraction` (only deduction: no force majeure); the deep pass added Renewal/high ×2 without any path to the score (§4.5). Terms sits at 90 with a 90-day notice and an uncapped "minimum 4%" uplift.

2. **Classification is empty for this PDF.** `quote_type: professional_services`, `recurring: false`, `leverage_level: unclear`, savings target **0–0%**, rationale "Unable to classify without access to the attached document." Haiku never saw the file (§2.4). Both analysis prompts therefore carried the professional-services overlay and "Expected realistic savings ceiling … 0-0%", while `category` (from the Sonnet extract) says "SaaS - Security Awareness Training".

3. **New-logo framing vs "Sub end date: 11th Jan 2026".** `deals.deal_type` hard-coded New; `snapshot.deal_type` "New purchase"; title "New Purchase"; leverage bullet "New purchase, not a renewal"; emails "as a new customer"; while the deep pass's own watch item raises a possible existing subscription. `inferDealType` ran on purged text → new_purchase/high.

4. **Three different targets.** Hero "Target price" **$33,441** (= 36,330 − 2,889, `DealWorkspace`); fast-pass `target_price_range` **34,513–35,240** (kept, unseen, sent to the email prompt); emails anchor on **$34,500** (the 5%-only ask, rounded per the "nearest 500" rule); benchmark target **null**. The reviewer's "$33,440" is the hero figure; the exact stored arithmetic gives $33,441.

5. **"24-month term … gives the buyer leverage to negotiate a steeper upfront discount" (already solid #1) vs flag #5 "No additional discount requested for the 24-month commitment length" and must-have #1 "Additional 5% discount … in recognition of the 24-month commitment".** Same document, same pass, opposite reads (§7.4).

6. **Deadline in the past treated as live leverage.** `signing_deadline` "January 31, 2026" on a 2026-09-10 analysis: no expiry rule (§3.2); `daysToDeadline: 79` computed from the quote date (model's own assumption) → +10 leverage; leverage bullet "Quote expires January 31, 2026 — the rep needs this closed before quarter or year-end"; final_push draft "we should be ready to sign shortly".

7. **Flag #3 disagrees with itself.** `why_it_matters`: "Closing the gap … would save approximately $730"; `what_to_ask_for`: "saving roughly $1,073 over the term". Both numbers are LLM arithmetic; the savings item uses $1,073.

8. **Savings items overlap.** 5% of the whole total ($1,817) plus Compliance Plus parity ($1,073) double-count ≈ $54; the nice-to-have "$1,206" is a hypothetical 50-seat reduction the prompt says not to assert (§6.3).

9. **`quote_facts` dropped the unit price because the model copied the list price.** `unit 56.4` (list) vs net $34.91; `pricing_metric per_seat_year` while the printed $13.53 covers 24 months; assumption "Billing cadence … assumed to be annual". The benchmark query therefore had no unit basis.

10. **Leverage 70 from "Deal size significant" while classification says leverage `unclear` and 0% savings potential.** Two independent LLM judgements, one of which is scored.

11. **Watch items hide the material hygiene facts.** Terms by reference, PO-terms superseded, VAT between FR buyer and NL vendor, and the sub-end-date signal are all under "Show 4 minor items", ranked below a $54 double count.

12. **Email invents softness.** Firm draft: "we are also looking at alternatives" with no competing quote supplied, against the rule "Do not invent … a competing quote".

13. **`potential_savings.total` after the deep merge is the model's number, not recomputed** (§6.1). Here it happens to equal the sum (2,889); nothing guarantees it.

14. **User preferences never reach the fast pass** (§0.3), so Round 1 and every vendor-reply round ignore `auto_renewal: prefer_opt_in` and `contract_term_strategy` settings; only the Playbook respects them.

---

## 10. Change list (do not implement)

Review notes, ranked. "Section" = where the rule would live in this document.

| # | Problem | Rule to add | Section | Expected effect on the KnowBe4 fixture |
|---|---|---|---|---|
| 1 | Classification runs blind on PDF uploads | Give `classifyQuote` the server-side extracted text (`textForPersistence` output) or route PDFs to a model that accepts documents; reject a classification whose `rationale` says it could not read the document and fall back to the extract's `category`. | §2.4 | `quote_type: saas`, `recurring: true`, savings frame 10–20% instead of 0–0%; SaaS overlay applied; tone/leverage inputs become meaningful. |
| 2 | Auto-renew, notice period and uplift are not scorer inputs | Add `renewalTerms {autoRenew: bool, noticeDays: number|null, escalationMinPct: number|null, escalationCapPct: number|null, discretionaryIncrease: bool}` to the `extraction` object; Terms deductions: auto-renew with notice > 60 d −10; notice unspecified −5; escalation with no cap −15, min ≥4% −5. | §1.1, §4.2 | Terms 90 → 60 (−10 notice, −15 no cap, −5 min 4%); overall 89 → 78.5 ≈ **79** ("Decent quote — push on a few points"). |
| 3 | Deep-pass flags cannot move the score | After the deep merge, recompute Terms/Leverage from a merged extraction, and add a hard cap: any HIGH terms flag caps Terms at 75; two or more cap it at 65. | §4.5 | With #2 alone Terms is 60 already; the cap makes the outcome hold even when the extractor misses a field. Overall lands 79–80 either way (cap at 65 → 40 + 22.75 + 17.5 = 80; #2's 60 → 79). |
| 4 | Expired quote is invisible | Code rule on `signing_deadline` vs server date: past → hygiene banner "Quote expired on {date} — ask for a re-quote before negotiating", `daysToDeadline := null` (no ±10), leverage bullet about the deadline suppressed, email prompt told "the quote has expired; ask for a refreshed quote". | §3.2, §4.3, §7.3 | Leverage 70 → 60; overall with #2 → 40 + 21 + 15 = **76**; the "rep needs this closed" bullet and "ready to sign shortly" line disappear. |
| 5 | Deal type is hard-coded New | Add a New / Renewal / Expansion selector on the new-analysis form (default from `inferDealType` on the preview text); store the chosen value; pass it to every prompt; when the extract or text disagrees with the choice, show a "Looks like a renewal — Sub end date 11 Jan 2026" banner with a one-click switch. | §0.3, §2.5 | Renewal signal surfaced; if switched, savings frame becomes 15–25%, emails drop "new customer", leverage bullets pivot to retention. |
| 6 | Three targets on one page | One `target` computed in code: `total − sum(must_have)` unless a benchmark target exists; write it into the email prompt in place of `target_price_range`; drop `target_price_range` from the fast output or store it as `model_estimate` only. | §6.1, §8.6 | Hero $33,441 and the email anchor agree (rounded $33,500); the unseen 34,513–35,240 range no longer steers the draft. |
| 7 | Stacked asks double-count | Code pass over `potential_savings.must_have`: compute the headline discount on the total net of every line-specific ask; flag items whose `ask` mentions "headcount", "if", "unverified" as unquantified (amount → null, "Not quantified"). | §6.3 | Total 2,889 → 2,835; nice-to-have $1,206 shown as "Not quantified". |
| 8 | "Already solid" can contradict a flag | Code check: drop any `whats_solid` bullet with ≥0.5 token overlap against a flag's `issue` or a must-have ask (same `topicOverlap` as `email-asks.ts`). | §7.4 | The 24-month "solid" bullet is removed; "Net 30" and "fully itemized" remain. |
| 9 | Renewal TCO is never shown | When `autoRenew && escalationMinPct` (from #2) and `term_months`: compute renewal-term cost at the stated minimum uplift and show a "Renewal exposure" tile; feed the difference as the $ impact of the escalation flag. | §6.4 | New tile: "Next term ≈ $40,080 (+$3,750)"; the escalation flag carries a $3,750 amount instead of prose. |
| 10 | Currency enum crashes non-listed currencies; quantity unverified silently | Widen `snapshot.currency` to the `Currency` type (add CHF, JPY) with `.catch('USD')`; surface `quote_facts.checks` on the snapshot ("Seats: 750 (unverified)", "Unit price: not reconciled"). | §1.1, §3.2 | No effect on this USD fixture's score; the snapshot shows "750 seats · unverified" and the reviewer can see why the benchmark had no unit basis. |
