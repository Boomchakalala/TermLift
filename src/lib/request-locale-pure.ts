import { normalizeLocale, type OutputLocale } from './output-language'

/**
 * The one precedence used by every AI route and by the UI (src/i18n/request.ts):
 * explicit cookie → explicit body value → browser Accept-Language → English.
 * Pure so it can be unit-tested; `resolveRequestLocale()` wraps it with next/headers.
 */
export function pickLocale(input: { cookie?: string | null; body?: unknown; acceptLanguage?: string | null }): OutputLocale {
  if (input.cookie === 'en' || input.cookie === 'fr') return input.cookie
  if (input.body === 'en' || input.body === 'fr') return input.body
  const al = (input.acceptLanguage || '').toLowerCase()
  if (al.startsWith('fr')) return 'fr'
  return normalizeLocale(undefined)
}
