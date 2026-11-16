import { describe, it, expect } from 'vitest'
import { selectSegment, segmentPeriodKey, withinSendWindow, type Segment } from '../../src/lib/agents/retention'

/**
 * Agent 3 — Member Retention, the pure decision core (PRD Agent 3).
 * Segment priority: NEAR_EXPIRY > COOLING_10_21 > ONE_THEN_SILENT > NEVER_REDEEMED.
 * The "once" unit for messaging is the segment period key.
 */

const NOW = new Date('2026-11-08T12:00:00Z')
const DAY = 86_400_000

function args(overrides: Partial<Parameters<typeof selectSegment>[0]> = {}) {
  return {
    now: NOW,
    accountCreatedAt: new Date(NOW.getTime() - 30 * DAY),
    membershipStartsAt: new Date(NOW.getTime() - 30 * DAY),
    membershipEndsAt: null,
    totalRedemptions: 0,
    lastRedemptionAt: null,
    ...overrides,
  }
}

describe('selectSegment', () => {
  it('NEAR_EXPIRY: pass ends within 14 days with low usage — wins over everything', () => {
    const seg = selectSegment(args({
      membershipEndsAt: new Date(NOW.getTime() + 10 * DAY),
      totalRedemptions: 1,
      lastRedemptionAt: new Date(NOW.getTime() - 12 * DAY),
    }))
    expect(seg).toBe('NEAR_EXPIRY')
  })

  it('not NEAR_EXPIRY when usage is healthy (2+ redemptions)', () => {
    const seg = selectSegment(args({
      membershipEndsAt: new Date(NOW.getTime() + 10 * DAY),
      totalRedemptions: 5,
      lastRedemptionAt: new Date(NOW.getTime() - 2 * DAY),
    }))
    expect(seg).toBeNull()
  })

  it('not NEAR_EXPIRY when more than 14 days remain or already ended (healthy member → no segment)', () => {
    const healthy = { totalRedemptions: 5, lastRedemptionAt: new Date(NOW.getTime() - 2 * DAY) }
    expect(selectSegment(args({ membershipEndsAt: new Date(NOW.getTime() + 20 * DAY), ...healthy }))).toBeNull()
    expect(selectSegment(args({ membershipEndsAt: new Date(NOW.getTime() - 1 * DAY), ...healthy }))).toBeNull()
  })

  it('COOLING_10_21: was active (2+), silent 10–21 days', () => {
    expect(selectSegment(args({ totalRedemptions: 3, lastRedemptionAt: new Date(NOW.getTime() - 15 * DAY) }))).toBe('COOLING_10_21')
    // outside the band: too fresh or too gone
    expect(selectSegment(args({ totalRedemptions: 3, lastRedemptionAt: new Date(NOW.getTime() - 3 * DAY) }))).toBeNull()
    expect(selectSegment(args({ totalRedemptions: 3, lastRedemptionAt: new Date(NOW.getTime() - 30 * DAY) }))).toBeNull()
  })

  it('ONE_THEN_SILENT: exactly one redemption, quiet 10+ days', () => {
    expect(selectSegment(args({ totalRedemptions: 1, lastRedemptionAt: new Date(NOW.getTime() - 12 * DAY) }))).toBe('ONE_THEN_SILENT')
    expect(selectSegment(args({ totalRedemptions: 1, lastRedemptionAt: new Date(NOW.getTime() - 4 * DAY) }))).toBeNull()
  })

  it('NEVER_REDEEMED: zero redemptions and the account is old enough to judge', () => {
    expect(selectSegment(args({ totalRedemptions: 0, accountCreatedAt: new Date(NOW.getTime() - 7 * DAY) }))).toBe('NEVER_REDEEMED')
    // brand-new account: too early to call it a failure
    expect(selectSegment(args({ totalRedemptions: 0, accountCreatedAt: new Date(NOW.getTime() - 2 * DAY) }))).toBeNull()
  })

  it('an active member with recent activity belongs to no segment', () => {
    expect(selectSegment(args({ totalRedemptions: 6, lastRedemptionAt: new Date(NOW.getTime() - 1 * DAY) }))).toBeNull()
  })
})

describe('segmentPeriodKey — the "exactly once" unit', () => {
  it('monthly key for the evergreen segments (one message per member per month)', () => {
    for (const seg of ['NEVER_REDEEMED', 'ONE_THEN_SILENT', 'COOLING_10_21'] as Segment[]) {
      const a = segmentPeriodKey(seg, NOW, null)
      const b = segmentPeriodKey(seg, new Date('2026-11-20T09:00:00Z'), null)
      expect(a).toBe('2026-11')
      expect(b).toBe(a)
    }
  })

  it('NEAR_EXPIRY keys on the pass end date, so one nudge per expiring pass', () => {
    const endsAt = new Date('2026-11-25T00:00:00Z')
    expect(segmentPeriodKey('NEAR_EXPIRY', NOW, endsAt)).toBe('2026-11-25')
    // no known end date → the full Jordan calendar day is the "once" unit
    expect(segmentPeriodKey('NEAR_EXPIRY', NOW, null)).toBe('2026-11-08')
  })
})

describe('withinSendWindow (Jordan-local daily window)', () => {
  it('inside the window sends; outside does not', () => {
    expect(withinSendWindow('10:00', '09:00-20:00')).toBe(true)
    expect(withinSendWindow('09:00', '09:00-20:00')).toBe(true)
    expect(withinSendWindow('08:59', '09:00-20:00')).toBe(false)
    expect(withinSendWindow('20:01', '09:00-20:00')).toBe(false)
  })

  it('an unparseable window never blocks (per-member quiet hours still apply)', () => {
    expect(withinSendWindow('03:00', 'not-a-window')).toBe(true)
  })

  it('a reversed window (e.g. 20:00-09:00) is treated literally, not overnight', () => {
    // 10:00 is NOT inside [20:00→09:00 window] by the literal reading the code uses
    expect(withinSendWindow('10:00', '20:00-09:00')).toBe(false)
    expect(withinSendWindow('21:00', '20:00-09:00')).toBe(true)
  })
})
