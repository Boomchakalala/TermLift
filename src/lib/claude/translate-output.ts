import { createTrackedMessage, CLAUDE_CLASSIFY_MODEL, getResponseText, parseJsonFromContent } from './client'
import { applyTranslations, collectTranslatable, type OutputLocale } from '@/lib/output-language'

const LANG_NAME: Record<OutputLocale, string> = { en: 'English', fr: 'French' }
const CHUNK_CHARS = 6000
const CHUNK_MAX = 40

function chunk<T extends { value: string }>(items: T[]): T[][] {
  const chunks: T[][] = []
  let cur: T[] = []
  let size = 0
  for (const it of items) {
    if (cur.length && (cur.length >= CHUNK_MAX || size + it.value.length > CHUNK_CHARS)) { chunks.push(cur); cur = []; size = 0 }
    cur.push(it); size += it.value.length
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

/**
 * Translates the prose of an existing analysis output into `to`, keeping the
 * schema, every number, enum, name and quoted figure untouched. This is a
 * translation pass on Haiku, not a re-analysis: no facts are re-derived.
 * Throws if the model returns a different number of strings, so a caller can
 * show the original and offer a retry rather than storing a broken copy.
 */
export async function translateOutput<T>(output: T, from: OutputLocale, to: OutputLocale): Promise<T> {
  const items = collectTranslatable(output)
  if (items.length === 0 || from === to) return JSON.parse(JSON.stringify(output)) as T
  const system = `You translate the user-facing prose of a B2B procurement analysis from ${LANG_NAME[from]} to ${LANG_NAME[to]}.

Rules:
- Input is a JSON array of strings. Output ONLY a JSON array of strings of exactly the same length and order, nothing else.
- Translate meaning naturally in professional ${LANG_NAME[to]} business and procurement language. ${to === 'fr' ? 'Use "vous". Emails open with "Bonjour [Name]," and close with "Cordialement,".' : 'Keep emails professional and concise.'}
- Never change numbers, percentages, currency amounts, dates, quantities, product names, vendor names, people's names, placeholders like [Name], URLs, or text inside quotation marks that quotes a document.
- Keep line breaks and list formatting inside a string exactly as they are.
- Do not add, merge, drop or reorder strings.`

  const translations: Record<string, string> = {}
  for (const part of chunk(items)) {
    const response = await createTrackedMessage('translate_output', {
      model: CLAUDE_CLASSIFY_MODEL,
      max_tokens: 8000,
      temperature: 0,
      system,
      messages: [{ role: 'user', content: JSON.stringify(part.map((p) => p.value)) }],
    })
    const parsed = parseJsonFromContent(getResponseText(response))
    if (!Array.isArray(parsed) || parsed.length !== part.length || parsed.some((s) => typeof s !== 'string')) {
      throw new Error(`Translation returned ${Array.isArray(parsed) ? parsed.length : 'no'} strings for ${part.length}`)
    }
    part.forEach((p, i) => { translations[p.path] = parsed[i] as string })
  }
  return applyTranslations(output, translations)
}
