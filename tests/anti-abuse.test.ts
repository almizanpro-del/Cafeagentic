import { describe, it, expect } from 'vitest'
import {
  flagRapidRepeat,
  flagVelocityBurst,
  collectRedemptionFlags,
  REDEMPTION_FLAG_LABELS,
} from '../src/lib/campaigns/anti-abuse'

const MIN = 60_000
// Fixed "now" so tests never depend on the wall clock.
const NOW = new Date('2026-11-04T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe('flagRapidRepeat (prototype RULE 4: 2-minute re-scan)', () => {
  it('flags a redemption 60 seconds ago', () => {
    expect(flagRapidRepeat([{ createdAt: ago(MIN) }], NOW)).toBe(true)
  })
  it('flags ISO-string timestamps too (API payloads)', () => {
    expect(flagRapidRepeat([{ createdAt: '2026-11-04T11:59:00Z' }], NOW)).toBe(true)
  })
  it('stays quiet when the last redemption is 3 minutes old', () => {
    expect(flagRapidRepeat([{ createdAt: ago(3 * MIN) }], NOW)).toBe(false)
  })
  it('ignores future-dated garbage and invalid dates', () => {
    expect(flagRapidRepeat([{ createdAt: new Date(NOW.getTime() + 5 * MIN) }, { createdAt: new Date('nope') }], NOW)).toBe(false)
  })
  it('window is configurable', () => {
    expect(flagRapidRepeat([{ createdAt: ago(3 * MIN) }], NOW, 5 * MIN)).toBe(true)
  })
  it('empty history never flags', () => {
    expect(flagRapidRepeat([], NOW)).toBe(false)
  })
})

describe('flagVelocityBurst (cross-café velocity)', () => {
  it('flags 3+ redemptions inside one hour', () => {
    const recent = [{ createdAt: ago(10 * MIN) }, { createdAt: ago(30 * MIN) }, { createdAt: ago(50 * MIN) }]
    expect(flagVelocityBurst(recent, NOW)).toBe(true)
  })
  it('tolerates unsorted input', () => {
    const recent = [{ createdAt: ago(50 * MIN) }, { createdAt: ago(10 * MIN) }, { createdAt: ago(30 * MIN) }]
    expect(flagVelocityBurst(recent, NOW)).toBe(true)
  })
  it('stays quiet at 2 redemptions in the hour', () => {
    const recent = [{ createdAt: ago(10 * MIN) }, { createdAt: ago(30 * MIN) }]
    expect(flagVelocityBurst(recent, NOW)).toBe(false)
  })
  it('redemptions older than the window do not count', () => {
    const recent = [{ createdAt: ago(2 * 60 * MIN) }, { createdAt: ago(3 * 60 * MIN) }, { createdAt: ago(61 * MIN) }]
    expect(flagVelocityBurst(recent, NOW)).toBe(false)
  })
  it('threshold and window are configurable', () => {
    const two = [{ createdAt: ago(5 * MIN) }, { createdAt: ago(15 * MIN) }]
    expect(flagVelocityBurst(two, NOW, { maxInWindow: 2 })).toBe(true)
    expect(flagVelocityBurst(two, NOW, { windowMs: 10 * MIN })).toBe(false)
  })
})

describe('collectRedemptionFlags', () => {
  it('returns both flags for a burst with an immediate repeat', () => {
    const recent = [{ createdAt: ago(MIN) }, { createdAt: ago(20 * MIN) }, { createdAt: ago(40 * MIN) }]
    expect(collectRedemptionFlags(recent, NOW)).toEqual(['RAPID_REPEAT', 'VELOCITY_BURST'])
  })
  it('returns nothing for calm, spaced-out history', () => {
    const recent = [{ createdAt: ago(5 * 60 * MIN) }, { createdAt: ago(10 * 60 * MIN) }]
    expect(collectRedemptionFlags(recent, NOW)).toEqual([])
  })
  it('every flag ships with both languages for the scanner UI', () => {
    for (const flag of collectRedemptionFlags([{ createdAt: ago(MIN) }], NOW)) {
      expect(REDEMPTION_FLAG_LABELS[flag].en).toBeTruthy()
      expect(REDEMPTION_FLAG_LABELS[flag].ar).toBeTruthy()
    }
  })
})
