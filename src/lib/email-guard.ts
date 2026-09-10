/**
 * Wording guards on generated vendor emails (2026-09-11). The prompt forbids
 * these framings when the facts don't support them; this is the code check
 * behind it: any sentence that still uses one is removed before persistence.
 */
const NEW_LOGO = /\b(new[- ]logo|new customer|first[- ]time (customer|buyer)|as a new (client|account)|new (client|account) (for|to) you)\b/i
const ALTERNATIVES = /\b(alternatives?|competing (quote|offer|bid|proposal)s?|other (vendors?|suppliers?|providers?|options?)|shopping (this )?around|elsewhere|competitor)\b/i

/** Remove every sentence that uses a forbidden framing. Sentences end at . ! ? or a line break. */
export function sanitizeEmailBody(body: string, allow: { newLogo: boolean; alternatives: boolean }): { body: string; removed: string[] } {
  const removed: string[] = []
  const lines = String(body || '').split(/\n/)
  const out = lines.map((line) => {
    const sentences = line.match(/[^.!?]+[.!?]+["')]?\s*|[^.!?]+$/g) || [line]
    const kept = sentences.filter((s) => {
      const bad = (!allow.newLogo && NEW_LOGO.test(s)) || (!allow.alternatives && ALTERNATIVES.test(s))
      if (bad) removed.push(s.trim())
      return !bad
    })
    return kept.join('').replace(/\s+$/g, '')
  })
  return { body: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), removed }
}
