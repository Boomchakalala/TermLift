import { describe, it, expect } from 'vitest'
import { applyTranslations, collectTranslatable, dealLocale, detectLocaleFromProse, isProseValue, normalizeLocale, outputLocale } from './output-language'
import { pickLocale } from './request-locale-pure'

const englishOutput = {
  vendor: 'Datadog', title: 'Datadog · Renewal', verdict: 'Real leverage — negotiate before signing.', verdict_type: 'negotiate',
  score: 62, score_label: 'Solid quote', category: 'Infrastructure & Cloud',
  snapshot: { vendor_product: 'Datadog / APM', term: '12 months', total_commitment: '$16,328', currency: 'USD', billing_payment: 'Monthly, Net 30', pricing_model: 'Per host', deal_type: 'Renewal' },
  red_flags: [{ type: 'overage_pricing', severity: 'high', issue: 'Overage rates carry no discount', why_it_matters: 'That is where surprise bills come from', what_to_ask_for: 'Cap overages at the committed rate', if_they_push_back: 'Ask for a 10% cap' }],
  potential_savings: { total: 2449, currency: 'USD', must_have: [{ ask: 'Annual pre-pay discount', amount: 1633, rationale: 'Standard on renewals' }] },
  cash_flow_improvements: [{ recommendation: 'Ask for Net 45', category: 'cash_flow' }],
  email_drafts: { neutral: { subject: 'Renewal terms', body: 'Hi Sam, thanks for the quote.' } },
  assumptions: ['60 hosts committed'], leverage_assessment: { price_leverage: 'high', best_negotiation_angle: ['Annual pre-pay'] },
  round_delta: { headline: 'They moved 4%', posture: 'push', what_changed: ['Discount raised to 12%'] },
  quote_facts: { lines: [{ description: 'APM hosts', unit: 'host' }] },
  email_recommended_tone: 'firm', deep_analysis_status: 'done',
}

describe('locale normalisation and detection', () => {
  it('normalises anything that is not fr to en', () => {
    expect(normalizeLocale('fr')).toBe('fr')
    expect(normalizeLocale('en')).toBe('en')
    expect(normalizeLocale('de')).toBe('en')
    expect(normalizeLocale(undefined)).toBe('en')
  })
  it('detects French prose and defaults short or English text to en', () => {
    expect(detectLocaleFromProse('Devis solide — quelques gains encore possibles. Négociez avant de signer : la remise de renouvellement est faible et les dépassements ne sont pas plafonnés.')).toBe('fr')
    expect(detectLocaleFromProse('Solid quote with small gains still on the table. Push back before signing: the renewal discount is thin and overages carry no discount.')).toBe('en')
    expect(detectLocaleFromProse('')).toBe('en')
    expect(detectLocaleFromProse('OK')).toBe('en')
  })
  it('prefers the stored flag over detection and never crashes on odd shapes', () => {
    expect(outputLocale({ ...englishOutput, generated_locale: 'fr' })).toBe('fr')
    expect(outputLocale(englishOutput)).toBe('en')
    expect(outputLocale({ verdict: 'Le devis est correct mais la remise est faible pour un engagement de trois ans avec le fournisseur.' })).toBe('fr')
    expect(outputLocale(null)).toBe('en')
    expect(outputLocale('nope')).toBe('en')
    expect(outputLocale({})).toBe('en')
  })
  it('a deal speaks the language of its Round 1', () => {
    expect(dealLocale([{ round_number: 2, output_json: { generated_locale: 'en' } }, { round_number: 1, output_json: { generated_locale: 'fr' } }])).toBe('fr')
    expect(dealLocale([])).toBe('en')
    expect(dealLocale(undefined)).toBe('en')
  })
})

describe('request locale resolution', () => {
  it('cookie wins, then explicit body value, then Accept-Language, then en', () => {
    expect(pickLocale({ cookie: 'fr', body: 'en', acceptLanguage: 'en-GB' })).toBe('fr')
    expect(pickLocale({ cookie: undefined, body: 'fr', acceptLanguage: 'en-GB' })).toBe('fr')
    expect(pickLocale({ cookie: undefined, body: undefined, acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8' })).toBe('fr')
    expect(pickLocale({ cookie: undefined, body: undefined, acceptLanguage: 'de-DE' })).toBe('en')
    expect(pickLocale({ cookie: 'xx', body: undefined, acceptLanguage: undefined })).toBe('en')
  })
})

describe('translation walker', () => {
  it('collects prose only: no facts, codes, enums, names, numbers or skipped subtrees', () => {
    const paths = collectTranslatable(englishOutput).map((s) => s.path)
    expect(paths).toContain('verdict')
    expect(paths).toContain('red_flags.0.issue')
    expect(paths).toContain('red_flags.0.if_they_push_back')
    expect(paths).toContain('potential_savings.must_have.0.ask')
    expect(paths).toContain('potential_savings.must_have.0.rationale')
    expect(paths).toContain('email_drafts.neutral.body')
    expect(paths).toContain('round_delta.headline')
    expect(paths).toContain('leverage_assessment.best_negotiation_angle.0')
    for (const p of paths) {
      expect(p.startsWith('snapshot')).toBe(false)
      expect(p.startsWith('quote_facts')).toBe(false)
    }
    expect(paths).not.toContain('vendor')
    expect(paths).not.toContain('title')
    expect(paths).not.toContain('category')
    expect(paths).not.toContain('verdict_type')
    expect(paths).not.toContain('red_flags.0.severity')
    expect(paths).not.toContain('red_flags.0.type')
    expect(paths).not.toContain('cash_flow_improvements.0.category')
    expect(paths).not.toContain('round_delta.posture')
    expect(paths).not.toContain('email_recommended_tone')
    expect(paths).not.toContain('leverage_assessment.price_leverage')
  })
  it('isProseValue rejects codes, dates and bare numbers', () => {
    expect(isProseValue('HIGH')).toBe(false)
    expect(isProseValue('user_confirmed')).toBe(false)
    expect(isProseValue('2026-09-30')).toBe(false)
    expect(isProseValue('$16,328')).toBe(false)
    expect(isProseValue('12')).toBe(false)
    expect(isProseValue('Ask for a 10% cap')).toBe(true)
  })
  it('applyTranslations swaps prose in place and leaves every other value and the schema untouched', () => {
    const translated = applyTranslations(englishOutput, { verdict: 'Vrai levier — négociez avant de signer.', 'red_flags.0.issue': 'Les dépassements ne sont pas remisés', 'missing.path': 'ignored' })
    expect(translated.verdict).toBe('Vrai levier — négociez avant de signer.')
    expect(translated.red_flags[0].issue).toBe('Les dépassements ne sont pas remisés')
    expect(translated.red_flags[0].severity).toBe('high')
    expect(translated.score).toBe(62)
    expect(translated.potential_savings.total).toBe(2449)
    expect(translated.potential_savings.must_have[0].amount).toBe(1633)
    expect(translated.snapshot).toEqual(englishOutput.snapshot)
    expect(translated.round_delta.posture).toBe('push')
    expect(Object.keys(translated).sort()).toEqual(Object.keys(englishOutput).sort())
    // original untouched
    expect(englishOutput.verdict).toBe('Real leverage — negotiate before signing.')
  })
})
