import { z } from 'zod'

// Zod schema for strict validation of OpenAI output
export const RedFlagSchema = z.object({
  type: z.string(),
  severity: z.enum(['high', 'medium', 'low']).default('medium'),
  score_category: z.enum(['pricing', 'terms', 'leverage']).default('pricing'),
  issue: z.string(),
  why_it_matters: z.string(),
  what_to_ask_for: z.string(),
  if_they_push_back: z.string(),
  /** Set on flags produced (or lifted) by lib/claude/code-flags.ts rules; absent on pure model flags. */
  source_rule: z.string().optional(),
})

export const EmailDraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
})

const LeverageLevelEnum = z.enum(['low', 'moderate', 'high']).catch('moderate')

export const LeverageAssessmentSchema = z.object({
  price_leverage: LeverageLevelEnum,
  terms_leverage: LeverageLevelEnum,
  structural_leverage: LeverageLevelEnum,
  risk_leverage: LeverageLevelEnum,
  ambiguity_leverage: LeverageLevelEnum,
  savings_confidence: z.enum(['low', 'medium', 'high']).catch('medium'),
  best_negotiation_angle: z.array(z.enum(['price', 'terms', 'structure', 'scope_clarity', 'billing_renewal', 'risk'])).catch(['price']),
}).optional()

export const DealOutputSchema = z.object({
  leverage_assessment: LeverageAssessmentSchema,
  title: z.string(),
  vendor: z.string(),
  category: z.string().optional(), // e.g., "SaaS Infra", "Marketing Agency", "Consulting"
  description: z.string().optional(), // Quick 1-2 liner about what this is
  verdict: z.string().optional().default('Review this deal before signing.'),
  verdict_type: z.enum(['negotiate', 'competitive', 'overpay_risk']).optional().default('negotiate'),
  price_insight: z.string().optional(),
  snapshot: z.object({
    vendor_product: z.string(),
    term: z.string(),
    total_commitment: z.string(),
    // Widened 2026-09-11: a CHF/JPY quote used to fail validation (HTTP 500) here.
    currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY']).optional().default('USD'),
    billing_payment: z.string(),
    pricing_model: z.string(),
    deal_type: z.string(),
    /** What the document itself said (evidence). `deal_type` above follows the deal's chosen type. */
    deal_type_stated: z.string().optional(),
    renewal_date: z.string().optional(),
    signing_deadline: z.string().optional(),
    // 2026-09-11: printed on the quote, copied as-is (see extract.ts fields 18-21).
    quote_number: z.string().optional(),
    quote_created: z.string().optional(),
    quote_expires: z.string().optional(),
    current_sub_end: z.string().optional(),
  }),
  quick_read: z.object({
    whats_solid: z.array(z.string()).default([]),
    whats_concerning: z.array(z.string()).default([]),
    conclusion: z.string().optional().default(''),
  }).optional().default({}),
  red_flags: z.array(RedFlagSchema).default([]),
  negotiation_plan: z.object({
    leverage_you_have: z.array(z.string()).default([]),
    trades_you_can_offer: z.array(z.string()).default([]),
  }).optional().default({}),
  what_to_ask_for: z.object({
    must_have: z.array(z.string()).default([]),
    nice_to_have: z.array(z.string()).default([]),
  }).optional().default({}),
  potential_savings: z.any().optional().default({}),
  cash_flow_improvements: z.array(z.object({
    recommendation: z.string(),
    category: z.enum(['cash_flow', 'risk']),
  })).optional().default([]),
  watchItems: z.array(z.object({
    description: z.string(),
    category: z.string().optional().default('other'),
  })).optional().default([]),
  score: z.number().min(0).max(100).optional(),
  score_label: z.string().optional(),
  score_breakdown: z.object({
    pricing_fairness: z.number().min(0).max(50),
    terms_protections: z.number().min(0).max(30),
    leverage_position: z.number().min(0).max(20),
    pricing_deductions: z.array(z.object({ points: z.number(), reason: z.string() })).optional().default([]),
    terms_deductions: z.array(z.object({ points: z.number(), reason: z.string() })).optional().default([]),
    leverage_deductions: z.array(z.object({ points: z.number(), reason: z.string() })).optional().default([]),
  }).optional(),
  score_rationale: z.string().optional(),
  email_drafts: z.object({
    neutral: EmailDraftSchema,
    firm: EmailDraftSchema,
    final_push: EmailDraftSchema,
  }).optional(),
  assumptions: z.array(z.string()).default([]),
  disclaimer: z.string().optional().default('This analysis is AI-generated and should be used as guidance only.'),
})

// API request schemas
export const CreateDealSchema = z.object({
  vendor: z.string().nullable().optional(),
  dealType: z.enum(['New', 'Renewal']),
  goal: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  extractedText: z.string().nullable().optional(),
  imageData: z.object({
    base64: z.string(),
    mimeType: z.string(),
  }).optional(),
  pdfData: z.object({
    base64: z.string(),
    mimeType: z.string(),
  }).optional(),
  saveExtractedText: z.boolean().default(false),
  isDemoText: z.boolean().default(false), // Flag for demo text (don't count against usage)
  // Echoed back from an earlier /api/deal/extract-preview response so
  // analyzeDeal() can reuse it instead of re-deriving. Untyped here — the
  // client only ever forwards what our own preview endpoint just returned it.
  precomputedClassification: z.unknown().optional(),
  precomputedFacts: z.unknown().optional(),
}).refine(
  (data) => (data.extractedText && data.extractedText.length >= 10) || data.imageData || data.pdfData,
  { message: 'Either extractedText (min 10 chars), imageData, or pdfData must be provided' }
)

export const AddRoundSchema = z.object({
  dealId: z.string().uuid(),
  note: z.string().nullable().optional(),
  extractedText: z.string().min(10, 'Extracted text is too short'),
  saveExtractedText: z.boolean().default(false),
  /** How the reply arrived. An uploaded document can back a document_verified offer; pasted text cannot. */
  source: z.enum(['upload', 'paste']).optional(),
})

// V2 Schema - Selective, issue-driven analysis
export const PriorityPointSchema = z.object({
  title: z.string(),
  why_it_matters: z.string(),
  recommended_direction: z.string(),
})

export const EmailControlsSchema = z.object({
  tone_preference: z.enum(['soft', 'balanced', 'firm']),
  supplier_relationship: z.enum(['new', 'existing', 'renewal', 'unknown']),
  email_goal: z.enum(['clarify', 'negotiate', 'revise', 'accept']),
  user_notes: z.string().optional().default(''),
})

export const DealOutputSchemaV2 = z.object({
  schema_version: z.literal('v2'),

  // Quote Summary
  quote_snapshot: z.object({
    vendor_product: z.string(),
    term: z.string(),
    total_commitment: z.string(),
    billing_payment: z.string(),
    pricing_model: z.string(),
  }),

  // Quick Read - What's good/bad
  quick_read: z.object({
    whats_solid: z.array(z.string()).max(3).default([]),
    whats_concerning: z.array(z.string()).max(3).default([]),
    conclusion: z.string().optional().default(''),
  }).optional().default({}),

  // Red Flags with mitigation
  red_flags: z.array(RedFlagSchema).default([]),

  // What to Ask For
  what_to_ask_for: z.object({
    must_have: z.array(z.string()).max(4).default([]),
    nice_to_have: z.array(z.string()).max(3).default([]),
  }).optional().default({}),

  // Deal metadata
  deal_snapshot: z.object({
    audience: z.enum(['business', 'personal']),
    quote_type: z.string(), // Allow any description
    deal_type: z.string(), // Allow any description
    pricing_model: z.string(), // Allow any description
    leverage_level: z.enum(['high', 'medium', 'low', 'unclear']),
    main_negotiation_angle: z.string(), // Allow any description
    overall_assessment: z.string(),
  }),
  commercial_facts: z.object({
    supplier: z.string(),
    total_value: z.string(),
    currency: z.string(),
    term_length: z.string(),
    billing_structure: z.string(),
    key_elements: z.array(z.string()).default([]),
    unclear_or_missing: z.array(z.string()).default([]),
  }),
  dominant_issue: z.object({
    title: z.string(),
    explanation: z.string(),
  }),
  priority_points: z.array(PriorityPointSchema).max(3).default([]),
  low_priority_or_acceptable: z.array(z.string()).default([]),
  recommended_strategy: z.object({
    posture: z.enum([
      'no_push_needed',
      'soft_clarification',
      'collaborative_optimization',
      'standard_negotiation',
      'firm_pushback',
      'structural_rethink',
    ]),
    summary: z.string(),
    success_looks_like: z.string(),
  }),
  email_controls: EmailControlsSchema,
})

// Quote Classification Schema (Step 1 of two-step pipeline)
export const QuoteClassificationSchema = z.object({
  quote_type: z.enum(['saas', 'professional_services', 'product_hardware', 'household', 'event_project', 'construction', 'staffing', 'travel', 'media', 'usage_based_infra', 'managed_services', 'insurance', 'logistics', 'leasing', 'garage']).catch('professional_services'),
  deal_size_bracket: z.enum(['micro', 'small', 'medium', 'large', 'enterprise']).catch('medium'),
  recurring: z.boolean().catch(false),
  leverage_level: z.enum(['high', 'medium', 'low', 'unclear']).catch('medium'),
  audience: z.enum(['business', 'personal']).catch('business'),
  savings_strategy: z.object({
    target_percent_min: z.number().catch(5),
    target_percent_max: z.number().catch(15),
    approach: z.enum([
      'line_item_reduction',
      'volume_discount',
      'package_discount',
      'multi_year_commitment',
      'scope_optimization',
      'payment_restructure',
      'competitive_leverage',
    ]).catch('package_discount'),
    rationale: z.string().catch('General negotiation approach'),
  }).catch({ target_percent_min: 5, target_percent_max: 15, approach: 'package_discount' as const, rationale: 'General negotiation approach' }),
})

export type QuoteClassificationType = z.infer<typeof QuoteClassificationSchema>

export type DealOutputType = z.infer<typeof DealOutputSchema>
export type DealOutputTypeV2 = z.infer<typeof DealOutputSchemaV2>
export type CreateDealInput = z.infer<typeof CreateDealSchema>
export type AddRoundInput = z.infer<typeof AddRoundSchema>

// Negotiation request intake — both the post-analysis and direct entry paths
// submit through this same shape.
export const NegotiationRequestSchema = z.object({
  source: z.enum(['post_analysis', 'direct']),
  dealId: z.string().uuid().nullable().optional(),
  roundId: z.string().uuid().nullable().optional(),
  vendor: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  renewalDate: z.string().nullable().optional(), // ISO date string
  currentTotal: z.string().nullable().optional(),
  seatOrUsageNotes: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  vendorContactName: z.string().nullable().optional(),
  vendorContactEmail: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  documentConsent: z.boolean().default(false), // must be true if a document is attached
  dealType: z.enum(['renewal', 'new_purchase', 'expansion', 'unknown']).nullable().optional(),
  dealTypeConfidence: z.enum(['high', 'low']).nullable().optional(),
  negotiationObjective: z.string().nullable().optional(),
  walkAwayNotes: z.string().nullable().optional(),
  competitorContext: z.string().nullable().optional(),
  // Small normalized snapshot only — never the raw quote text.
  analysisContext: z.object({
    verdict: z.string().nullable().optional(),
    targetPriceLow: z.number().nullable().optional(),
    targetPriceHigh: z.number().nullable().optional(),
    potentialSavings: z.number().nullable().optional(),
    currency: z.string().nullable().optional(),
    topRedFlags: z.array(z.string()).optional(),
  }).nullable().optional(),
})

export type NegotiationRequestInput = z.infer<typeof NegotiationRequestSchema>
