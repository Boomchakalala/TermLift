import type { ExtractionResult } from '@/lib/scoring'
import { isExpired, toIsoDate } from '@/lib/scoring'
import { topicOverlap } from '@/lib/email-asks'

/**
 * Rule-based red flags on the renewal / date fields. These are the dormant
 * red-flags.ts rules 1, 2, 10 and 11, pointed at fields the live extraction
 * now produces (ExtractionResult.renewalTerms / quoteDates) instead of the
 * never-populated rigid extraction. Deterministic: same fields, same flags.
 *
 * They are merged with the model's flags by topic (see mergeCodeFlags): when
 * the model already raised the issue, its richer wording stays and only the
 * severity is lifted to the rule's; otherwise the rule's flag is appended.
 */
export interface CodeFlag {
  type: string
  severity: 'high' | 'medium' | 'low'
  score_category: 'pricing' | 'terms' | 'leverage'
  issue: string
  why_it_matters: string
  what_to_ask_for: string
  if_they_push_back: string
  /** Which rule produced it — kept on the flag so the UI/admin can tell code from model. */
  source_rule: string
  [k: string]: unknown
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function detectCodeFlags(extraction: ExtractionResult, asOf: string | undefined, totalCommitmentLabel?: string): CodeFlag[] {
  const flags: CodeFlag[] = []
  const rt = extraction.renewalTerms
  const qd = extraction.quoteDates
  const total = totalCommitmentLabel || 'the contract value'

  // ── Rule 1: auto-renewal notice window ──────────────────────────────────
  if (rt?.autoRenew) {
    const days = rt.noticeDays
    if (days == null) {
      flags.push({
        type: 'Renewal', severity: 'medium', score_category: 'terms', source_rule: 'auto_renew.notice_unspecified',
        issue: 'Auto-renewal clause with no stated notice period',
        why_it_matters: 'The agreement renews by itself and the document does not say how far ahead you must cancel. That is a lock-in with an unknown deadline.',
        what_to_ask_for: 'State the notice period in the order form and set it to 30 days.',
        if_they_push_back: 'Accept 60 days only with a written renewal reminder from the vendor 90 days before term end.',
      })
    } else if (days >= 90) {
      flags.push({
        type: 'Renewal', severity: 'high', score_category: 'terms', source_rule: 'auto_renew.notice_long',
        issue: `${days}-day written notice required to stop the auto-renewal`,
        why_it_matters: `Missing the window by a day locks you into another full term at ${total} or more. A ${days}-day window is far ahead of when most teams review a renewal.`,
        what_to_ask_for: 'Reduce the cancellation notice to 30 days, or require a written renewal reminder from the vendor 120 days before term end with the cancellation right restated.',
        if_they_push_back: 'Accept 60 days only with the written reminder commitment in the order form, not by email.',
      })
    } else if (days <= 30) {
      flags.push({
        type: 'Renewal', severity: 'high', score_category: 'terms', source_rule: 'auto_renew.notice_short',
        issue: `Auto-renewal with only ${days}-day notice period`,
        why_it_matters: `A ${days}-day window is tight for a contract of this size. Miss it and you are locked in for another term at whatever price the vendor sets.`,
        what_to_ask_for: 'Extend the auto-renewal notice to at least 60 days',
        if_they_push_back: 'Request a written reminder email 90 days before the renewal date',
      })
    } else if (days <= 60) {
      flags.push({
        type: 'Renewal', severity: 'medium', score_category: 'terms', source_rule: 'auto_renew.notice_medium',
        issue: `Auto-renewal with ${days}-day notice period`,
        why_it_matters: `${days} days gives limited time to evaluate alternatives before the renewal kicks in.`,
        what_to_ask_for: 'Extend the notice period to 90 days',
        if_they_push_back: 'Request an email reminder 90 days before renewal',
      })
    }
  }

  // ── Rule 2: renewal price escalation ────────────────────────────────────
  if (rt && (rt.escalationMinPct != null || rt.escalationCapPct != null || rt.extraIncreaseAllowed)) {
    const min = rt.escalationMinPct
    const cap = rt.escalationCapPct
    if (cap == null) {
      const stated = min != null ? `a minimum of ${min}%` : 'an unstated amount'
      flags.push({
        type: 'Renewal', severity: 'high', score_category: 'terms', source_rule: 'escalation.no_cap',
        issue: `Renewal pricing rises by ${stated} per year with no cap${rt.extraIncreaseAllowed ? ', and the vendor may increase beyond that' : ''}`,
        why_it_matters: `There is no ceiling on what the next term costs. On ${total} every uncapped point compounds over the renewal term.`,
        what_to_ask_for: `Change "minimum of ${min ?? 'X'}%" to "not to exceed ${min ?? 3}%" and remove the vendor's right to increase beyond it, in the order form.`,
        if_they_push_back: 'Accept a hard cap at CPI or 4%, whichever is lower, with no discretionary increase.',
      })
    } else if (cap > 5) {
      flags.push({
        type: 'Commercial', severity: 'high', score_category: 'pricing', source_rule: 'escalation.cap_over_5',
        issue: `Price escalation clause with ${cap}% cap, well above inflation`,
        why_it_matters: `A ${cap}% annual increase on ${total} adds significant cost over multi-year terms. Standard is 3-5% or CPI.`,
        what_to_ask_for: 'Cap annual increases at 3% or CPI, whichever is lower',
        if_they_push_back: 'Lock pricing for the full initial term in exchange for the commitment',
      })
    } else if (cap > 3) {
      flags.push({
        type: 'Commercial', severity: 'medium', score_category: 'pricing', source_rule: 'escalation.cap_over_3',
        issue: `Price escalation clause capped at ${cap}%`,
        why_it_matters: `${cap}% is slightly above typical CPI. Over 3 years this compounds.`,
        what_to_ask_for: 'Reduce the cap to 3% or tie it to CPI',
        if_they_push_back: 'Accept the current cap but lock first-year pricing',
      })
    }
  }

  // ── Rules 10 + 11: quote validity vs the server clock ───────────────────
  const expires = toIsoDate(qd?.expires)
  const today = toIsoDate(asOf)
  if (expires && today) {
    if (isExpired(expires, today)) {
      flags.push({
        type: 'Commercial', severity: 'medium', score_category: 'leverage', source_rule: 'quote.expired',
        issue: `Quote expired on ${fmtDate(expires)}`,
        why_it_matters: 'The printed prices and discounts are no longer binding. Any deadline pressure in the document is historical, and the vendor can re-price when asked for a fresh quote.',
        what_to_ask_for: 'Ask for a refreshed quote that keeps or improves the printed discounts before negotiating anything else.',
        if_they_push_back: 'If the vendor re-prices upward, the original quote is your anchor: ask them to honour it as the starting point.',
      })
    } else {
      const days = Math.round((Date.parse(`${expires}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
      if (days >= 0 && days <= 7) {
        flags.push({
          type: 'Commercial', severity: 'low', score_category: 'leverage', source_rule: 'quote.expires_soon',
          issue: `Quote expires in ${days} day${days === 1 ? '' : 's'}`,
          why_it_matters: 'Vendors use short validity periods to create urgency. The quote will almost always be extended if you ask.',
          what_to_ask_for: 'Request a 2-week extension to complete your evaluation',
          if_they_push_back: 'Most vendors extend; it costs them nothing',
        })
      }
    }
  }

  return flags
}

type LlmFlag = { type?: string; severity?: string; score_category?: string; issue?: string; why_it_matters?: string; what_to_ask_for?: string; if_they_push_back?: string; [k: string]: unknown }
const SEV = { high: 3, medium: 2, low: 1 } as const

/**
 * Merge rule flags into the model's list. Same topic (≥0.5 token overlap on
 * the issue, or same renewal subject) → keep the model's wording, lift the
 * severity to the rule's if higher. Otherwise append the rule flag.
 */
export function mergeCodeFlags<T extends LlmFlag>(modelFlags: T[], codeFlags: CodeFlag[]): Array<T | CodeFlag> {
  const out: Array<T | CodeFlag> = [...(modelFlags || [])]
  for (const cf of codeFlags) {
    const idx = out.findIndex((f) => sameTopic(f as unknown as LlmFlag, cf))
    if (idx >= 0) {
      const existing = out[idx] as unknown as LlmFlag
      const cur = SEV[(String(existing.severity || 'medium').toLowerCase() as keyof typeof SEV)] ?? 2
      if (SEV[cf.severity] > cur) out[idx] = { ...existing, severity: cf.severity } as T
      if (!existing.source_rule) out[idx] = { ...(out[idx] as object), source_rule: `model+${cf.source_rule}` } as unknown as T
      continue
    }
    out.push(cf)
  }
  return out
}

function sameTopic(a: LlmFlag, b: CodeFlag): boolean {
  const issueA = String(a.issue || '')
  // Subject words decide first: a flag about the uplift is never the notice flag, whatever tokens overlap.
  const s = issueA.toLowerCase()
  const escalation = /(escalat|uplift|price increase|fee increase|increase (in|of|by)|raise (fees|prices|pricing)|uncapped|no cap)/.test(s)
  const notice = /(notice|cancel|non-renewal|renewal window|opt[- ]out)/.test(s)
  const expiry = /(expire|expiry|expiration|valid until|validity|deadline)/.test(s)
  if (b.source_rule.startsWith('auto_renew')) return notice && !escalation
  if (b.source_rule.startsWith('escalation')) return escalation
  if (b.source_rule.startsWith('quote.')) return expiry
  return topicOverlap(issueA, b.issue) >= 0.5
}
