import React from 'react'
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'
import type { DealOutput } from '@/types'
import path from 'path'
import fs from 'fs'

function getLogoBase64(): string {
  try {
    const logoPath = path.join(process.cwd(), 'public', 'termlift-logo.png')
    const logoBuffer = fs.readFileSync(logoPath)
    return `data:image/png;base64,${logoBuffer.toString('base64')}`
  } catch {
    return ''
  }
}

const c = {
  emerald: '#059669',
  emeraldDark: '#047857',
  emeraldLight: '#d1fae5',
  emeraldBg: '#ecfdf5',
  amber: '#d97706',
  amberLight: '#fef3c7',
  red: '#dc2626',
  redLight: '#fee2e2',
  slate900: '#0f172a',
  slate700: '#334155',
  slate500: '#64748b',
  slate400: '#94a3b8',
  slate300: '#cbd5e1',
  slate200: '#e2e8f0',
  slate100: '#f1f5f9',
  slate50: '#f8fafc',
  white: '#ffffff',
}

const s = StyleSheet.create({
  page: {
    paddingTop: 50,
    paddingBottom: 60,
    paddingHorizontal: 44,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: c.slate700,
  },
  // Green accent bar at top
  accent: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: c.emerald,
  },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 28,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: c.slate200,
  },
  logo: { width: 110, height: 28 },
  headerRight: { alignItems: 'flex-end' as const },
  headerLabel: { fontSize: 9, color: c.slate400, marginBottom: 2 },
  headerDate: { fontSize: 9, color: c.slate500, fontFamily: 'Helvetica-Bold' },
  // Title
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: c.slate900, marginBottom: 6 },
  verdict: { fontSize: 10, color: c.slate500, lineHeight: 1.5, marginBottom: 24 },
  // Score row
  scoreRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  scoreBox: {
    width: 90,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  scoreNumber: { fontSize: 32, fontFamily: 'Helvetica-Bold', lineHeight: 1 },
  scoreLabel: { fontSize: 8, marginTop: 4, textAlign: 'center' as const, lineHeight: 1.3 },
  statBox: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: c.slate50,
    borderWidth: 1,
    borderColor: c.slate200,
  },
  statLabel: { fontSize: 7, color: c.slate400, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 3 },
  statValue: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: c.slate900 },
  statSub: { fontSize: 8, color: c.slate500, marginTop: 2 },
  // Score breakdown
  breakdownRow: { flexDirection: 'row', gap: 12, marginBottom: 6 },
  breakdownBar: { flex: 1 },
  breakdownLabel: { fontSize: 8, color: c.slate500, marginBottom: 3 },
  breakdownTrack: { height: 5, backgroundColor: c.slate100, borderRadius: 3 },
  breakdownFill: { height: 5, borderRadius: 3 },
  breakdownPct: { fontSize: 8, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  rationale: { fontSize: 8, color: c.slate400, fontStyle: 'italic' as const, marginTop: 4, marginBottom: 20 },
  // Sections
  section: { marginBottom: 22 },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: c.slate900,
    marginBottom: 10,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: c.slate200,
  },
  // Quick read
  quickReadRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  quickReadCol: { flex: 1, padding: 10, borderRadius: 6 },
  quickReadLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 6 },
  quickReadItem: { fontSize: 9, marginBottom: 4, color: c.slate700, lineHeight: 1.4 },
  conclusion: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: c.slate900, padding: 10, backgroundColor: c.slate50, borderRadius: 6, lineHeight: 1.4 },
  // Red flags
  flagCard: {
    padding: 12,
    marginBottom: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: c.slate200,
    borderLeftWidth: 3,
  },
  flagHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  flagBadge: { fontSize: 7, fontFamily: 'Helvetica-Bold', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3, textTransform: 'uppercase' as const },
  flagIssue: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: c.slate900, marginBottom: 4, lineHeight: 1.4 },
  flagBody: { fontSize: 9, color: c.slate700, marginBottom: 6, lineHeight: 1.5 },
  flagAskLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: c.emerald, marginBottom: 2 },
  flagAskText: { fontSize: 9, color: c.emeraldDark, lineHeight: 1.4 },
  // Savings
  savingsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  savingsTotal: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: c.emeraldBg, borderWidth: 1, borderColor: c.emeraldLight },
  savingsTotalLabel: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: c.emerald, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  savingsTotalAmount: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: c.emerald, marginTop: 2 },
  savingsItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 10, marginBottom: 5, borderRadius: 6, borderWidth: 1 },
  savingsAsk: { flex: 1, fontSize: 9, color: c.slate700, lineHeight: 1.4 },
  savingsAmount: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginLeft: 12, flexShrink: 0 },
  savingsRationale: { fontSize: 8, color: c.slate500, fontStyle: 'italic' as const, marginTop: 3 },
  // Strategy
  strategyLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: c.slate400, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 6 },
  strategyItem: { fontSize: 9, color: c.slate700, marginBottom: 5, paddingLeft: 10, lineHeight: 1.4 },
  strategyRow: { flexDirection: 'row', gap: 14, marginTop: 14 },
  strategyCol: { flex: 1 },
  askBadge: { fontSize: 7, fontFamily: 'Helvetica-Bold', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 3, marginBottom: 3 },
  // Footer
  footer: {
    position: 'absolute' as const,
    bottom: 24,
    left: 44,
    right: 44,
    borderTopWidth: 1,
    borderTopColor: c.slate200,
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: { fontSize: 7, color: c.slate400 },
  pageNumber: { fontSize: 7, color: c.slate400 },
})

function fmt(amount: number, currency: string = 'EUR'): string {
  const sym = currency === 'EUR' ? '\u20AC' : currency === 'GBP' ? '\u00A3' : currency === 'USD' ? '$' : currency
  if (amount >= 1000000) return `${sym}${(amount / 1000000).toFixed(1)}M`
  if (amount >= 1000) return `${sym}${Math.round(amount).toLocaleString('en-US')}`
  return `${sym}${Math.round(amount)}`
}

export function AnalysisPDF({ output, locale = 'en' }: { output: DealOutput; locale?: string }) {
  const logoBase64 = getLogoBase64()
  const score = output.score ?? 0
  // Same bands as the score ring in the app: ≥80 green · 65–79 amber · <65 red.
  const scoreColor = score >= 80 ? c.emerald : score >= 65 ? c.amber : c.red
  const scoreColorLight = score >= 80 ? c.emeraldLight : score >= 65 ? c.amberLight : c.redLight
  const fr = locale === 'fr'

  const ps = output.potential_savings as any
  const savingsTotal = ps?.total !== undefined ? (typeof ps.total === 'number' ? ps.total : 0) : 0
  const mustHave = ps?.must_have || []
  const niceToHave = ps?.nice_to_have || []
  const cur = ps?.currency || output.snapshot?.currency || 'EUR'

  const bd = output.score_breakdown as any
  // New deals carry 0-100 pricing/terms/leverage; legacy deals carry the 50/30/20 split.
  const bdNew = bd && Array.isArray(bd.deductions)
  const pricingPct = bd ? Math.round(((bdNew ? bd.pricing : bd.pricing_fairness) ?? 0) / (bdNew ? 100 : 50) * 100) : 0
  const termsPct = bd ? Math.round(((bdNew ? bd.terms : bd.terms_protections) ?? 0) / (bdNew ? 100 : 30) * 100) : 0
  const leveragePct = bd ? Math.round(((bdNew ? bd.leverage : bd.leverage_position) ?? 0) / (bdNew ? 100 : 20) * 100) : 0

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Green accent bar */}
        <View style={s.accent} fixed />

        {/* Header */}
        <View style={s.header} fixed>
          {logoBase64 ? <Image src={logoBase64} style={s.logo} /> : <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: c.slate900 }}>TermLift</Text>}
          <View style={s.headerRight}>
            <Text style={s.headerLabel}>{fr ? 'Analyse commerciale' : 'Commercial Analysis'}</Text>
            <Text style={s.headerDate}>{new Date().toLocaleDateString(fr ? 'fr-FR' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</Text>
          </View>
        </View>

        {/* Title + Verdict */}
        <Text style={s.title}>{output.title}</Text>
        <Text style={s.verdict}>{output.verdict}</Text>

        {/* Score + Stats */}
        <View style={s.scoreRow}>
          <View style={[s.scoreBox, { backgroundColor: scoreColorLight }]}>
            <Text style={[s.scoreNumber, { color: scoreColor }]}>{score}</Text>
            <Text style={[s.scoreLabel, { color: scoreColor }]}>{output.score_label}</Text>
          </View>
          <View style={s.statBox}>
            <Text style={s.statLabel}>{fr ? 'Engagement total' : 'Total Commitment'}</Text>
            <Text style={s.statValue}>{output.snapshot?.total_commitment}</Text>
            <Text style={s.statSub}>{output.snapshot?.term}</Text>
          </View>
          <View style={s.statBox}>
            <Text style={s.statLabel}>{fr ? 'Alertes' : 'Red Flags'}</Text>
            <Text style={[s.statValue, { color: c.red }]}>{output.red_flags?.length || 0}</Text>
          </View>
          <View style={s.statBox}>
            <Text style={[s.statLabel, { color: c.emerald }]}>{fr ? 'Economies' : 'Savings'}</Text>
            <Text style={[s.statValue, { color: c.emerald }]}>{savingsTotal > 0 ? fmt(savingsTotal, cur) : 'N/A'}</Text>
          </View>
        </View>

        {/* Score Breakdown */}
        {bd && (
          <View>
            <View style={s.breakdownRow}>
              {[
                { label: fr ? 'Prix' : 'Pricing', pct: pricingPct },
                { label: fr ? 'Conditions' : 'Terms', pct: termsPct },
                { label: fr ? 'Levier' : 'Leverage', pct: leveragePct },
              ].map((bar) => {
                const barColor = bar.pct >= 70 ? c.emerald : bar.pct >= 50 ? c.amber : c.red
                return (
                  <View key={bar.label} style={s.breakdownBar}>
                    <Text style={s.breakdownLabel}>{bar.label}</Text>
                    <View style={s.breakdownTrack}>
                      <View style={[s.breakdownFill, { width: `${bar.pct}%`, backgroundColor: barColor }]} />
                    </View>
                    <Text style={[s.breakdownPct, { color: barColor }]}>{bar.pct}%</Text>
                  </View>
                )
              })}
            </View>
            {output.score_rationale && <Text style={s.rationale}>{output.score_rationale}</Text>}
          </View>
        )}

        {/* Quick Read */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>{fr ? 'Apercu rapide' : 'Quick Read'}</Text>
          <View style={s.quickReadRow}>
            <View style={[s.quickReadCol, { backgroundColor: c.emeraldBg }]}>
              <Text style={[s.quickReadLabel, { color: c.emerald }]}>{fr ? 'Points forts' : 'What looks solid'}</Text>
              {output.quick_read?.whats_solid?.map((item, i) => (
                <Text key={i} style={s.quickReadItem}>{'\u2022'} {item}</Text>
              ))}
            </View>
            <View style={[s.quickReadCol, { backgroundColor: c.amberLight }]}>
              <Text style={[s.quickReadLabel, { color: c.amber }]}>{fr ? 'Points de vigilance' : 'What to watch'}</Text>
              {output.quick_read?.whats_concerning?.map((item, i) => (
                <Text key={i} style={s.quickReadItem}>{'\u2022'} {item}</Text>
              ))}
            </View>
          </View>
          {output.quick_read?.conclusion && <Text style={s.conclusion}>{output.quick_read.conclusion}</Text>}
        </View>

        {/* Red Flags */}
        {output.red_flags && output.red_flags.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>{fr ? 'Alertes' : 'Red Flags'} ({output.red_flags.length})</Text>
            {output.red_flags.map((flag, i) => {
              const sev = (flag as any).severity || 'medium'
              const borderColor = sev === 'high' ? c.red : c.amber
              return (
                <View key={i} style={[s.flagCard, { borderLeftColor: borderColor }]} wrap={false}>
                  <View style={s.flagHeader}>
                    <Text style={[s.flagBadge, {
                      backgroundColor: sev === 'high' ? c.redLight : c.amberLight,
                      color: sev === 'high' ? c.red : c.amber,
                    }]}>{sev}</Text>
                    <Text style={[s.flagBadge, { backgroundColor: c.slate100, color: c.slate500 }]}>{flag.type}</Text>
                  </View>
                  <Text style={s.flagIssue}>{flag.issue}</Text>
                  <Text style={s.flagBody}>{flag.why_it_matters}</Text>
                  <Text style={s.flagAskLabel}>{fr ? 'Demander :' : 'Ask for:'}</Text>
                  <Text style={s.flagAskText}>{flag.what_to_ask_for}</Text>
                </View>
              )
            })}
          </View>
        )}

        {/* Savings */}
        {(mustHave.length > 0 || niceToHave.length > 0) && (
          <View style={s.section}>
            <View style={s.savingsHeader}>
              <Text style={s.sectionTitle}>{fr ? 'Economies potentielles' : 'Potential Savings'}</Text>
              <View style={s.savingsTotal}>
                <Text style={s.savingsTotalLabel}>Total</Text>
                <Text style={s.savingsTotalAmount}>{fmt(savingsTotal, cur)}</Text>
              </View>
            </View>
            {mustHave.map((item: any, i: number) => (
              <View key={i} style={[s.savingsItem, { borderColor: c.emerald, backgroundColor: c.emeraldBg }]} wrap={false}>
                <View style={{ flex: 1 }}>
                  <Text style={s.savingsAsk}>{item.ask}</Text>
                  {item.rationale && <Text style={s.savingsRationale}>{item.rationale}</Text>}
                </View>
                <Text style={[s.savingsAmount, { color: c.emerald }]}>{fmt(item.amount || 0, cur)}</Text>
              </View>
            ))}
            {niceToHave.map((item: any, i: number) => (
              <View key={i} style={[s.savingsItem, { borderColor: c.amber, backgroundColor: c.amberLight }]} wrap={false}>
                <View style={{ flex: 1 }}>
                  <Text style={s.savingsAsk}>{item.ask}</Text>
                  {item.rationale && <Text style={s.savingsRationale}>{item.rationale}</Text>}
                </View>
                <Text style={[s.savingsAmount, { color: c.amber }]}>{fmt(item.amount || 0, cur)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Strategy */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>{fr ? 'Strategie de negociation' : 'Negotiation Strategy'}</Text>

          <View style={{ marginBottom: 12 }}>
            <Text style={s.strategyLabel}>{fr ? 'A demander' : 'Push For'}</Text>
            {output.what_to_ask_for?.must_have?.map((item, i) => (
              <View key={i} style={{ marginBottom: 5 }} wrap={false}>
                <Text style={[s.askBadge, { backgroundColor: c.emeraldLight, color: c.emerald }]}>{fr ? 'INDISPENSABLE' : 'MUST-HAVE'}</Text>
                <Text style={s.strategyItem}>{item}</Text>
              </View>
            ))}
            {output.what_to_ask_for?.nice_to_have?.map((item, i) => (
              <View key={i} style={{ marginBottom: 5 }} wrap={false}>
                <Text style={[s.askBadge, { backgroundColor: c.slate100, color: c.slate500 }]}>{fr ? 'SOUHAITABLE' : 'NICE-TO-HAVE'}</Text>
                <Text style={s.strategyItem}>{item}</Text>
              </View>
            ))}
          </View>

          <View style={s.strategyRow}>
            <View style={s.strategyCol}>
              <Text style={s.strategyLabel}>{fr ? 'Vos atouts' : 'Your Leverage'}</Text>
              {output.negotiation_plan?.leverage_you_have?.map((item, i) => (
                <Text key={i} style={s.strategyItem}>{'\u2022'} {item}</Text>
              ))}
            </View>
            <View style={s.strategyCol}>
              <Text style={s.strategyLabel}>{fr ? 'Ce que vous pouvez offrir' : 'Can Offer'}</Text>
              {output.negotiation_plan?.trades_you_can_offer?.map((item, i) => (
                <Text key={i} style={s.strategyItem}>{'\u2022'} {item}</Text>
              ))}
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>Generated by TermLift | termlift.com</Text>
          <Text style={s.footerText}>{output.disclaimer || 'Commercial guidance, not legal advice.'}</Text>
          <Text style={s.pageNumber} render={({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
