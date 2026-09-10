import Anthropic from '@anthropic-ai/sdk'
import { createTrackedMessage, CLAUDE_MODEL, getResponseText, parseJsonFromContent, buildImageContent, SUPPORTED_IMAGE_MIME_TYPES, type ClaudeImageMediaType } from './client'
import { logAiRaw } from '@/lib/ai-debug'

const EXTRACTION_PROMPT = `You are a financial data extraction engine. Your ONLY job is to extract factual information from vendor quotes. Do NOT analyze, judge, or recommend — just extract.

CRITICAL: You MUST always return valid JSON. NEVER respond with conversational text like "I don't see a quote" or "I need more information". If the input is unclear, extract whatever you can and use "Unknown" for missing fields.

EXTRACT THESE FIELDS:

1. vendor: Company or person name providing the quote
2. vendor_product: "Vendor / Product or Service" format
3. category: What type of service/product (e.g., "SaaS - Infrastructure", "Professional Services - Marketing Agency")
4. description: One sentence describing what this vendor does
5. term: Contract duration (e.g., "12 months", "6 months", "one-time")
6. total_commitment: The TOTAL contract value
7. contact_name: The name of the sales rep, account manager, or person who sent/signed the quote. Look for: signatures, "Prepared by", "Your contact", "Account Manager", "Sales Rep", email sign-offs, or any person's name associated with the vendor. Extract FIRST NAME ONLY (e.g., "Sarah" not "Sarah Johnson"). If no person name found, omit this field.

   CRITICAL RULES FOR total_commitment:
   - SEARCH for a stated total FIRST: "Net Amount Due", "Total", "Grand Total", "Total Contract Value", "Annual Total", "Montant Total", "Total HT", "Total TTC"
   - If you find a stated total, USE IT AS-IS. Do NOT multiply by anything.
   - If NO single total exists but there are multiple line items, SUM ALL LINE ITEMS to calculate the total. Include all fees, extras, and add-ons in the sum.
   - If amounts are hourly rates with quantities (e.g., 8 hours x 150/hr), calculate: rate x quantity for each line, then sum all lines.
   - ONLY multiply by term if amounts are explicitly labeled "/month" or "per month" AND no total exists.
   - SANITY CHECK: The total should make sense relative to the line items. If line items add up to thousands but your total is under 100, you have made an error. Recalculate.
   - Output ONLY a clean currency amount: "$16,328" or "€40,000". No formulas, no notes.

7. billing_payment: How they pay (e.g., "Monthly", "Annual upfront", "Quarterly")
8. pricing_model: How pricing is structured (e.g., "Per-seat, billed annually", "Fixed retainer + % of ad spend")
9. currency: "USD", "EUR", "GBP", "CAD", "AUD"
10. deal_type: "New purchase" or "Renewal"
11. renewal_date: If stated, otherwise omit
12. signing_deadline: If stated, otherwise omit

STRUCTURED COMMERCIAL FACTS (optional — copy printed figures only, never compute):
13. main_line: the single highest-value priced line as PRINTED on the document, if the document itemises lines:
   - description: the line's own wording
   - quantity: the printed quantity or seat/user/unit count as a JSON number
   - unit_price: the printed unit price as a JSON number, no currency symbol, no thousands separators
   - unit_period: what that unit price covers, exactly one of "month", "year", "term", "one_time" ("term" = the price covers the whole contract term)
   - list_unit_price: the printed list / catalogue / undiscounted unit price for that line as a JSON number, ONLY if the document prints one
   - line_total: the printed total for that line as a JSON number
   Omit any sub-field that is not printed. Omit main_line entirely if the document shows only one total with no lines.
14. printed_line_totals: JSON array of every per-line total printed on the document (numbers). Omit if there are no itemised lines.
15. term_months: the contract length in whole months as a JSON number, ONLY if the document states a duration ("24 months", "3 years", "annual" = 12). Omit if not stated.
16. pricing_metric: exactly one of "per_seat_month", "per_seat_year", "per_host_month", "per_host_year", "per_gb_month", "per_unit", "per_hour", "flat_annual", "flat_total". Omit if unclear.
   UNIT PRICE RULE: unit_price is always the NET / sales / discounted price the buyer pays per unit. When a line prints both a list price and a net price, unit_price = net, list_unit_price = list. Never put the list price in unit_price.
17. line_items: JSON array, one entry per priced line as PRINTED, in document order (omit if there are no itemised lines). Each entry: description, sku (part number if printed, else omit), quantity, list_unit_price, discount_pct (the printed discount percentage for that line, else omit), net_unit_price, line_total, term_months (only if the line states its own duration). Numbers only, copied, never computed.
18. quote_number: the quote / proposal / order-form reference number if printed (e.g. "Q-2025-1187"), else omit.
19. quote_created: the date the quote was issued / prepared, exactly as printed, else omit.
20. quote_expires: the date the quote is valid until / expires / must be signed by, exactly as printed, else omit. (Same date as signing_deadline when both exist.)
21. current_sub_end: the end date of an EXISTING subscription or current term the document mentions (e.g. "Sub end date", "current term ends", "existing subscription expires"), exactly as printed, else omit.
22. auto_renew: true if the document says the agreement renews automatically, false if it says it does not renew automatically, omit if silent.
23. notice_days: the number of days' notice required to prevent renewal or to cancel, as a JSON number, only if stated.
24. escalation_min_pct: the minimum / stated annual price increase on renewal as a JSON number (e.g. "increase of at least 4%" = 4), only if stated.
25. escalation_cap_pct: the maximum / capped annual increase as a JSON number, only if the document states a cap. If the document says the increase is "a minimum of X%" or "at least X%" with no ceiling, omit this field.
26. extra_increase_allowed: true if the document reserves the vendor's right to increase prices beyond the stated percentage (e.g. "a minimum of 4% … KnowBe4 may increase"), false if the stated percentage is the ceiling, omit if silent.
27. deal_type_evidence: JSON array of up to 3 SHORT quoted spans (each under 80 characters, copied verbatim) that show whether this is a new purchase, a renewal or an expansion (e.g. "Sub end date: 11th Jan 2026", "Renewal of existing subscription", "New customer discount"). Omit if the document gives no such signal.

Return ONLY valid JSON:
{
  "vendor": "Company Name",
  "vendor_product": "Company / Product Name",
  "category": "SaaS - Infrastructure",
  "description": "One sentence description",
  "term": "12 months",
  "total_commitment": "$16,328",
  "billing_payment": "Monthly",
  "pricing_model": "Per-seat, billed annually",
  "currency": "USD",
  "deal_type": "Renewal",
  "contact_name": "Sarah",
  "renewal_date": "March 15, 2026",
  "signing_deadline": "February 28, 2026",
  "main_line": { "description": "Enterprise plan, per user", "quantity": 120, "unit_price": 11.35, "unit_period": "month", "list_unit_price": 15, "line_total": 16344 },
  "printed_line_totals": [16344],
  "term_months": 12,
  "pricing_metric": "per_seat_month",
  "line_items": [
    { "description": "Enterprise plan, per user", "sku": "ENT-U", "quantity": 120, "list_unit_price": 15, "discount_pct": 24.3, "net_unit_price": 11.35, "line_total": 16344, "term_months": 12 }
  ],
  "quote_number": "Q-2026-0417",
  "quote_created": "February 1, 2026",
  "quote_expires": "February 28, 2026",
  "current_sub_end": "March 15, 2026",
  "auto_renew": true,
  "notice_days": 60,
  "escalation_min_pct": 4,
  "extra_increase_allowed": true,
  "deal_type_evidence": ["Renewal of existing subscription", "Sub end date: March 15, 2026"]
}

RULES:
- Extract ONLY what is explicitly stated in the document
- Do NOT invent, assume, or calculate values not present
- If a field is not stated, omit it from the output
- For total_commitment: if you cannot determine it, set to the stated amount with the currency symbol
- NEVER multiply a stated total by the term length
- Numeric fields (quantity, unit_price, list_unit_price, line_total, printed_line_totals, term_months, notice_days, escalation percentages, line_items numbers) must be plain JSON numbers copied from the document, never derived
- Dates (renewal_date, signing_deadline, quote_created, quote_expires, current_sub_end) are copied exactly as printed; never convert or guess a year`

export interface ExtractedFacts {
  vendor: string
  vendor_product: string
  category?: string
  description?: string
  term: string
  total_commitment: string
  billing_payment: string
  pricing_model: string
  currency: string
  deal_type: string
  contact_name?: string
  renewal_date?: string
  signing_deadline?: string
  // ── Structured commercial facts (2026-09-08). Raw model output; only
  //    lib/quote-facts.ts turns these into trusted values.
  main_line?: {
    description?: string
    quantity?: number
    unit_price?: number
    unit_period?: 'month' | 'year' | 'term' | 'one_time'
    list_unit_price?: number
    line_total?: number
  }
  printed_line_totals?: number[]
  term_months?: number
  pricing_metric?: string
  // ── 2026-09-11: line items, quote dates, renewal mechanics, deal-type evidence.
  //    Raw model output. Renewal/date fields seed the scorer (lib/scoring.ts
  //    seedFromFacts); line items are cross-checked in lib/quote-facts.ts.
  line_items?: Array<{
    description?: string
    sku?: string
    quantity?: number
    list_unit_price?: number
    discount_pct?: number
    net_unit_price?: number
    line_total?: number
    term_months?: number
  }>
  quote_number?: string
  quote_created?: string
  quote_expires?: string
  current_sub_end?: string
  auto_renew?: boolean
  notice_days?: number
  escalation_min_pct?: number
  escalation_cap_pct?: number
  extra_increase_allowed?: boolean
  deal_type_evidence?: string[]
}

export async function extractFinancialFacts(
  extractedText: string,
  dealType: 'New' | 'Renewal',
  imageData?: { base64: string; mimeType: string },
  allPages?: Array<{ base64: string; mimeType: string }>,
  pdfData?: { base64: string; mimeType: string },
): Promise<ExtractedFacts> {
  const visualContent = buildImageContent(imageData, allPages, pdfData)
  const hasVisualInput = !!visualContent

  const userPrompt = (hasVisualInput
    ? `Deal Type: ${dealType}\n\nPlease extract the financial facts from the attached quote document. Read the entire document carefully — pay close attention to tables, pricing columns, totals, terms, and dates.${extractedText ? `\n\nExtracted text (for reference):\n${extractedText}` : ''}`
    : `Deal Type: ${dealType}\n\nExtract the financial facts from this quote:\n${extractedText}`)
    + `\n\nRespond with ONLY the JSON object. Begin your response with the { character — no preamble, no explanation, no markdown fences. Output raw JSON and nothing else.`

  let userContent: Anthropic.MessageParam['content']
  if (visualContent) {
    userContent = [{ type: 'text', text: userPrompt }, ...visualContent as any[]]
  } else {
    userContent = userPrompt
  }

  const response = await createTrackedMessage('extract', {
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    // CRITICAL: Extraction is ALWAYS language-agnostic. Never inject language instructions here.
    // The model must output structured facts in canonical English format (US number formatting,
    // currency symbol before amount, field values in English). Localization happens downstream
    // in the analysis and email steps only.
    system: EXTRACTION_PROMPT,
    messages: [
      { role: 'user', content: userContent },
    ],
    temperature: 0,
    // Extraction is mechanical fact-pulling — no reasoning needed. Low effort + no
    // thinking is the fast path (Sonnet 4.6 otherwise defaults to high effort).
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
  })

  if (response.stop_reason === 'max_tokens') {
    throw new Error('AI_PARSE_ERROR: Extraction response truncated')
  }

  const content = getResponseText(response)
  if (!content) throw new Error('No response from AI')
  logAiRaw('Extract raw response', content)

  const parsed = parseJsonFromContent(content) as ExtractedFacts
  console.log('[TermLift] Extract parsed keys:', Object.keys(parsed))

  // Validate required fields
  if (!parsed.vendor || !parsed.total_commitment) {
    const keys = Object.keys(parsed)
    const sample = JSON.stringify(parsed).substring(0, 300)
    console.error('[TermLift] Extract validation failed. Keys:', keys, 'Sample:', sample)
    throw new Error(`AI_VALIDATION_ERROR: Extraction missing required fields. Got keys: [${keys.join(', ')}]. Sample: ${sample}`)
  }

  return parsed
}
