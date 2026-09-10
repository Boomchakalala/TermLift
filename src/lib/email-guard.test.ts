import { describe, it, expect } from 'vitest'
import { sanitizeEmailBody } from './email-guard'

const firm = `Hi,

Thanks for the proposal. I have reviewed it internally and there are a few things we need to resolve before this can move forward.

On price, the current total of $36,330 is above where we need to land. We are bringing 750 seats and a 24-month commitment as a new customer, and we would expect a 5% reduction on the total. As is, we are also looking at alternatives, so it would help to know if there is any flexibility here.

On the contract terms, two points are holding up our legal review. The renewal escalation clause needs a hard cap of 4%.

Best regards,
[Your Name]`

describe('sanitizeEmailBody', () => {
  it('removes the new-customer and alternatives sentences when neither is allowed (the stored KnowBe4 firm draft)', () => {
    const r = sanitizeEmailBody(firm, { newLogo: false, alternatives: false })
    expect(r.removed.length).toBe(2)
    expect(r.body).not.toMatch(/new customer/)
    expect(r.body).not.toMatch(/alternatives/)
    expect(r.body).toMatch(/On price, the current total of \$36,330 is above where we need to land\./)
    expect(r.body).toMatch(/hard cap of 4%\./)
    expect(r.body).toMatch(/Best regards,\n\[Your Name\]/)
  })

  it('keeps everything when both framings are allowed', () => {
    const r = sanitizeEmailBody(firm, { newLogo: true, alternatives: true })
    expect(r.removed).toEqual([])
    expect(r.body).toBe(firm.trim())
  })

  it('keeps a real competing quote when the buyer supplied one', () => {
    const r = sanitizeEmailBody('We have a competing quote at €41,000. Could you match it?', { newLogo: false, alternatives: true })
    expect(r.removed).toEqual([])
  })
})
