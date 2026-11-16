/**
 * Referral program tests — the pure rule surface of src/lib/referrals.ts.
 *
 * The legacy prototype's fatal flaw was a "simulate a friend" form: type an
 * imaginary friend, collect a free month. Every test here guards a piece of
 * the rebuilt pipeline: unguessable unambiguous codes, tolerant-but-strict
 * code entry, clamped giveaway knobs, and grant decisions that extend a
 * running pass instead of ever inventing money.
 */
import { describe, it, expect } from 'vitest'
import {
  REFERRAL_ALPHABET,
  REFERRAL_CODE_RE,
  referralCodeFromBytes,
  normalizeReferralCode,
  referralConfigFromEnv,
  planGrant,
  referralCapReached,
  maskEmail,
  firstName,
  type MembershipState,
} from '../src/lib/referrals'

const NOW = new Date('2026-11-04T12:00:00Z')
const DAY = 24 * 3600 * 1000

// ------------------------------------------------------------- code format

describe('referralCodeFromBytes (unguessable personal code)', () => {
  it('produces the CP-XXXX-XXXX shape from fixed bytes', () => {
    const bytes = new Uint8Array(16).fill(0) // 0 < 240 → always accepted, alphabet[0]
    expect(referralCodeFromBytes(bytes)).toBe('CP-AAAA-AAAA')
  })

  it('only uses unambiguous characters (no 0/O, no 1/I/L)', () => {
    // Deterministic sweep: every accepted byte value maps into the alphabet.
    for (let b = 0; b < 240; b += 7) {
      const code = referralCodeFromBytes(new Uint8Array(16).fill(b))!
      expect(code).toMatch(REFERRAL_CODE_RE)
      for (const ch of code.replace(/[^A-Z0-9]/g, '')) {
        expect(REFERRAL_ALPHABET).toContain(ch)
      }
    }
  })

  it('skips high bytes (≥240) instead of biasing the alphabet', () => {
    // 255 is rejected; 0..7 accepted — one code needs 8 accepted bytes.
    const bytes = new Uint8Array([255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255])
    expect(referralCodeFromBytes(bytes)).toBe('CP-AAAA-AAAA')
  })

  it('returns null when the buffer cannot yield 8 characters', () => {
    expect(referralCodeFromBytes(new Uint8Array(15).fill(255))).toBeNull()
    expect(referralCodeFromBytes(new Uint8Array(0))).toBeNull()
  })

  it('maps accepted bytes uniformly (b % 30 over 240 = 8 full cycles)', () => {
    // Each accepted byte value is a deterministic alphabet index — verify a few.
    const idx = (b: number) => REFERRAL_ALPHABET.indexOf(referralCodeFromBytes(new Uint8Array(16).fill(b))!.replace(/CP-|-/g, '')[0])
    expect(idx(0)).toBe(0)
    expect(idx(29)).toBe(29)
    expect(idx(30)).toBe(0) // 30 % 30
    expect(idx(239)).toBe(239 % 30) // 239 % 30 = 29
  })
})

// ------------------------------------------------------------- code entry

describe('normalizeReferralCode (tolerant entry, strict shape)', () => {
  it('accepts the canonical form', () => {
    expect(normalizeReferralCode('CP-ABCD-EFGH')).toBe('CP-ABCD-EFGH')
  })

  it('accepts lowercase, missing dashes, spaces and stray punctuation', () => {
    expect(normalizeReferralCode('cp abcd efgh')).toBe('CP-ABCD-EFGH')
    expect(normalizeReferralCode('CPABCDEFGH')).toBe('CP-ABCD-EFGH')
    expect(normalizeReferralCode('  cp/abcd—efgh ')).toBe('CP-ABCD-EFGH')
    // dash placement never matters — the letters are what count
    expect(normalizeReferralCode('CP-ABCDE-FGH')).toBe('CP-ABCD-EFGH')
  })

  it('rejects wrong shapes: short, long, no CP prefix, non-strings', () => {
    expect(normalizeReferralCode('CP-ABC-EFG')).toBeNull()
    expect(normalizeReferralCode('CP-ABCDEFGH2')).toBeNull()
    expect(normalizeReferralCode('cpabcdefgh?utm=share')).toBeNull() // 13 letters ≠ a code
    expect(normalizeReferralCode('XX-ABCD-EFGH')).toBeNull()
    expect(normalizeReferralCode('')).toBeNull()
    expect(normalizeReferralCode(null)).toBeNull()
    expect(normalizeReferralCode(12345)).toBeNull()
    expect(normalizeReferralCode(undefined)).toBeNull()
  })

  it('rejects codes containing characters the alphabet never emits', () => {
    // The alphabet has no 0, 1, I, L or O — a code with them is a mistyped guess.
    expect(normalizeReferralCode('CP-ABCD-EFG0')).toBeNull()
    expect(normalizeReferralCode('CP-AB1D-EFGH')).toBeNull()
    expect(normalizeReferralCode('CP-ABCD-EFIL')).toBeNull()
    expect(normalizeReferralCode('CP-OBCD-EFGH')).toBeNull()
  })
})

// ---------------------------------------------------------------- config

describe('referralConfigFromEnv (clamped giveaway knobs)', () => {
  it('defaults to 14 referrer days / 7 friend days / 100 rewards', () => {
    expect(referralConfigFromEnv({})).toEqual({ referrerDays: 14, refereeDays: 7, maxRewards: 100 })
  })

  it('accepts valid overrides', () => {
    expect(referralConfigFromEnv({ REFERRAL_REFERRER_DAYS: '30', REFERRAL_REFEREE_DAYS: '3', REFERRAL_MAX_REWARDS: '10' })).toEqual({
      referrerDays: 30, refereeDays: 3, maxRewards: 10,
    })
  })

  it('clamps absurd or hostile values into sane ranges', () => {
    expect(referralConfigFromEnv({ REFERRAL_REFERRER_DAYS: '99999', REFERRAL_REFEREE_DAYS: '-50', REFERRAL_MAX_REWARDS: '0' })).toEqual({
      referrerDays: 365, refereeDays: 1, maxRewards: 1,
    })
  })

  it('falls back to defaults on garbage', () => {
    expect(referralConfigFromEnv({ REFERRAL_REFERRER_DAYS: 'free-money', REFERRAL_REFEREE_DAYS: '', REFERRAL_MAX_REWARDS: 'NaN' })).toEqual({
      referrerDays: 14, refereeDays: 7, maxRewards: 100,
    })
  })
})

// ---------------------------------------------------------------- grants

describe('planGrant (membership days, never money)', () => {
  const active: MembershipState = { active: { id: 'm1', endsAt: new Date(NOW.getTime() + 10 * DAY) }, lastPlanId: 'p-old', defaultPlanId: 'p-cheap' }

  it('extends a running pass by exactly N days, keeping its end date', () => {
    const grant = planGrant(active, 14, NOW)
    expect(grant).toEqual({ type: 'EXTEND', membershipId: 'm1', endsAt: new Date(NOW.getTime() + 24 * DAY) })
  })

  it('mints a starter pass from the member’s most recent plan when none is active', () => {
    const expired: MembershipState = { active: null, lastPlanId: 'p-old', defaultPlanId: 'p-cheap' }
    expect(planGrant(expired, 14, NOW)).toEqual({ type: 'CREATE', planId: 'p-old', startsAt: NOW, endsAt: new Date(NOW.getTime() + 14 * DAY) })
  })

  it('falls back to the cheapest current plan for a first-time member', () => {
    const fresh: MembershipState = { active: null, lastPlanId: null, defaultPlanId: 'p-cheap' }
    expect(planGrant(fresh, 7, NOW)).toEqual({ type: 'CREATE', planId: 'p-cheap', startsAt: NOW, endsAt: new Date(NOW.getTime() + 7 * DAY) })
  })

  it('skips when no plan exists to base a grant on (degraded, not broken)', () => {
    const bare: MembershipState = { active: null, lastPlanId: null, defaultPlanId: null }
    expect(planGrant(bare, 14, NOW)).toEqual({ type: 'SKIP' })
  })

  it('extension takes precedence over minting a new pass', () => {
    const grant = planGrant(active, 1, NOW)
    expect(grant.type).toBe('EXTEND')
  })
})

// ------------------------------------------------------------------- cap

describe('referralCapReached (giveaway budget)', () => {
  it('blocks earning at and beyond the cap', () => {
    expect(referralCapReached(100, 100)).toBe(true)
    expect(referralCapReached(101, 100)).toBe(true)
  })
  it('allows earning below the cap', () => {
    expect(referralCapReached(99, 100)).toBe(false)
    expect(referralCapReached(0, 100)).toBe(false)
  })
})

// -------------------------------------------------------------- display

describe('maskEmail (the referrer never sees the full address)', () => {
  it('shows only the first local-part character', () => {
    expect(maskEmail('sara.haddad@gmail.com')).toBe('s***@gmail.com')
    expect(maskEmail('a@b.co')).toBe('a***@b.co')
  })
  it('degrades safely on garbage', () => {
    expect(maskEmail('no-at-sign')).toBe('***')
    expect(maskEmail('@domain.com')).toBe('***')
    expect(maskEmail('user@')).toBe('u***@***')
  })
})

describe('firstName', () => {
  it('takes the first word', () => {
    expect(firstName('Sara Haddad')).toBe('Sara')
    expect(firstName('  Omar  ')).toBe('Omar')
  })
  it('never returns an empty string', () => {
    expect(firstName('')).toBe('—')
    expect(firstName('   ')).toBe('—')
  })
})
