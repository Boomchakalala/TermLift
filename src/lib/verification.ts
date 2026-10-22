import type { OutcomeProvenance } from '@/lib/close-outcome'

/**
 * What survives when the document behind a `document_verified` outcome is
 * gone: structured evidence only. The SHA-256 is a fingerprint of the file
 * bytes — proof of *which* file was processed, never a way back to its
 * content. Nothing in this record may carry text from the document.
 */
/** savings_amount converted to the account's base currency once, with the rate of the close day. Never recomputed. */
export interface FrozenSavings {
  amount: number
  /** Base currency the freeze was made in (EUR, USD, …). */
  currency: string
  /** amount / savings_amount — the rate used, for audit. */
  fx_rate: number
  /** Close time, or the backfill date for deals closed before this existed. */
  frozen_at: string
}

export interface VerificationRecord {
  version: 1
  tier: OutcomeProvenance
  /** Present on won deals closed after 2026-10-22 (or backfilled). */
  savings_frozen?: FrozenSavings | null
  /** How the figure was established. */
  method: 'final_document_extract' | 'admin_document' | 'user_entry'
  verified_at: string
  /** Confirmed final total (deal currency), the same number written to deals.final_total. */
  confirmed_total: number | null
  currency: string | null
  document: {
    /** MIME type or extension, e.g. application/pdf */
    type: string | null
    size_bytes: number | null
    /** Hex SHA-256 of the raw file bytes. */
    sha256: string | null
  } | null
  /** What the model read off the document before the person confirmed or edited it. */
  extracted_total: number | null
  /** Whether the confirmed total equals the extracted one within 0.5 %. Null when either side is unknown. */
  matched: boolean | null
  /** The model that produced extracted_total, when one did. */
  model: string | null
}

export interface DocumentEvidenceInput {
  sha256?: unknown
  type?: unknown
  sizeBytes?: unknown
  extractedTotal?: unknown
  model?: unknown
}

const SHA256_RE = /^[0-9a-f]{64}$/i

function hexOrNull(v: unknown): string | null {
  return typeof v === 'string' && SHA256_RE.test(v) ? v.toLowerCase() : null
}
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}
function strOrNull(v: unknown, max = 120): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}

/**
 * Build the record for a close. Pure. A `document_verified` tier without a
 * fingerprint is still allowed (the admin path saw the file in storage) but
 * `document` is then null, which the benchmark preview can show as-is.
 */
export function buildVerificationRecord(input: {
  tier: OutcomeProvenance | null
  method: VerificationRecord['method']
  confirmedTotal: number | null
  currency: string | null
  evidence?: DocumentEvidenceInput | null
  now?: Date
}): VerificationRecord | null {
  if (!input.tier) return null
  const ev = input.evidence || {}
  const sha256 = hexOrNull(ev.sha256)
  const type = strOrNull(ev.type, 80)
  const size = numOrNull(ev.sizeBytes)
  const extracted = numOrNull(ev.extractedTotal)
  const confirmed = numOrNull(input.confirmedTotal)
  const hasDoc = !!(sha256 || type || size)
  return {
    version: 1,
    tier: input.tier,
    method: input.method,
    verified_at: (input.now || new Date()).toISOString(),
    confirmed_total: confirmed,
    currency: input.currency ? input.currency.toUpperCase().slice(0, 3) : null,
    document: hasDoc ? { type, size_bytes: size, sha256 } : null,
    extracted_total: extracted,
    matched: extracted != null && confirmed != null ? Math.abs(extracted - confirmed) / confirmed <= 0.005 : null,
    model: strOrNull(ev.model, 80),
  }
}

/** SHA-256 of a byte buffer as lowercase hex (server side). */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).digest('hex')
}
