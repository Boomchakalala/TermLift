/**
 * Serialisable row model for the Home deals table. Built server-side (real app
 * and demo) and handed to the client list component.
 */
import { deriveDealStage, deriveNegotiationMode, type DealStage, type NegotiationMode } from '@/lib/deal-stage'
import {
  type DealLike, getAchievedSavings, getCategory, getDealCurrency, getDealType, getPotentialSavings,
  getRedFlagCount, getScore, getTotalCommitment, getVendorName, isClosed, isWon,
} from '@/lib/deal-metrics'
import { formatCurrency, normalizeAmount } from '@/lib/currency'
import { latestConfirmedVendorOffer, type ConfirmedVendorOffer } from '@/lib/vendor-offer'

export interface HomeRow {
  id: string
  vendor: string
  category: string
  dealType?: string
  stage: DealStage
  /** Who runs the negotiation (self / termlift) once the deal reached that stage. */
  mode: NegotiationMode
  closed: boolean
  won: boolean
  /** status === 'closed_lost' (the only closed sub-status with its own badge). */
  lost: boolean
  /** TermLift negotiation is waiting on the user. */
  waitingOnClient: boolean
  /** Deal is stuck at Quick — the "unlock Deep Analysis" hint. */
  needsUnlock: boolean
  score?: number
  flags: number
  total: string
  /** Formatted savings figure in the deal's own currency; '' when not meaningful. */
  savings: string
  savingsKind: 'saved' | 'potential' | 'none'
  roundCount: number
  updatedAt: string
  closedAt: string | null
  /** Latest confirmed or document-verified vendor offer, for the close modal's prefill. Never an inferred one. */
  confirmedOffer: ConfirmedVendorOffer | null
}

export function buildHomeRows(deals: DealLike[], requestStatusByDeal: Map<string, string> = new Map()): HomeRow[] {
  return deals.map((d) => {
    const nr = requestStatusByDeal.get(d.id)
    const stage = deriveDealStage({ status: d.status, rounds: d.rounds, negotiationRequestStatus: nr })
    const mode = deriveNegotiationMode({ status: d.status, rounds: d.rounds, negotiationRequestStatus: nr })
    const closed = isClosed(d)
    const won = isWon(d)
    const cur = getDealCurrency(d)
    const achieved = getAchievedSavings(d)
    const potential = getPotentialSavings(d)
    const totalRaw = getTotalCommitment(d)
    const total = totalRaw ? normalizeAmount(totalRaw) : ''
    let savings = ''
    let savingsKind: HomeRow['savingsKind'] = 'none'
    if (closed && achieved > 0) {
      savings = formatCurrency(Math.round(achieved), cur)
      savingsKind = 'saved'
    } else if (!closed && potential >= 100) {
      savings = formatCurrency(Math.round(potential), cur)
      savingsKind = 'potential'
    }
    return {
      id: d.id,
      vendor: getVendorName(d),
      category: getCategory(d),
      dealType: getDealType(d),
      stage,
      mode,
      closed,
      won,
      lost: d.status === 'closed_lost',
      waitingOnClient: nr === 'waiting_for_client_info',
      needsUnlock: stage === 'quick',
      score: getScore(d),
      flags: getRedFlagCount(d),
      total,
      savings,
      savingsKind,
      roundCount: d.rounds?.length || 0,
      updatedAt: d.updated_at,
      closedAt: d.closed_at ?? null,
      confirmedOffer: latestConfirmedVendorOffer(d.rounds),
    }
  })
}
