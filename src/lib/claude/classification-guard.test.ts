import { describe, it, expect } from 'vitest'
import { isUnreadableClassification, classificationFromFacts, resolveClassification, quoteTypeFromCategory, savingsRange } from './classification-guard'
import type { ExtractedFacts } from './extract'

// What Haiku actually stored for the KnowBe4 PDF (no document reached it).
const blind = {
  quote_type: 'professional_services' as const,
  deal_size_bracket: 'medium' as const,
  recurring: false,
  leverage_level: 'unclear' as const,
  audience: 'business' as const,
  savings_strategy: { target_percent_min: 0, target_percent_max: 0, approach: 'competitive_leverage' as const, rationale: 'Unable to classify without access to the attached document.' },
}

const facts: ExtractedFacts = {
  vendor: 'KnowBe4', vendor_product: 'KnowBe4 / Security Awareness Training + Compliance Plus', category: 'SaaS - Security Awareness Training',
  description: '', term: '24 months', total_commitment: '$36,330', billing_payment: 'Net 30', pricing_model: 'Per-seat, billed over term', currency: 'USD', deal_type: 'New purchase',
}

describe('classification guard', () => {
  it('rejects the blind classification and rebuilds a SaaS, recurring, 10-20% frame from the facts', () => {
    expect(isUnreadableClassification(blind)).toBe(true)
    const r = resolveClassification(blind, facts, 'New', 36330)
    expect(r.replaced).toBe(true)
    expect(r.classification.quote_type).toBe('saas')
    expect(r.classification.recurring).toBe(true)
    expect(r.classification.deal_size_bracket).toBe('medium')
    expect(r.classification.savings_strategy.target_percent_min).toBe(10)
    expect(r.classification.savings_strategy.target_percent_max).toBe(20)
  })

  it('keeps a classification that read the document', () => {
    const good = { ...blind, quote_type: 'saas' as const, recurring: true, savings_strategy: { target_percent_min: 10, target_percent_max: 20, approach: 'volume_discount' as const, rationale: 'Mid-market SaaS with volume.' } }
    const r = resolveClassification(good, facts, 'New', 36330)
    expect(r.replaced).toBe(false)
    expect(r.classification).toBe(good)
  })

  it('adds the renewal bump and leverage when the deal is a renewal', () => {
    const r = classificationFromFacts(facts, 'Renewal', 36330)
    expect(r.savings_strategy.target_percent_min).toBe(15)
    expect(r.savings_strategy.target_percent_max).toBe(25)
    expect(r.leverage_level).toBe('high')
  })

  it('maps categories and brackets', () => {
    expect(quoteTypeFromCategory('Professional Services - Marketing Agency')).toBe('professional_services')
    expect(quoteTypeFromCategory('SaaS - Infrastructure')).toBe('saas')
    expect(quoteTypeFromCategory('Equipment purchase')).toBe('product_hardware')
    expect(savingsRange('saas', 'small', true, false)).toEqual({ min: 5, max: 15, approach: 'package_discount' })
    expect(classificationFromFacts({ ...facts, total_commitment: '$800' }, 'New', 800).deal_size_bracket).toBe('micro')
  })
})
