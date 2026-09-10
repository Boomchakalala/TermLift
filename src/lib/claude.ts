/**
 * Claude AI Pipeline — Thin facade
 *
 * This file re-exports everything from the claude/ module directory
 * so existing imports from '@/lib/claude' continue to work unchanged.
 *
 * The actual implementation is split into focused modules:
 *   claude/client.ts       — Anthropic client + shared helpers
 *   claude/classify.ts     — Quote classification (Step 0)
 *   claude/extract.ts      — Financial facts extraction (Step 1)
 *   claude/analyze.ts      — Deal analysis (Step 2)
 *   claude/emails.ts       — Email generation (Step 3)
 *   claude/score.ts        — Deterministic score calculation
 *   claude/validate-total.ts — Code-level total_commitment validation
 *   claude/overlays.ts     — Quote type overlays
 *   claude/index.ts        — Orchestrator (analyzeDeal pipeline)
 */

// Re-export the main pipeline function (used by API routes)
export { analyzeDeal, analysisDate } from './claude/index'

// Re-export utilities used by other API routes
export { getLanguageInstruction, type ClaudeUserContent } from './claude/client'
export { CLAUDE_MODEL_ID } from './claude/client'

// Re-export getClaudeResponse for routes that make their own AI calls
// (regenerate-emails, estimate-close, close)
import { CLAUDE_MODEL, getResponseText, createTrackedMessage, type ClaudeUserContent } from './claude/client'

export async function getClaudeResponse(params: {
  // Identifies what this call is for in ai_usage_events (e.g.
  // 'email_regenerate', 'close_estimate', 'close_summary') — required so
  // every getClaudeResponse() call site is accounted for, not just the
  // pipeline's own steps.
  action: string
  system: string
  userContent: ClaudeUserContent
  max_tokens?: number
  temperature?: number
}): Promise<string> {
  const { action, system, userContent, max_tokens = 1024, temperature = 0 } = params
  const response = await createTrackedMessage(action, {
    model: CLAUDE_MODEL,
    max_tokens,
    system,
    messages: [{ role: 'user', content: userContent }],
    temperature,
  })
  const text = getResponseText(response)
  if (!text) throw new Error('No response from AI')
  return text
}

// Re-export email functions used by routes
export { regenerateEmailDrafts, generateEmailV2, KEVIN_SYSTEM_PROMPT, EMAIL_RULES } from './claude/emails'

// Re-export score utilities
export { calculateQuoteScore, parseMoneyAmount } from './claude/score'

// Re-export classification
export { classifyQuote } from './claude/classify'

// Re-export extraction + total-commitment validation — used by
// /api/deal/extract-preview (the lightweight classify+extract-only route)
// and /api/deal/create (to type the precomputed result it forwards back in)
export { extractFinancialFacts, type ExtractedFacts } from './claude/extract'
export { validateTotalCommitment } from './claude/validate-total'
