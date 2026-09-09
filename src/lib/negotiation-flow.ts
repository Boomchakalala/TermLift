import { dealHasFullAnalysis, deepAnalysisIsRunning } from '@/lib/deep-analysis-status'

/**
 * One guided workflow per deal:
 *
 *   Analysis → Strategy → Round 1 → Round 2 → … → Outcome
 *
 * Derived from data that already exists (rounds, their output_json, the deal
 * status, an open negotiation request). No new gating: whether a step is
 * reachable is still decided server-side by canAccessFullAnalysis() and the
 * round/email routes; this module only answers "where is the deal, and what
 * should the person do next". Pure, so the whole state table is unit-tested.
 */
export interface FlowRound {
  round_number: number
  output_json?: unknown
}

export interface FlowInput {
  dealId: string
  status?: string | null
  rounds?: FlowRound[] | null
  /** Status of an open TermLift negotiation request on this deal, if any. */
  negotiationRequestStatus?: string | null
  /** Where an open request's page lives (only used for the TermLift phase). */
  negotiationPageHref?: string | null
}

export type FlowPhase = 'quick' | 'full_running' | 'full' | 'round_emailed' | 'vendor_replied' | 'termlift' | 'closed'

export interface FlowStep {
  key: string
  label: { en: string; fr: string }
  state: 'done' | 'current' | 'next'
  /** Set on round steps. */
  round?: number
  href?: string
}

export type NextActionKey = 'unlock_full' | 'full_running' | 'prepare_round_1' | 'send_and_upload' | 'generate_counter' | 'open_negotiation' | 'view_outcome'

export interface NextAction {
  key: NextActionKey
  title: { en: string; fr: string }
  body: { en: string; fr: string }
  cta: { en: string; fr: string }
  /** In-page anchor or route the CTA goes to. The quick-state CTA is also wired to run Full Analysis directly. */
  href: string
  /** Round the action concerns (emailed round, or the reply round to answer). */
  round?: number
  /** Offer "Agreement reached? Close the deal" alongside. */
  offerClose: boolean
}

export interface NegotiationFlow {
  phase: FlowPhase
  steps: FlowStep[]
  next: NextAction
  /** Highest round number, 0 when no rounds. */
  latestRound: number
  hasDeep: boolean
  latestRoundEmailed: boolean
}

function emailed(output: unknown): boolean {
  const o = output as { email_drafts?: { neutral?: { body?: unknown } } } | null | undefined
  return !!o?.email_drafts?.neutral?.body
}

const L = (en: string, fr: string) => ({ en, fr })

export function deriveNegotiationFlow(input: FlowInput): NegotiationFlow {
  const rounds = [...(input.rounds || [])].sort((a, b) => a.round_number - b.round_number)
  const latest = rounds[rounds.length - 1]
  const latestRound = latest?.round_number ?? 0
  // Deal-level: Full Analysis unlocks once, on the round it ran on; later rounds inherit it.
  const hasDeep = dealHasFullAnalysis(rounds)
  const running = !!latest && deepAnalysisIsRunning(latest.output_json)
  const latestRoundEmailed = !!latest && emailed(latest.output_json)
  const anyEmailed = rounds.some((r) => emailed(r.output_json))
  const closed = !!input.status && input.status.startsWith('closed_')
  const won = input.status === 'closed_won'
  const nr = input.negotiationRequestStatus
  const termlift = !closed && !!nr && !nr.startsWith('closed_')

  // ── phase ────────────────────────────────────────────────────────────────
  let phase: FlowPhase
  if (closed) phase = 'closed'
  else if (termlift) phase = 'termlift'
  else if (!hasDeep) phase = running ? 'full_running' : 'quick'
  else if (rounds.length <= 1 && !anyEmailed) phase = 'full'
  else if (latestRoundEmailed) phase = 'round_emailed'
  else phase = 'vendor_replied'

  // ── steps ────────────────────────────────────────────────────────────────
  // Rounds shown: every recorded round, plus one upcoming round while the deal
  // is open (so the rail never implies the negotiation stops at two), and at
  // least Round 1 and Round 2 before any negotiation has started.
  const steps: FlowStep[] = []
  steps.push({ key: 'analysis', label: L('Analysis', 'Analyse'), state: 'done', href: '#overview' })
  const strategyDone = hasDeep || phase === 'termlift' || (closed && (hasDeep || anyEmailed || rounds.length > 1))
  steps.push({ key: 'strategy', label: L('Strategy', 'Stratégie'), state: strategyDone ? 'done' : phase === 'closed' ? 'next' : 'current', href: hasDeep ? '#playbook' : '#deep-analysis' })

  if (phase === 'termlift') {
    steps.push({ key: 'termlift', label: L('TermLift negotiates', 'TermLift négocie'), state: 'current', href: input.negotiationPageHref || undefined })
  } else {
    const shownRounds = Math.max(rounds.length, 1) + (closed ? 0 : 1)
    const minRounds = closed ? Math.max(rounds.length, 1) : Math.max(shownRounds, 2)
    for (let n = 1; n <= minRounds; n++) {
      const rec = rounds.find((r) => r.round_number === n)
      // A round is done once the vendor has answered it (the next round exists);
      // the latest round stays current from "prepare" through "sent, awaiting reply".
      let state: FlowStep['state']
      if (closed) state = rec ? 'done' : 'next'
      else if (!hasDeep) state = 'next'
      else if (rec && n < latestRound) state = 'done'
      else if (rec && n === latestRound) state = 'current'
      else state = 'next'
      steps.push({ key: `round_${n}`, label: L(`Round ${n}`, `Tour ${n}`), state, round: n, href: n <= latestRound ? '#email-section' : '#add-round' })
    }
  }
  steps.push({ key: 'outcome', label: L('Outcome', 'Résultat'), state: closed ? 'current' : 'next', href: closed && won ? `/app/deal/${input.dealId}/outcome` : '#rounds' })

  // ── next action ──────────────────────────────────────────────────────────
  let next: NextAction
  switch (phase) {
    case 'closed':
      next = {
        key: 'view_outcome',
        title: won ? L('Deal closed — won', 'Dossier clôturé — gagné') : L('Deal closed', 'Dossier clôturé'),
        body: L('The outcome is recorded. Reopen the deal from the menu if the negotiation resumes.', 'Le résultat est enregistré. Rouvrez le dossier depuis le menu si la négociation reprend.'),
        cta: won ? L('View outcome', 'Voir le résultat') : L('View rounds', 'Voir les tours'),
        href: won ? `/app/deal/${input.dealId}/outcome` : '#rounds',
        offerClose: false,
      }
      break
    case 'termlift':
      next = {
        key: 'open_negotiation',
        title: L('TermLift is negotiating this deal', 'TermLift négocie ce dossier'),
        body: L('Follow every status change and approve the outcome from the negotiation page.', 'Suivez chaque changement de statut et validez le résultat depuis la page de négociation.'),
        cta: L('Open the negotiation', 'Ouvrir la négociation'),
        href: input.negotiationPageHref || '#',
        offerClose: false,
      }
      break
    case 'full_running':
      next = {
        key: 'full_running',
        title: L('Building your negotiation strategy', 'Construction de votre stratégie de négociation'),
        body: L('A couple of minutes. The ordered asks, target positions, fallbacks and the negotiation sequence appear below when it completes.', 'Quelques minutes. Les demandes ordonnées, les positions cibles, les replis et la séquence de négociation apparaîtront ci-dessous.'),
        cta: L('Building the Playbook…', 'Construction du Plan…'),
        href: '#deep-analysis',
        offerClose: false,
      }
      break
    case 'quick':
      next = {
        key: 'unlock_full',
        title: L('Build your negotiation strategy', 'Construisez votre stratégie de négociation'),
        body: L('Get the ordered asks with amounts, target positions, fallbacks, your leverage and the ready-to-send negotiation sequence.', 'Obtenez les demandes ordonnées et chiffrées, les positions cibles, les replis, vos leviers et la séquence prête à envoyer.'),
        cta: L('Get the Negotiation Playbook', 'Obtenir le Plan de négociation'),
        href: '#deep-analysis',
        offerClose: false,
      }
      break
    case 'full':
      next = {
        key: 'prepare_round_1',
        title: L('Prepare Round 1', 'Préparez le tour 1'),
        body: L('Add what the quote can’t tell us — target outcome, budget, alternatives, deadline — then generate the Round 1 negotiation email. Everything is optional.', 'Ajoutez ce que le devis ne peut pas nous dire — objectif, budget, alternatives, échéance — puis générez l’e-mail du tour 1. Tout est facultatif.'),
        cta: L('Prepare Round 1', 'Préparer le tour 1'),
        href: '#email-section',
        round: 1,
        offerClose: false,
      }
      break
    case 'round_emailed':
      next = {
        key: 'send_and_upload',
        title: L(`Send the Round ${latestRound} email, then add the vendor’s response`, `Envoyez l’e-mail du tour ${latestRound}, puis ajoutez la réponse du fournisseur`),
        body: L('Copy the email below and send it. When the vendor replies, upload or paste their response and TermLift prepares the next round.', 'Copiez l’e-mail ci-dessous et envoyez-le. Quand le fournisseur répond, importez ou collez sa réponse et TermLift prépare le tour suivant.'),
        cta: L('Add vendor response', 'Ajouter la réponse du fournisseur'),
        href: '#add-round',
        round: latestRound,
        offerClose: true,
      }
      break
    case 'vendor_replied':
    default:
      next = {
        key: 'generate_counter',
        title: L(`Round ${latestRound} — review the vendor’s response`, `Tour ${latestRound} — examinez la réponse du fournisseur`),
        body: L('See what changed, what they conceded and what they refused, then generate your counter.', 'Voyez ce qui a changé, ce qu’ils ont concédé et refusé, puis générez votre contre-proposition.'),
        cta: L(`Generate Round ${latestRound} counter`, `Générer la contre-proposition du tour ${latestRound}`),
        href: '#email-section',
        round: latestRound,
        offerClose: true,
      }
  }

  return { phase, steps, next, latestRound, hasDeep, latestRoundEmailed }
}
