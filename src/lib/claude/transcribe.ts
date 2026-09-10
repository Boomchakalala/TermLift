import { createTrackedMessage, CLAUDE_MODEL, getResponseText, buildImageContent } from './client'

/**
 * Model transcription of a quote document — the fallback when pdf-parse and
 * OCR give nothing (image-only PDFs, PDFs pdf-parse cannot open, serverless
 * builds without the native parser). The document is already being sent to
 * the model for extraction; this returns its text so the Playbook can run
 * later without the file, which is never stored.
 *
 * Verbatim only: no summarising, no judgement.
 */
const PROMPT = `Transcribe ALL the text in the attached document, verbatim, as plain text.
- Keep the reading order. Keep every number, date, percentage, currency symbol and reference exactly as printed.
- Render tables one row per line with cells separated by " | ".
- Keep headings and terms-and-conditions paragraphs in full.
- Do not summarise, interpret, translate or add anything. Output the text and nothing else.`

export async function transcribeDocument(input: {
  pdfData?: { base64: string; mimeType?: string } | null
  imageData?: { base64: string; mimeType?: string } | null
  allPages?: Array<{ base64: string; mimeType?: string }> | null
}): Promise<string | null> {
  const visual = buildImageContent(
    input.imageData ? { base64: input.imageData.base64, mimeType: input.imageData.mimeType || 'image/png' } : undefined,
    input.allPages ? input.allPages.map((p) => ({ base64: p.base64, mimeType: p.mimeType || 'image/png' })) : undefined,
    input.pdfData ? { base64: input.pdfData.base64, mimeType: input.pdfData.mimeType || 'application/pdf' } : undefined,
  )
  if (!visual) return null
  const response = await createTrackedMessage('transcribe_document', {
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    system: PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Transcribe this document.' }, ...(visual as any[])] }],
    temperature: 0,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
  })
  const text = getResponseText(response).trim()
  return text.length >= 50 ? text : null
}
