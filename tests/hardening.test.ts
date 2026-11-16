/**
 * Hardening-pass regression tests.
 *
 * 1. Jordan time helpers must be independent of the SERVER's time zone.
 *    The old implementations shifted dates with getTimezoneOffset() and were
 *    only correct on a UTC server; these tests mock several server offsets and
 *    require identical results — so a regression back to offset-based math is
 *    caught immediately.
 * 2. sha256Hex (session tokens at rest) must be a standard SHA-256 digest.
 */
import { describe, it, expect, vi } from 'vitest'
import { jordanStartOfDay } from '../src/lib/perks'
import { jordanStartOfMonth } from '../src/lib/campaigns/redemption'
import { campaignDayKey } from '../src/lib/campaigns/analytics-core'
import { sha256Hex } from '../src/lib/security'

/** Force the "server" time zone (minutes behind UTC, as getTimezoneOffset reports it). */
function withServerOffset<T>(minutes: number, run: () => T): T {
  const spy = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(minutes)
  try {
    return run()
  } finally {
    spy.mockRestore()
  }
}

// Real instants around Jordan midnight (UTC+3 year-round):
const beforeMidnight = new Date('2026-11-03T20:59:59.000Z') // 23:59:59 on Nov 3 in Jordan
const afterMidnight = new Date('2026-11-03T21:00:01.000Z') // 00:00:01 on Nov 4 in Jordan

const SERVER_OFFSETS = [0, -180, 330, 600] // UTC · UTC+3 (Amman) · UTC+5:30 · UTC-10

describe('Jordan day boundaries are server-timezone independent', () => {
  it('jordanStartOfDay rolls over exactly at Jordan midnight', () => {
    for (const offset of SERVER_OFFSETS) {
      withServerOffset(offset, () => {
        expect(jordanStartOfDay(beforeMidnight).toISOString()).toBe('2026-11-02T21:00:00.000Z')
        expect(jordanStartOfDay(afterMidnight).toISOString()).toBe('2026-11-03T21:00:00.000Z')
      })
    }
  })

  it('jordanStartOfMonth rolls over exactly at Jordan midnight on the 1st', () => {
    const endOfOct = new Date('2026-10-31T20:59:59.000Z') // Oct 31 23:59:59 in Jordan
    const startOfNov = new Date('2026-10-31T21:00:01.000Z') // Nov 1 00:00:01 in Jordan
    for (const offset of SERVER_OFFSETS) {
      withServerOffset(offset, () => {
        expect(jordanStartOfMonth(endOfOct).toISOString()).toBe('2026-09-30T21:00:00.000Z')
        expect(jordanStartOfMonth(startOfNov).toISOString()).toBe('2026-10-31T21:00:00.000Z')
      })
    }
  })

  it('campaignDayKey returns the Jordan calendar date', () => {
    for (const offset of SERVER_OFFSETS) {
      withServerOffset(offset, () => {
        expect(campaignDayKey(beforeMidnight)).toBe('2026-11-03')
        expect(campaignDayKey(afterMidnight)).toBe('2026-11-04')
      })
    }
  })
})

describe('sha256Hex', () => {
  it('produces the standard SHA-256 hex digest', () => {
    // Reference vector from NIST FIPS 180-4 examples
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('is deterministic and input-sensitive', () => {
    const a = sha256Hex('token-value-1')
    expect(sha256Hex('token-value-1')).toBe(a)
    expect(sha256Hex('token-value-2')).not.toBe(a)
  })
})
