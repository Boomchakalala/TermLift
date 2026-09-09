import { describe, expect, it } from 'vitest'
import { playbookAccess, newDealNeedsPayment } from './billing-rules'
import { EARLY_ACCESS } from './pricing'

const during = new Date(EARLY_ACCESS.until + 'T10:00:00Z')
const after = new Date(new Date(EARLY_ACCESS.until + 'T12:00:00Z').getTime() + 2 * 86400000)
const base = { isAdmin: false, purchasedForDeal: false, hasAnyPlaybook: false, hasUnassignedCredit: false }

describe('playbookAccess', () => {
  it('admins are always free', () => {
    expect(playbookAccess({ ...base, isAdmin: true, hasAnyPlaybook: true, now: after })).toMatchObject({ kind: 'admin', granted: true })
  })
  it('a deal already paid for is included, even after early access', () => {
    expect(playbookAccess({ ...base, purchasedForDeal: true, hasAnyPlaybook: true, now: after })).toMatchObject({ kind: 'purchased', granted: true })
  })
  it('early access makes everything free, first Playbook or not', () => {
    expect(playbookAccess({ ...base, hasAnyPlaybook: true, now: during })).toMatchObject({ kind: 'early_access', granted: true })
  })
  it('after early access the first Playbook on the account is free', () => {
    expect(playbookAccess({ ...base, now: after })).toMatchObject({ kind: 'first_free', granted: true })
  })
  it('after early access a second Playbook is due', () => {
    expect(playbookAccess({ ...base, hasAnyPlaybook: true, now: after })).toMatchObject({ kind: 'due', granted: false, priceEur: 29 })
  })
  it('an unassigned credit covers a second Playbook', () => {
    expect(playbookAccess({ ...base, hasAnyPlaybook: true, hasUnassignedCredit: true, now: after })).toMatchObject({ kind: 'credit', granted: true })
  })
})

describe('newDealNeedsPayment', () => {
  it('is false while early access is on', () => {
    expect(newDealNeedsPayment({ ...base, hasAnyPlaybook: true, now: during })).toBe(false)
  })
  it('is false for a first-free account after early access', () => {
    expect(newDealNeedsPayment({ ...base, now: after })).toBe(false)
  })
  it('is true after early access with a Playbook already on the account and no credit', () => {
    expect(newDealNeedsPayment({ ...base, hasAnyPlaybook: true, now: after })).toBe(true)
  })
  it('is false when a credit is waiting', () => {
    expect(newDealNeedsPayment({ ...base, hasAnyPlaybook: true, hasUnassignedCredit: true, now: after })).toBe(false)
  })
})
