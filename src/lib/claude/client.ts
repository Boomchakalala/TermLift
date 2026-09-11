import Anthropic from '@anthropic-ai/sdk'
import { recordAiUsage } from '@/lib/ai-telemetry'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

/**
 * Wraps anthropic.messages.create() with cost/usage telemetry. Every live
 * call site should go through this (not the raw client) so ai_usage_events
 * stays a complete record — see lib/ai-telemetry.ts and lib/ai-cost.ts.
 * `action` identifies which step this is (e.g. 'classify', 'fast_analyze')
 * for later per-deal/per-action cost breakdowns; deal/round/user context is
 * read automatically from the ambient AsyncLocalStorage set by the calling
 * API route via runWithAiContext() — callers don't need to pass it.
 */
export async function createTrackedMessage(
  action: string,
  params: Anthropic.MessageCreateParamsNonStreaming
): Promise<Anthropic.Message> {
  const start = Date.now()
  try {
    const response = await anthropic.messages.create(params)
    // Awaited, not fire-and-forget — in a serverless function, an
    // un-awaited write can be cut off the moment the response returns.
    await recordAiUsage({
      action,
      model: params.model,
      usage: response.usage,
      success: true,
      latencyMs: Date.now() - start,
    })
    return response
  } catch (error) {
    await recordAiUsage({
      action,
      model: params.model,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - start,
    })
    throw error
  }
}

// Per commit 8cde00f: analysis was reverted from Opus to Sonnet due to timeouts + JSON errors.
// If you want to try Opus again, use 'claude-opus-4-7' (current Opus; 4.6 is also valid but
// the same family that caused the original issues). Test thoroughly before flipping.
export const CLAUDE_MODEL = 'claude-sonnet-4-6'                 // Extraction, emails, general calls
export const CLAUDE_MODEL_ANALYSIS = 'claude-sonnet-4-6'        // Analysis — Sonnet (Opus 4.x caused timeouts/JSON errors here)
export const CLAUDE_CLASSIFY_MODEL = 'claude-haiku-4-5-20251001' // Classification — fast, cheap
// 2026-09-11 perf split: the document is read by the model ONCE, in the extraction
// call, on the cheap/fast model. Every later step (flags, Playbook, emails) reads
// the persisted extract JSON and the stored text — never the file again.
export const CLAUDE_EXTRACT_MODEL = 'claude-haiku-4-5'            // Extraction — the only call that sees the document
export const CLAUDE_MODEL_ID = CLAUDE_MODEL_ANALYSIS

export type ClaudeImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export type ClaudeUserContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: ClaudeImageMediaType; data: string } }
    >

export const SUPPORTED_IMAGE_MIME_TYPES: ClaudeImageMediaType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

export function getResponseText(response: Anthropic.Message): string {
  const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === 'text')
  return textBlock?.text ?? ''
}

/** Model output as parsed, before dash normalisation — see parseJsonFromContent. */
function parseJsonFromContentRaw(content: string): unknown {
  const trimmed = content.trim()
  const stripped = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  // Start at the first '{' — the JSON object start. Tolerates any preamble text
  // the model may emit before the object (we no longer prefill the assistant turn).
  const firstBrace = stripped.indexOf('{')
  const full = firstBrace >= 0 ? stripped.substring(firstBrace) : stripped
  // Extract only the JSON object — Claude sometimes adds trailing text after the closing '}'
  let depth = 0
  let inString = false
  let escape = false
  for (let i = 0; i < full.length; i++) {
    const ch = full[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"' && !escape) { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return JSON.parse(full.substring(0, i + 1))
    }
  }
  // Fallback: try parsing the whole thing
  return JSON.parse(full)
}

export function getLanguageInstruction(locale: string): string {
  if (locale === 'fr') {
    return `

IMPORTANT: The user's language preference is French. Generate ALL descriptive text in French. This includes: verdict, red flag descriptions, negotiation advice, strategy text, savings rationale text, email drafts, and all other user-facing prose.

Use professional French business/procurement terminology. Keep proper nouns, product names, and currency amounts as-is.

CRITICAL — FACTS ARE IMMUTABLE:
- All numeric values (amounts, percentages, scores) must remain EXACTLY as provided in the verified facts. Do NOT reformulate, round, convert, or re-localize them.
- Currency amounts in JSON fields must use the EXACT same format as the input facts (e.g., if facts say "$16,328", output "$16,328" — never "16 328 $" or "16.328 $").
- The "total" field in potential_savings must equal the arithmetic sum of must_have amounts. Do NOT change it.
- savings amounts are raw numbers (e.g., 700 not "700 EUR"). This does not change with language.

For email greetings, use "Bonjour [Name]," (not "Hi" or "Hey"). For email sign-offs, use "Cordialement," followed by "[Votre nom]".`
  }
  return '\n\nIMPORTANT: Generate ALL output text in English.'
}

/** Build image content blocks for Claude API calls */
export function buildImageContent(
  imageData?: { base64: string; mimeType: string },
  allPages?: Array<{ base64: string; mimeType: string }>,
  pdfData?: { base64: string; mimeType: string }
): Anthropic.MessageParam['content'] | null {
  const hasPdf = pdfData?.base64 && pdfData?.mimeType === 'application/pdf'
  const hasImages = !hasPdf && allPages && allPages.length > 0
  const hasSingleImage = !hasPdf && imageData && SUPPORTED_IMAGE_MIME_TYPES.includes(imageData.mimeType as ClaudeImageMediaType)

  if (hasPdf) {
    return [
      {
        type: 'document' as any,
        source: { type: 'base64' as any, media_type: 'application/pdf' as any, data: pdfData!.base64 },
      },
    ]
  }

  if (hasImages) {
    return allPages!.map((page) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: page.mimeType as ClaudeImageMediaType, data: page.base64 },
    }))
  }

  if (hasSingleImage) {
    return [
      { type: 'image' as const, source: { type: 'base64' as const, media_type: imageData!.mimeType as ClaudeImageMediaType, data: imageData!.base64 } },
    ]
  }

  return null
}

/**
 * The prompts forbid en/em dashes, so the model substitutes " -- ", which then
 * shows up verbatim in the UI. Every parse site goes through here, so the
 * substitution is undone once, centrally: "--" becomes a proper em dash in every
 * string field, at any depth. Keys are never touched.
 */
export function normalizeDashes<T>(value: T): T {
  if (typeof value === 'string') return value.replace(/\s*--\s*/g, ' — ') as unknown as T
  if (Array.isArray(value)) return value.map((v) => normalizeDashes(v)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = normalizeDashes(v)
    return out as T
  }
  return value
}

export function parseJsonFromContent(content: string): unknown {
  return normalizeDashes(parseJsonFromContentRaw(content))
}
