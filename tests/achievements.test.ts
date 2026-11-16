/**
 * Achievements tests — the pure rule surface of src/lib/achievements.ts.
 *
 * The legacy prototype's holes, each guarded here: a client-side callback
 * paid its own rewards (here: rules are pure decisions the SERVER executes
 * on real data), the claim flag lived in localStorage (here: month keys are
 * server-computed and validated), and progress came from client logs (here:
 * every stat is a pure function of verified redemption signals only).
 */
import { describe, it, expect } from 'vitest'
import {
  achievementsConfigFromEnv,
  localWallClock,
  localHour,
  monthKeyForDate,
  isCurrentMonthKey,
  explorerStats,
  hasEarlyBird,
  hasNightOwl,
  uniqueNeighborhoods,
  badgeStats,
  type RedemptionSignal,
} from '../src/lib/achievements'

const OFFSET = 3 // Jordan's permanent UTC+3

const at = (iso: string, cafeId = 'cafe-a', neighborhood = 'jabal-amman'): RedemptionSignal => ({
  cafeId,
  neighborhood,
  createdAt: new Date(iso),
})

// ---------------------------------------------------------------- config

describe('achievementsConfigFromEnv (clamped giveaway knobs)', () => {
  it('defaults to 5 cafés, +3 days, UTC+3', () => {
    expect(achievementsConfigFromEnv({})).toEqual({ explorerTarget: 5, explorerRewardDays: 3, utcOffsetHours: 3 })
  })

  it('clamps absurd values into sane ranges', () => {
    const cfg = achievementsConfigFromEnv({
      ACHIEVEMENTS_EXPLORER_TARGET: '999',
      ACHIEVEMENTS_EXPLORER_DAYS: '-7',
      ACHIEVEMENTS_UTC_OFFSET_HOURS: '99',
    })
    expect(cfg).toEqual({ explorerTarget: 31, explorerRewardDays: 0, utcOffsetHours: 14 })
  })

  it('treats empty string as "not set" (≠ 0) and garbage as default', () => {
    expect(achievementsConfigFromEnv({ ACHIEVEMENTS_EXPLORER_DAYS: '' }).explorerRewardDays).toBe(3)
    expect(achievementsConfigFromEnv({ ACHIEVEMENTS_EXPLORER_DAYS: 'soup' }).explorerRewardDays).toBe(3)
    expect(achievementsConfigFromEnv({ ACHIEVEMENTS_EXPLORER_DAYS: '0' }).explorerRewardDays).toBe(0)
  })

  it('supports a badge-only challenge via days = 0', () => {
    expect(achievementsConfigFromEnv({ ACHIEVEMENTS_EXPLORER_DAYS: '0' }).explorerRewardDays).toBe(0)
  })
})

// ------------------------------------------------------- market-local time

describe('market-local month bucketing', () => {
  it('shifts by the offset for wall-clock reads', () => {
    // 21:30 UTC on Dec 31 = 00:30 local on Jan 1 (UTC+3).
    expect(localHour(new Date('2026-12-31T21:30:00Z'), OFFSET)).toBe(0)
    expect(localWallClock(new Date('2026-12-31T21:30:00Z'), OFFSET).getUTCDate()).toBe(1)
  })

  it('assigns the month boundary visit to the correct local month', () => {
    // Nov 30, 22:00 local (Nov) vs Dec 1, 01:00 local (Dec).
    expect(monthKeyForDate(new Date('2026-11-30T19:00:00Z'), OFFSET)).toBe('2026-11')
    expect(monthKeyForDate(new Date('2026-11-30T22:00:00Z'), OFFSET)).toBe('2026-12')
  })

  it('rolls the year correctly (Dec → Jan)', () => {
    expect(monthKeyForDate(new Date('2026-12-31T23:00:00Z'), OFFSET)).toBe('2027-01')
  })

  it('validates claim month keys against the current local month only', () => {
    const now = new Date('2026-11-04T12:00:00Z') // local Nov 4
    expect(isCurrentMonthKey('2026-11', now, OFFSET)).toBe(true)
    expect(isCurrentMonthKey('2026-10', now, OFFSET)).toBe(false)
    expect(isCurrentMonthKey('2026-12', now, OFFSET)).toBe(false)
    expect(isCurrentMonthKey('2025-11', now, OFFSET)).toBe(false)
  })
})

// ------------------------------------------------- monthly explorer challenge

describe('explorerStats (distinct cafés per local month)', () => {
  const NOW = new Date('2026-11-10T12:00:00Z')
  const cfg = achievementsConfigFromEnv({})

  it('counts distinct cafés only — repeats do not stack stamps', () => {
    const signals = [
      at('2026-11-01T09:00:00Z', 'cafe-a'),
      at('2026-11-02T09:00:00Z', 'cafe-a'), // repeat — no new stamp
      at('2026-11-03T09:00:00Z', 'cafe-b'),
      at('2026-11-04T09:00:00Z', 'cafe-c'),
    ]
    const s = explorerStats(signals, NOW, cfg)
    expect(s.cafeIds).toEqual(['cafe-a', 'cafe-b', 'cafe-c'])
    expect(s.completed).toBe(false)
  })

  it('ignores visits from other months (even two days earlier)', () => {
    const signals = [
      at('2026-10-30T09:00:00Z', 'cafe-old'),
      at('2026-11-01T09:00:00Z', 'cafe-a'),
      at('2026-12-01T09:00:00Z', 'cafe-future'),
    ]
    const s = explorerStats(signals, NOW, cfg)
    expect(s.cafeIds).toEqual(['cafe-a'])
  })

  it('keeps a late-evening visit inside its own calendar day', () => {
    // 2026-10-31T20:00Z = 23:00 local on Oct 31 → October, not November.
    const signals = [at('2026-10-31T20:00:00Z', 'cafe-edge')]
    const s = explorerStats(signals, new Date('2026-10-31T19:00:00Z'), cfg) // now = Oct 31, 22:00 local
    expect(s.key).toBe('2026-10')
    expect(s.cafeIds).toEqual(['cafe-edge'])
  })

  it('completes exactly at the target (5 distinct cafés)', () => {
    const signals = ['a', 'b', 'c', 'd', 'e'].map((c, i) =>
      at(`2026-11-0${i + 1}T09:00:00Z`, `cafe-${c}`),
    )
    const s = explorerStats(signals, NOW, cfg)
    expect(s.completed).toBe(true)
  })

  it('never completes from an empty history', () => {
    expect(explorerStats([], NOW, cfg).completed).toBe(false)
  })

  it('honors a configured target (market can raise or lower the bar)', () => {
    const cfg3 = achievementsConfigFromEnv({ ACHIEVEMENTS_EXPLORER_TARGET: '3' })
    const signals = ['a', 'b', 'c'].map((c, i) => at(`2026-11-0${i + 1}T09:00:00Z`, `cafe-${c}`))
    expect(explorerStats(signals, NOW, cfg3).completed).toBe(true)
  })
})

// ---------------------------------------------------------------- badges

describe('time-of-day badges (early bird / night owl)', () => {
  it('marks early bird before 09:00 local, not at 09:00 sharp', () => {
    const early = [at('2026-11-01T05:30:00Z')] // 08:30 local
    const nine = [at('2026-11-01T06:00:00Z')] // 09:00 local exactly
    expect(hasEarlyBird(early, OFFSET)).toBe(true)
    expect(hasEarlyBird(nine, OFFSET)).toBe(false)
  })

  it('marks night owl at 20:00 local and after, not before', () => {
    const evening = [at('2026-11-01T17:00:00Z')] // 20:00 local exactly
    const afternoon = [at('2026-11-01T16:59:00Z')] // 19:59 local
    expect(hasNightOwl(evening, OFFSET)).toBe(true)
    expect(hasNightOwl(afternoon, OFFSET)).toBe(false)
  })
})

describe('badgeStats (lifetime shelf)', () => {
  it('locks everything at zero visits', () => {
    const badges = badgeStats({ totalRedemptions: 0, uniqueCafes: 0, uniqueNeighborhoods: 0, earlyBird: false, nightOwl: false })
    expect(badges.every((b) => !b.unlocked)).toBe(true)
  })

  it('unlocks FIRST_SIP from a single verified visit', () => {
    const badges = badgeStats({ totalRedemptions: 1, uniqueCafes: 1, uniqueNeighborhoods: 1, earlyBird: false, nightOwl: false })
    expect(badges.find((b) => b.key === 'FIRST_SIP')?.unlocked).toBe(true)
    expect(badges.find((b) => b.key === 'EXPLORER')?.unlocked).toBe(false)
  })

  it('unlocks EXPLORER at 5 distinct cafés and GOLDEN_MUG only at 30 visits', () => {
    const at5 = badgeStats({ totalRedemptions: 5, uniqueCafes: 5, uniqueNeighborhoods: 1, earlyBird: false, nightOwl: false })
    expect(at5.find((b) => b.key === 'EXPLORER')?.unlocked).toBe(true)
    expect(at5.find((b) => b.key === 'GOLDEN_MUG')?.unlocked).toBe(false)
    expect(at5.find((b) => b.key === 'GOLDEN_MUG')?.progress).toBe(5)
    const at30 = badgeStats({ totalRedemptions: 30, uniqueCafes: 6, uniqueNeighborhoods: 2, earlyBird: false, nightOwl: false })
    expect(at30.find((b) => b.key === 'GOLDEN_MUG')?.unlocked).toBe(true)
  })

  it('unlocks WANDERER at 3 distinct neighborhoods', () => {
    const badges = badgeStats({ totalRedemptions: 3, uniqueCafes: 3, uniqueNeighborhoods: 3, earlyBird: false, nightOwl: false })
    expect(badges.find((b) => b.key === 'WANDERER')?.unlocked).toBe(true)
  })
})

describe('uniqueNeighborhoods (district signal)', () => {
  it('dedupes and ignores missing neighborhoods', () => {
    const signals: RedemptionSignal[] = [
      { cafeId: 'a', neighborhood: 'jabal-amman', createdAt: new Date('2026-11-01T09:00:00Z') },
      { cafeId: 'b', neighborhood: 'jabal-amman', createdAt: new Date('2026-11-02T09:00:00Z') },
      { cafeId: 'c', neighborhood: 'weibdeh', createdAt: new Date('2026-11-03T09:00:00Z') },
      { cafeId: 'd', neighborhood: null, createdAt: new Date('2026-11-04T09:00:00Z') },
    ]
    expect(uniqueNeighborhoods(signals)).toBe(2)
  })
})
