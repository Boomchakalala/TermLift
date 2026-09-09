'use client'

import { DealWorkspace } from '@/components/deal/DealWorkspace'
import type { DealOutput } from '@/types'
import enMessages from '@/i18n/en.json'
import frMessages from '@/i18n/fr.json'

interface AnalysisResultViewProps {
  output: DealOutput
  locale?: 'en' | 'fr'
}

/**
 * The anonymous /try result — the same deal workspace as /app/deal/[id], in
 * trial mode (no shell, signup gates instead of stage actions).
 */
export function AnalysisResultView({ output }: AnalysisResultViewProps) {
  const now = new Date().toISOString()
  const deal = {
    id: 'trial',
    vendor: output.vendor || null,
    title: output.title || null,
    deal_type: null,
    status: 'in_progress',
    savings_amount: null,
    savings_percent: null,
    closed_at: null,
    created_at: now,
    updated_at: now,
    rounds: [{ id: 'trial-round', output_json: output, round_number: 1, status: 'done', created_at: now }],
  }
  return (
    <DealWorkspace
      mode="trial"
      deal={deal}
      messages={{ en: enMessages as unknown as Record<string, string>, fr: frMessages as unknown as Record<string, string> }}
      isAdmin={false}
      showFullPlaybook
    />
  )
}
