/**
 * Unit tests for Campaign Studio analytics helpers (Phase 5).
 * Pure-function tests — no database required. Run: npx vitest run
 */
import { describe, it, expect } from 'vitest'
import { campaignDayKey, buildDailySeries, capUsage } from '../../src/lib/campaigns/analytics-core'

describe('campaignDayKey', () => {
  it('uses the Jordan calendar day (UTC+3), not the UTC day', () => {
    // 2026-10-31 21:00 UTC == 2026-11-01 00:00 in Jordan
    expect(campaignDayKey(new Date('2026-10-31T21:00:00.000Z'))).toBe('2026-11-01')
  })

  it('stays on the same Jordan day for a mid-afternoon instant', () => {
    // 2026-10-31 12:00 UTC == 15:00 Jordan
    expect(campaignDayKey(new Date('2026-10-31T12:00:00.000Z'))).toBe('2026-10-31')
  })

  it('rolls back to the previous Jordan day late at night UTC', () => {
    // 2026-10-31 20:59 UTC == 23:59 Jordan — still 10-31
    expect(campaignDayKey(new Date('2026-10-31T20:59:59.000Z'))).toBe('2026-10-31')
  })

  it('pads month and day to two digits', () => {
    // 2026-01-05 10:00 UTC == 13:00 Jordan
    expect(campaignDayKey(new Date('2026-01-05T10:00:00.000Z'))).toBe('2026-01-05')
  })
})

describe('buildDailySeries', () => {
  it('produces a zero-filled series of exactly `days` points ending today', () => {
    const now = new Date('2026-10-31T12:00:00.000Z')
    const series = buildDailySeries(7, new Map(), now)
    expect(series).toHaveLength(7)
    expect(series[6].date).toBe('2026-10-31')
    expect(series.every((p) => p.count === 0)).toBe(true)
  })

  it('applies the counts map by Jordan day key', () => {
    const now = new Date('2026-10-31T12:00:00.000Z')
    const counts = new Map([['2026-10-31', 4], ['2026-10-30', 2]])
    const series = buildDailySeries(3, counts, now)
    expect(series.map((p) => p.count)).toEqual([0, 2, 4])
  })

  it('is sorted oldest first (today last)', () => {
    const now = new Date('2026-10-31T12:00:00.000Z')
    const series = buildDailySeries(3, new Map(), now)
    expect(series.map((p) => p.date)).toEqual(['2026-10-29', '2026-10-30', '2026-10-31'])
  })

  it('handles a one-day series', () => {
    const now = new Date('2026-10-31T12:00:00.000Z')
    expect(buildDailySeries(1, new Map(), now)).toEqual([{ date: '2026-10-31', count: 0 }])
  })
})

describe('capUsage', () => {
  it('returns null for unlimited campaigns (no cap)', () => {
    expect(capUsage(12, null)).toBeNull()
    expect(capUsage(12, undefined)).toBeNull()
  })

  it('returns null for non-positive caps (defensive)', () => {
    expect(capUsage(12, 0)).toBeNull()
    expect(capUsage(12, -3)).toBeNull()
    expect(capUsage(12, Number.NaN)).toBeNull()
  })

  it('computes the percentage used', () => {
    expect(capUsage(25, 100)).toEqual({ used: 25, limit: 100, pct: 25 })
    expect(capUsage(1, 3)).toEqual({ used: 1, limit: 3, pct: 33 })
  })

  it('clamps at 100% when the cap was exceeded (e.g. raised later)', () => {
    expect(capUsage(120, 100)).toEqual({ used: 120, limit: 100, pct: 100 })
  })
})
