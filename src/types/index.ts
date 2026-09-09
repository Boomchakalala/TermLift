import type { Deduction } from '@/lib/scoring'

// Database types
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          first_name: string | null
          last_name: string | null
          created_at: string
          plan: string | null // legacy column, unused since 2026-09-06
          usage_count: number
          is_admin: boolean
          base_currency: string | null
          locale: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          subscription_end_date: string | null
        }
        Insert: {
          id: string
          email: string
          first_name?: string | null
          last_name?: string | null
          created_at?: string
          plan?: string | null
          usage_count?: number
          is_admin?: boolean
          base_currency?: string | null
          locale?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          subscription_end_date?: string | null
        }
        Update: {
          id?: string
          email?: string
          first_name?: string | null
          last_name?: string | null
          created_at?: string
          plan?: string | null
          usage_count?: number
          is_admin?: boolean
          base_currency?: string | null
          locale?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          subscription_end_date?: string | null
        }
      }
      deals: {
        Row: {
          id: string
          user_id: string
          vendor: string | null
          title: string
          deal_type: 'New' | 'Renewal'
          goal: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          vendor?: string | null
          title: string
          deal_type: 'New' | 'Renewal'
          goal?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          vendor?: string | null
          title?: string
          deal_type?: 'New' | 'Renewal'
          goal?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      rounds: {
        Row: {
          id: string
          deal_id: string
          user_id: string
          round_number: number
          created_at: string
          note: string | null
          extracted_text: string | null
          /** Set when the raw text was removed under the retention policy (lib/retention.ts). */
          extracted_text_purged_at: string | null
          /** Round 2+: the vendor's current total offer with provenance (lib/vendor-offer.ts). Null on Round 1 and historical rounds. */
          vendor_offer: any | null
          extracted_data: any | null
          output_json: DealOutput | DealOutputV2
          output_markdown: string | null
          status: 'done' | 'error'
          error_message: string | null
          model_version: string | null
          schema_version: 'v1' | 'v2'
        }
        Insert: {
          id?: string
          deal_id: string
          user_id: string
          round_number: number
          created_at?: string
          note?: string | null
          extracted_text?: string | null
          extracted_data?: any | null
          output_json: DealOutput | DealOutputV2
          output_markdown?: string | null
          status?: 'done' | 'error'
          error_message?: string | null
          model_version?: string | null
          schema_version?: 'v1' | 'v2'
        }
        Update: {
          id?: string
          deal_id?: string
          user_id?: string
          round_number?: number
          created_at?: string
          note?: string | null
          extracted_text?: string | null
          extracted_data?: any | null
          output_json?: DealOutput | DealOutputV2
          output_markdown?: string | null
          status?: 'done' | 'error'
          error_message?: string | null
          model_version?: string | null
          schema_version?: 'v1' | 'v2'
        }
      }
      /** Cached translated copies of rounds.output_json per locale (lib/output-language.ts). */
      round_translations: {
        Row: {
          id: string
          round_id: string
          user_id: string
          locale: 'en' | 'fr'
          source_locale: 'en' | 'fr'
          output_json: DealOutput | DealOutputV2
          model: string | null
          created_at: string
        }
        Insert: {
          id?: string
          round_id: string
          user_id: string
          locale: 'en' | 'fr'
          source_locale: 'en' | 'fr'
          output_json: DealOutput | DealOutputV2
          model?: string | null
          created_at?: string
        }
        Update: {
          output_json?: DealOutput | DealOutputV2
          model?: string | null
        }
      }
      /** One paid Negotiation Playbook (Stripe Checkout); deal_id null = credit not yet spent (lib/billing.ts). */
      playbook_purchases: {
        Row: {
          id: string
          user_id: string
          deal_id: string | null
          assigned_at: string | null
          stripe_checkout_session_id: string
          stripe_payment_intent_id: string | null
          stripe_customer_id: string | null
          amount_cents: number
          currency: string
          status: string
          invoice_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          deal_id?: string | null
          assigned_at?: string | null
          stripe_checkout_session_id: string
          stripe_payment_intent_id?: string | null
          stripe_customer_id?: string | null
          amount_cents: number
          currency?: string
          status?: string
          invoice_url?: string | null
          created_at?: string
        }
        Update: {
          deal_id?: string | null
          assigned_at?: string | null
          status?: string
          invoice_url?: string | null
        }
      }
    }
  }
}

// Deal output structure (V1)
export type RedFlag = {
  type: string
  severity?: 'high' | 'medium' | 'low'
  score_category?: 'pricing' | 'terms' | 'leverage'
  issue: string
  why_it_matters: string
  what_to_ask_for: string
  if_they_push_back: string
}

export type EmailDraft = {
  subject: string
  body: string
}

export type DealOutput = {
  leverage_assessment?: {
    price_leverage: 'low' | 'moderate' | 'high'
    terms_leverage: 'low' | 'moderate' | 'high'
    structural_leverage: 'low' | 'moderate' | 'high'
    risk_leverage: 'low' | 'moderate' | 'high'
    ambiguity_leverage: 'low' | 'moderate' | 'high'
    savings_confidence: 'low' | 'medium' | 'high'
    best_negotiation_angle: string[]
  }
  title: string
  vendor: string
  category?: string
  description?: string
  verdict: string
  verdict_type: 'negotiate' | 'competitive' | 'overpay_risk'
  price_insight?: string
  snapshot: {
    vendor_product: string
    term: string
    total_commitment: string
    currency?: string
    billing_payment: string
    pricing_model: string
    deal_type: string
    renewal_date?: string
    signing_deadline?: string
  }
  quick_read: {
    whats_solid: string[]
    whats_concerning: string[]
    conclusion: string
  }
  red_flags: RedFlag[]
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
    must_have: Array<{
      ask: string
      amount: number
      rationale: string
    }>
    nice_to_have?: Array<{
      ask: string
      amount: number
      rationale: string
    }>
  }
  cash_flow_improvements?: Array<{
    recommendation: string
    category: 'cash_flow' | 'risk'
  }>
  /** Minor notes that failed the red flag bar — rendered as the "Worth noting" card. */
  watchItems?: Array<{ description: string; category?: string }>
  score?: number
  score_label?: string
  // Two shapes coexist:
  //  - legacy deals: pricing_fairness/terms_protections/leverage_position (0-50 / 0-30 / 0-20)
  //  - new deals: pricing/terms/leverage (each 0-100) + a flat `deductions` array
  score_breakdown?: {
    // legacy
    pricing_fairness?: number
    terms_protections?: number
    leverage_position?: number
    pricing_deductions?: Array<{ points: number; reason: string }>
    terms_deductions?: Array<{ points: number; reason: string }>
    leverage_deductions?: Array<{ points: number; reason: string }>
    // new (extract-then-compute)
    pricing?: number
    terms?: number
    leverage?: number
    deductions?: Deduction[]
  }
  /** New deterministic pipeline only: flat deduction list (also nested in score_breakdown). */
  deductions?: Deduction[]
  /** New deterministic pipeline only: the structured facts the score was computed from. */
  extraction?: Record<string, unknown>
  score_rationale?: string
  email_drafts: {
    neutral: EmailDraft
    firm: EmailDraft
    final_push: EmailDraft
  }
  assumptions: string[]
  disclaimer: string
  // ── Market Benchmark (Deep Analysis only; all optional, absent on older deals) ──
  /** Structured facts pulled from the quote for benchmark matching. */
  benchmark_input?: import('@/lib/benchmark/types').BenchmarkInput
  /** Validated structured commercial facts from the quote (lib/quote-facts.ts). Written by the analysis pipeline on every round. */
  quote_facts?: import('@/lib/quote-facts').QuoteFacts
  /** Deterministic engine output — the source of truth for every benchmark number shown. */
  market_benchmark?: import('@/lib/benchmark/types').BenchmarkResult
  /** The query the engine ran (reproducibility). */
  market_benchmark_query?: import('@/lib/benchmark/types').BenchmarkQuery
  /** LLM explanation of the benchmark. Strings only; target/opening are clamped in code. */
  benchmark_interpretation?: BenchmarkInterpretation
  // ── Negotiation email (written by /api/deal/regenerate-emails) ──
  /** The optional context the user gave when generating the email — prefills the form on reload and on later rounds. */
  email_context?: EmailContext
  /** Which of the three variants the deterministic recommender picked. */
  email_recommended_tone?: 'neutral' | 'firm' | 'final_push'
  /** Round 2+: what the vendor's reply changed versus the previous round (written by /api/deal/[id]/round). */
  round_delta?: RoundDelta
  /** Language this output was generated in (lib/output-language.ts). Absent on rounds before 2026-09-10: inferred from prose. */
  generated_locale?: 'en' | 'fr'
}

/** What a vendor reply changed versus the previous round — the "Round N, counter proposal" card. */
export type RoundDelta = {
  headline: string
  what_changed: string[]
  concessions: string[]
  rejected: string[]
  new_issues: string[]
  next_move: string
  posture: 'accept' | 'push' | 'hold' | 'walk'
}

export type EmailContext = {
  negotiationObjective?: string | null
  budgetCeiling?: string | null
  competingQuote?: string | null
  walkAwayFlexibility?: 'flexible' | 'prefer_stay' | 'can_walk' | null
  internalDeadline?: string | null
  additionalInstructions?: string | null
  benchmarkUsed?: boolean
  generatedAt?: string
}

export type BenchmarkInterpretation = {
  summary: string
  why_bullets: string[]
  /** Proposed negotiation target, in the quote currency. Clamped to the strong-outcome-low .. fair-market-high band. */
  target_price: number | null
  /** Proposed opening ask, in the quote currency. Clamped to >= strong_outcome_low. */
  opening_ask: number | null
  target_rationale: string
  limitations_note: string
  /** Set by code when a proposed number had to be clamped into the evidence band. */
  clamped?: string[]
}

// V2 Schema Types
export type PriorityPoint = {
  title: string
  why_it_matters: string
  recommended_direction: string
}

export type EmailControls = {
  tone_preference: 'soft' | 'balanced' | 'firm'
  supplier_relationship: 'new' | 'existing' | 'renewal' | 'unknown'
  email_goal: 'clarify' | 'negotiate' | 'revise' | 'accept'
  user_notes?: string
}

export type DealOutputV2 = {
  schema_version: 'v2'
  deal_snapshot: {
    audience: 'business' | 'personal'
    quote_type:
      | 'saas_software'
      | 'consulting_services'
      | 'home_improvement'
      | 'marketing_agency'
      | 'hardware_equipment'
      | 'managed_services'
      | 'professional_services'
      | 'household_services'
      | 'construction'
      | 'maintenance'
      | 'other'
    deal_type: 'new_purchase' | 'renewal' | 'expansion' | 'trial_conversion' | 'unknown'
    pricing_model:
      | 'fixed_fee'
      | 'per_seat'
      | 'usage_based'
      | 'tiered'
      | 'hybrid'
      | 'quote_based'
      | 'hourly'
      | 'milestone'
      | 'unclear'
    leverage_level: 'high' | 'medium' | 'low' | 'unclear'
    main_negotiation_angle:
      | 'price'
      | 'flexibility'
      | 'scope_clarity'
      | 'payment_terms'
      | 'commitment_length'
      | 'renewal_terms'
      | 'bundling'
      | 'none'
    overall_assessment: string
  }
  commercial_facts: {
    supplier: string
    total_value: string
    currency: string
    term_length: string
    billing_structure: string
    key_elements: string[]
    unclear_or_missing: string[]
  }
  dominant_issue: {
    title: string
    explanation: string
  }
  priority_points: PriorityPoint[]
  low_priority_or_acceptable: string[]
  recommended_strategy: {
    posture:
      | 'no_push_needed'
      | 'soft_clarification'
      | 'collaborative_optimization'
      | 'standard_negotiation'
      | 'firm_pushback'
      | 'structural_rethink'
    summary: string
    success_looks_like: string
  }
  email_controls: EmailControls
}

// Negotiation preferences (stored in profiles.negotiation_preferences JSONB)
export type NegotiationPreferences = {
  payment_terms: 'net_30' | 'net_60' | 'net_90' | 'no_preference'
  top_priority: 'lowest_price' | 'best_terms' | 'max_flexibility'
  auto_renewal: 'fine' | 'prefer_opt_in'
  contract_term_strategy: 'match_quote' | 'push_longer' | 'no_preference'
}

// UI types
export type Deal = Database['public']['Tables']['deals']['Row']
export type Round = Database['public']['Tables']['rounds']['Row']
export type Profile = Database['public']['Tables']['profiles']['Row']

export type DealWithRounds = Deal & {
  rounds: Round[]
}
