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

// ── Voice guard (2026-09-11) ──────────────────────────────────────────────────
// The prompt forbids these phrases; this rewrites any that slip through. Phrase
// swaps keep the sentence (and the target figure it may carry); the two
// playbook-isms that have no buyer equivalent drop their sentence.
const PHRASE_SWAPS: Array<[RegExp, string]> = [
  [/\bland(?:ing)? (?:the total |the price |this |it )?at\b/gi, 'get to'],
  [/\bland (?:the total|the price|this|it)\b/gi, 'settle the total'],
  [/\bstarting point\b/gi, 'basis'],
  [/\bblockers?\b/gi, 'points'],
  [/\bgap\b/gi, 'difference'],
  [/\bincentives?\b/gi, 'reasons'],
]
const DROP_SENTENCE = /\b(treat nothing as agreed|nothing (else )?is agreed|nothing is (final|settled)|confirm the contract terms)\b/i

export function applyVoiceGuard(body: string): { body: string; changed: string[] } {
  const changed: string[] = []
  const lines = String(body || '').split(/\n/)
  const out = lines.map((line) => {
    const sentences = line.match(/[^.!?]+[.!?]+["')]?\s*|[^.!?]+$/g) || [line]
    const kept = sentences.filter((s) => { const drop = DROP_SENTENCE.test(s); if (drop) changed.push(`dropped: ${s.trim()}`); return !drop })
    return kept.map((s) => {
      let t = s
      for (const [re, to] of PHRASE_SWAPS) { re.lastIndex = 0; if (re.test(t)) { changed.push(`swapped: ${re.source}`); re.lastIndex = 0; t = t.replace(re, to) } }
      return t
    }).join('').replace(/\s+$/g, '')
  })
  return { body: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), changed }
}
