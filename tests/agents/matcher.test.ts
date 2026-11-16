import { describe, it, expect } from 'vitest'
import {
  matcherWeights,
  scoreCafe,
  rankCafes,
  explainCafe,
  type MatcherCafe,
  type MatcherContext,
  type MatcherWeights,
} from '../../src/lib/agents/matcher'
import { AGENT_CONFIG_DEFAULTS } from '../../src/lib/agents/config'

/**
 * Agent 2 — Smart Café Matcher, pure scoring core (PRD Agent 2).
 * Cold start leans on distance/hours/amenities/perks; history fades in after
 * matcher.cold_start_min_visits; diversity is a deterministic per-day jitter.
 */

const NOW = new Date('2026-11-08T12:00:00Z') // a Sunday, mid-day
const HOME = { lat: 31.9539, lng: 35.9106 } // downtown Amman

let seq = 0
function cafe(overrides: Partial<MatcherCafe> = {}): MatcherCafe {
  seq++
  return {
    id: `cafe_${seq}`,
    name: `Cafe ${seq}`,
    nameAr: `مقهى ${seq}`,
    lat: HOME.lat + 0.009, // ~1 km north
    lng: HOME.lng,
    hours: '08:00-22:00',
    wifiQuality: 3,
    power: true,
    studyFriendly: true,
    outdoor: false,
    priceLevel: 2,
    rating: 4.5,
    perks: [],
    visits: 0,
    ...overrides,
  }
}

function ctx(overrides: Partial<MatcherContext> = {}): MatcherContext {
  return {
    memberId: 'member_1',
    lang: 'en',
    lat: HOME.lat,
    lng: HOME.lng,
    preferences: {},
    userType: null,
    now: NOW,
    totalVisits: 0,
    ...overrides,
  }
}

const W: MatcherWeights = matcherWeights(AGENT_CONFIG_DEFAULTS)

describe('matcherWeights', () => {
  it('falls back to defaults for missing keys and honours overrides', () => {
    expect(matcherWeights({}).open).toBe(4)
    expect(matcherWeights({ 'matcher.w.distance': '9' }).distance).toBe(9)
  })
})

describe('scoreCafe — hours', () => {
  it('an open café beats an identical closed one and explains why', () => {
    const open = scoreCafe(cafe({ id: 'open', hours: '08:00-22:00' }), ctx(), W)
    const closed = scoreCafe(cafe({ id: 'closed', hours: '02:00-02:30' }), ctx(), W)
    expect(open.openNow).toBe(true)
    expect(closed.openNow).toBe(false)
    expect(open.reasons.some((r) => r.key === 'OPEN_NOW')).toBe(true)
    expect(open.score).toBeGreaterThan(closed.score)
  })
})

describe('scoreCafe — distance', () => {
  it('close cafés get minutes-away, farther ones get nearby', () => {
    const near = scoreCafe(cafe({ id: 'near', lat: HOME.lat + 0.009 }), ctx(), W) // ~1 km
    const far = scoreCafe(cafe({ id: 'far', lat: HOME.lat + 0.072 }), ctx(), W) // ~8 km
    expect(near.reasons.some((r) => r.key === 'MINUTES_AWAY')).toBe(true)
    expect(far.reasons.some((r) => r.key === 'NEARBY')).toBe(true)
    expect(near.score).toBeGreaterThan(far.score)
  })

  it('outside the radius the café is dropped (score -1) and rankCafes filters it', () => {
    const out = scoreCafe(cafe({ id: 'out', lat: HOME.lat + 0.072 }), ctx(), W, { radiusKm: 2 })
    expect(out.score).toBe(-1)
    const ranked = rankCafes(
      [cafe({ id: 'in-radius', lat: HOME.lat + 0.009 }), cafe({ id: 'out-radius', lat: HOME.lat + 0.09 })],
      ctx(),
      W,
      { radiusKm: 2 },
    )
    expect(ranked.map((r) => r.cafe.id)).toEqual(['in-radius'])
  })

  it('without location no distance signal is added', () => {
    const noGeo = scoreCafe(cafe({ id: 'nogeo' }), ctx({ lat: null, lng: null }), W)
    expect(noGeo.reasons.some((r) => r.key === 'MINUTES_AWAY' || r.key === 'NEARBY')).toBe(false)
  })
})

describe('scoreCafe — amenities and preferences', () => {
  it('matching amenities score higher and are explained', () => {
    const wants = ctx({ preferences: { power: true, study: true } })
    const has = scoreCafe(cafe({ id: 'has' }), wants, W)
    const lacks = scoreCafe(cafe({ id: 'lacks', power: false, studyFriendly: false }), wants, W)
    expect(has.reasons.some((r) => r.key === 'HAS_POWER')).toBe(true)
    expect(has.reasons.some((r) => r.key === 'STUDY_FRIENDLY')).toBe(true)
    expect(has.score).toBeGreaterThan(lacks.score)
  })

  it('students get a nudge toward study-friendly cafés even without stated preferences', () => {
    const student = ctx({ userType: 'student' })
    const study = scoreCafe(cafe({ id: 'study', studyFriendly: true }), student, W)
    const loud = scoreCafe(cafe({ id: 'loud', studyFriendly: false }), student, W)
    expect(study.score).toBeGreaterThan(loud.score)
  })
})

describe('scoreCafe — cold start vs history', () => {
  it('history is ignored before cold_start_min_visits', () => {
    const c = cafe({ id: 'hist', visits: 4 })
    const cold = scoreCafe(c, ctx({ totalVisits: 2 }), W, { coldStartMinVisits: 3 })
    expect(cold.reasons.some((r) => r.key === 'YOUR_FAVORITE')).toBe(false)
  })

  it('after the cold start a favourite café gets a history bonus and explanation', () => {
    const c = cafe({ id: 'hist', visits: 4 })
    const warm = scoreCafe(c, ctx({ totalVisits: 5 }), W, { coldStartMinVisits: 3 })
    expect(warm.reasons.some((r) => r.key === 'YOUR_FAVORITE')).toBe(true)
    const fresh = scoreCafe(cafe({ id: 'fresh', visits: 0 }), ctx({ totalVisits: 5 }), W, { coldStartMinVisits: 3 })
    expect(fresh.reasons.some((r) => r.key === 'NEW_TO_YOU')).toBe(true)
  })
})

describe('scoreCafe — perks and rating', () => {
  const livePerk = {
    id: 'p1', title: 'Free flat white', titleAr: 'كابتشينو مجاني', type: 'FREE_ITEM', value: 'free coffee',
    days: '0', startTime: '00:00', endTime: '23:59', isActive: true, approvalStatus: 'APPROVED', dineIn: true, takeaway: true,
  }

  it('a usable perk right now scores and is explained (bilingual value passthrough)', () => {
    const withPerk = scoreCafe(cafe({ id: 'perk', perks: [livePerk] }), ctx(), W)
    expect(withPerk.perkNow).not.toBeNull()
    expect(withPerk.reasons.some((r) => r.key === 'PERK_NOW')).toBe(true)
    const paused = scoreCafe(cafe({ id: 'paused', perks: [{ ...livePerk, isActive: false }] }), ctx(), W)
    expect(paused.perkNow).toBeNull()
    expect(paused.score).toBeLessThan(withPerk.score)
  })

  it('higher rating adds score; excellent cafés are flagged', () => {
    const good = scoreCafe(cafe({ id: 'good', rating: 4.9 }), ctx(), W)
    const ok = scoreCafe(cafe({ id: 'ok', rating: 4.0 }), ctx(), W)
    expect(good.reasons.some((r) => r.key === 'HIGH_RATED')).toBe(true)
    expect(good.score).toBeGreaterThan(ok.score)
  })
})

describe('rankCafes + explainCafe', () => {
  it('sorts by score, respects the limit and trims reasons', () => {
    const cafes = [
      cafe({ id: 'a', rating: 4.0, hours: '02:00-02:30' }),
      cafe({ id: 'b', rating: 4.9 }),
      cafe({ id: 'c', rating: 4.8, power: true }),
      cafe({ id: 'd', rating: 4.7, studyFriendly: true }),
      cafe({ id: 'e', rating: 4.6 }),
      cafe({ id: 'f', rating: 4.5 }),
    ]
    const ranked = rankCafes(cafes, ctx(), W, { limit: 3, maxReasons: 2 })
    expect(ranked).toHaveLength(3)
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score)
    ranked.forEach((r) => expect(r.reasons.length).toBeLessThanOrEqual(2))
  })

  it('explanations render in the requested language', () => {
    const scored = scoreCafe(cafe({ id: 'x' }), ctx(), W)
    const en = explainCafe(scored, 'en')
    const ar = explainCafe(scored, 'ar')
    expect(en.length).toBeGreaterThan(0)
    if (scored.reasons.some((r) => r.key === 'OPEN_NOW')) {
      expect(en.join(' ')).toContain('Open now')
      expect(ar.join(' ')).toContain('مفتوح الآن')
    }
  })
})

describe('diversity jitter (deterministic rotation)', () => {
  it('same seed → same score; different seed → near-ties reorder but never wildly', () => {
    const c = cafe({ id: 'seed' })
    const s1 = scoreCafe(c, ctx(), W, { diversitySeed: 'member1:2026-11-08' })
    const s2 = scoreCafe(c, ctx(), W, { diversitySeed: 'member1:2026-11-08' })
    expect(s1.score).toBe(s2.score)
    const s3 = scoreCafe(c, ctx(), W, { diversitySeed: 'member1:2026-11-09' })
    expect(Math.abs(s3.score - s1.score) / Math.max(1, s1.score)).toBeLessThan(0.08)
    expect(s3.score).not.toBe(s1.score)
  })
})
