import { describe, it, expect } from 'vitest'
import { evaluateFraud, fraudCfgFromConfig, type FraudInput } from '../src/lib/agents/fraud'
import { AGENT_CONFIG_DEFAULTS } from '../src/lib/agents/config'

/**
 * The two agreed soft warning flags (never block the cashier):
 *   - GEO_IMPOSSIBLE   — same pass scanned at two far-apart cafés too quickly
 *                        for one person to travel between them.
 *   - NEW_ACCOUNT_BURST — an account under 72 hours old with 3+ redemptions today.
 * Both surface on the scanner in EN/AR and go to the audit log; neither ever
 * returns HARD_BLOCK.
 */
const cfg = fraudCfgFromConfig(AGENT_CONFIG_DEFAULTS)

const now = new Date('2026-11-08T12:00:00Z')
const AMMAN_ROASTERS = { lat: 31.9539, lng: 35.9106 } // downtown Amman
const CAFE_FAR = { lat: 32.35, lng: 35.91 }           // ~44 km north — 30 min by car is impossible

function input(overrides: Partial<FraudInput> = {}): FraudInput {
  return {
    memberId: 'member_1',
    memberName: 'Sara Ahmad',
    perkType: 'DISCOUNT',
    now,
    scanCafe: AMMAN_ROASTERS,
    priorFirstVisitOtherCafe: null,
    duplicatePhone: false,
    duplicateDevice: false,
    duplicateMatchedName: null,
    hourCount: 0,
    todayCount: 0,
    lastOtherCafe: null,
    accountCreatedAt: new Date(now.getTime() - 60 * 86_400_000), // 60-day-old account
    adminOverrideAt: null,
    ...overrides,
  }
}

describe('GEO_IMPOSSIBLE (soft flag, never blocks)', () => {
  it('fires when the previous scan was 44 km away 20 minutes ago', () => {
    const v = evaluateFraud(input({
      lastOtherCafe: { lat: CAFE_FAR.lat, lng: CAFE_FAR.lng, cafeName: 'North Café', createdAt: new Date(now.getTime() - 20 * 60_000) },
    }), cfg)
    expect(v.decision).toBe('SOFT_CHALLENGE')
    expect(v.reasonCode).toBe('GEO_IMPOSSIBLE')
    expect(v.decision).not.toBe('HARD_BLOCK')
    expect(v.checks.find((c) => c.rule === 'geo_impossible')?.passed).toBe(false)
  })

  it('stays quiet for a nearby prior café (walking distance, plausible speed)', () => {
    const v = evaluateFraud(input({
      lastOtherCafe: { lat: 31.9553, lng: 35.9124, cafeName: 'Corner Café', createdAt: new Date(now.getTime() - 12 * 60_000) }, // ~0.3 km
    }), cfg)
    expect(v.decision).toBe('APPROVE')
    expect(v.checks.find((c) => c.rule === 'geo_impossible')?.passed).toBe(true)
  })

  it('stays quiet for a far café visited hours ago (travel time was possible)', () => {
    const v = evaluateFraud(input({
      lastOtherCafe: { lat: CAFE_FAR.lat, lng: CAFE_FAR.lng, cafeName: 'North Café', createdAt: new Date(now.getTime() - 180 * 60_000) },
    }), cfg)
    expect(v.decision).toBe('APPROVE')
  })

  it('ignores scans older than the 4-hour geo window', () => {
    const v = evaluateFraud(input({
      lastOtherCafe: { lat: CAFE_FAR.lat, lng: CAFE_FAR.lng, cafeName: 'North Café', createdAt: new Date(now.getTime() - 241 * 60_000) },
    }), cfg)
    expect(v.decision).toBe('APPROVE')
    expect(v.checks.find((c) => c.rule === 'geo_impossible')?.detail).toBe('outside window')
  })

  it('skips cafés with missing coordinates upstream (0,0 never implies travel)', () => {
    const v = evaluateFraud(input({
      lastOtherCafe: { lat: 0, lng: 0, cafeName: 'No-Geo Café', createdAt: new Date(now.getTime() - 5 * 60_000) },
      scanCafe: { lat: 0, lng: 0 },
    }), cfg)
    // distance 0 km < geo_min_distance_km → no travel-impossibility verdict
    expect(v.decision).toBe('APPROVE')
  })
})

describe('NEW_ACCOUNT_BURST (soft flag, never blocks)', () => {
  it('fires for an account under 72 hours old with 3+ redemptions today', () => {
    const v = evaluateFraud(input({
      accountCreatedAt: new Date(now.getTime() - 24 * 3_600_000), // 1 day old
      todayCount: 3,
    }), cfg)
    expect(v.decision).toBe('SOFT_CHALLENGE')
    expect(v.reasonCode).toBe('NEW_ACCOUNT_BURST')
    expect(v.decision).not.toBe('HARD_BLOCK')
  })

  it('fires right at the 72-hour boundary', () => {
    const v = evaluateFraud(input({
      accountCreatedAt: new Date(now.getTime() - 72 * 3_600_000),
      todayCount: 3,
    }), cfg)
    expect(v.decision).toBe('SOFT_CHALLENGE')
    expect(v.reasonCode).toBe('NEW_ACCOUNT_BURST')
  })

  it('stays quiet below 3 redemptions today', () => {
    const v = evaluateFraud(input({
      accountCreatedAt: new Date(now.getTime() - 24 * 3_600_000),
      todayCount: 2,
    }), cfg)
    expect(v.decision).toBe('APPROVE')
  })

  it('stays quiet for an established account with heavy usage (velocity rules own that case)', () => {
    const v = evaluateFraud(input({
      accountCreatedAt: new Date(now.getTime() - 30 * 86_400_000),
      todayCount: 5,
    }), cfg)
    expect(v.decision).toBe('APPROVE')
  })
})

describe('flag interaction and config keys', () => {
  it('both flags are soft: a busted member can still be served', () => {
    const burst = evaluateFraud(input({ accountCreatedAt: new Date(now.getTime() - 3_600_000), todayCount: 4 }), cfg)
    expect(burst.decision).toBe('SOFT_CHALLENGE')
    const geo = evaluateFraud(input({
      lastOtherCafe: { lat: CAFE_FAR.lat, lng: CAFE_FAR.lng, cafeName: 'North Café', createdAt: new Date(now.getTime() - 10 * 60_000) },
    }), cfg)
    expect(geo.decision).toBe('SOFT_CHALLENGE')
  })

  it('GEO_IMPOSSIBLE wins over NEW_ACCOUNT_BURST (geo checked first, both still soft)', () => {
    const v = evaluateFraud(input({
      accountCreatedAt: new Date(now.getTime() - 3_600_000),
      todayCount: 3,
      lastOtherCafe: { lat: CAFE_FAR.lat, lng: CAFE_FAR.lng, cafeName: 'North Café', createdAt: new Date(now.getTime() - 10 * 60_000) },
    }), cfg)
    expect(v.reasonCode).toBe('GEO_IMPOSSIBLE')
    expect(v.decision).toBe('SOFT_CHALLENGE')
  })

  it('thresholds live in agent_config defaults (72h window, 3 redemptions)', () => {
    expect(AGENT_CONFIG_DEFAULTS['fraud.new_account_days']).toBe('3')
    expect(AGENT_CONFIG_DEFAULTS['fraud.new_account_max_day']).toBe('3')
    const custom = fraudCfgFromConfig({ ...AGENT_CONFIG_DEFAULTS, 'fraud.new_account_max_day': '5' })
    const v = evaluateFraud(input({ accountCreatedAt: new Date(now.getTime() - 3_600_000), todayCount: 4 }), custom)
    expect(v.decision).toBe('APPROVE') // 4 < 5 → no burst with the tuned threshold
  })

  it('a fresh admin override approves the re-scan (human controls stay on top)', () => {
    const v = evaluateFraud(input({
      adminOverrideAt: new Date(now.getTime() - 10 * 60_000),
      accountCreatedAt: new Date(now.getTime() - 3_600_000),
      todayCount: 4,
    }), cfg)
    expect(v.decision).toBe('APPROVE')
    expect(v.reasonCode).toBe('ADMIN_OVERRIDE_OK')
  })
})
