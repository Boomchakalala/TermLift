// ─────────────────────────────────────────────────────────────────────────────
// Vendor name normalization + similarity.
//
// normalizeVendorName turns a display name into a stable matching key:
//   lowercase, strip accents, strip punctuation, strip trailing legal suffixes,
//   collapse whitespace.  "Uni-Vert Paysages SARL" -> "univert paysages"
//
// vendorKeySimilarity is used ONLY to SUGGEST merges in the UI (never to auto-merge).
// Same input always produces the same output — no randomness, no I/O.
// ─────────────────────────────────────────────────────────────────────────────

/** Trailing tokens stripped from a name before keying. Extend as needed. */
export const LEGAL_SUFFIXES = new Set([
  'llc', 'inc', 'ltd', 'sarl', 'sas', 'gmbh', 'bv', 'corp', 'co',
])

export function normalizeVendorName(name: string): string {
  if (!name) return ''
  // lowercase + strip accents (decompose, drop combining marks U+0300–U+036F)
  let s = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  // drop punctuation entirely (so "uni-vert" -> "univert", not "uni vert")
  s = s.replace(/[^a-z0-9\s]/g, '')
  // collapse whitespace
  s = s.replace(/\s+/g, ' ').trim()
  // strip trailing legal-suffix tokens ("Foo Co Ltd" -> "foo")
  const tokens = s.split(' ').filter(Boolean)
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop()
  }
  return tokens.join(' ')
}

/** Trailing suffixes for shortenVendorDisplayName — matched as whole words only. */
const DISPLAY_LEGAL_SUFFIXES = new Set([
  'international', 'inc', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co',
  'gmbh', 'sas', 'sarl', 'sa', 'bv', 'plc', 'ag', 'se',
])

/**
 * Shortens a vendor/company display name for compact UI (deal header,
 * breadcrumb) by stripping trailing legal-entity suffixes and parenthetical
 * asides, e.g. "Docusign International (EMEA) Limited" -> "Docusign".
 *
 * Only pops whole trailing tokens (never a mid-word regex match), so it can't
 * corrupt names that happen to contain a suffix as a substring — the earlier
 * version's `S\.?A\.?S?\.?` alternative matched "Sa" inside "Salesforce" and
 * turned it into "lesforce".
 */
export function shortenVendorDisplayName(name: string): string {
  if (!name) return ''
  const s = name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  const tokens = s.split(' ')
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1].replace(/\.+$/, '').toLowerCase()
    if (DISPLAY_LEGAL_SUFFIXES.has(last)) tokens.pop()
    else break
  }
  // "Datadog, Inc." -> tokens ["Datadog,", "Inc."] -> pop "Inc." -> "Datadog," — drop the separator
  // left behind on the last kept token (comma, dash, ampersand).
  const joined = tokens.join(' ').replace(/[\s,;:&\-–—]+$/u, '').trim()
  return joined || name.trim()
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.slice(i, i + 2)
    m.set(bg, (m.get(bg) || 0) + 1)
  }
  return m
}

/**
 * Dice coefficient over character bigrams of two ALREADY-normalized keys.
 * 1 = identical, 0 = nothing in common. Used to suggest (not perform) merges.
 */
export function vendorKeySimilarity(keyA: string, keyB: string): number {
  if (keyA === keyB) return keyA.length === 0 ? 0 : 1
  if (keyA.length < 2 || keyB.length < 2) return 0
  const A = bigrams(keyA)
  const B = bigrams(keyB)
  let inter = 0
  let total = 0
  A.forEach((count, bg) => {
    total += count
    const other = B.get(bg)
    if (other) inter += Math.min(count, other)
  })
  B.forEach((count) => { total += count })
  return total === 0 ? 0 : (2 * inter) / total
}

/** Convenience: similarity between two raw display names (normalizes first). */
export function vendorNameSimilarity(a: string, b: string): number {
  return vendorKeySimilarity(normalizeVendorName(a), normalizeVendorName(b))
}
