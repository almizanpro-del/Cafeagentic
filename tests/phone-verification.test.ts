import { describe, it, expect } from 'vitest'
import { normalizePhone, maskPhone, isJordanMobile, JORDAN_CC } from '../src/lib/phone'
import {
  generateOtp,
  otpHash,
  otpMatches,
  verifyOtpVerdict,
  checkSendWindows,
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
} from '../src/lib/otp'

// ---------------------------------------------------------------- normalizePhone

describe('normalizePhone (Jordan-first, E.164 without "+")', () => {
  it('accepts the common Jordan formats and lands on one stored number', () => {
    const expected = '962796123456'
    expect(normalizePhone('+962 79 612 3456')).toBe(expected)
    expect(normalizePhone('0796123456')).toBe(expected)
    expect(normalizePhone('796123456')).toBe(expected)
    expect(normalizePhone('00962796123456')).toBe(expected)
    expect(normalizePhone('962796123456')).toBe(expected)
    expect(normalizePhone('+962796123456')).toBe(expected)
  })

  it('normalizes all Jordanian mobile prefixes', () => {
    expect(normalizePhone('0770123456')).toBe('962770123456')
    expect(normalizePhone('0780123456')).toBe('962780123456')
    expect(normalizePhone('0790123456')).toBe('962790123456')
  })

  it('reads Eastern-Arabic digits (Arabic keyboards)', () => {
    expect(normalizePhone('٠٧٩٦١٢٣٤٥٦')).toBe('962796123456')
    expect(normalizePhone('+٩٦٢٧٩٦١٢٣٤٥٦')).toBe('962796123456')
  })

  it('tolerates separators people actually type', () => {
    expect(normalizePhone('079-612-3456')).toBe('962796123456')
    expect(normalizePhone('(0796) 123 456')).toBe('962796123456')
    expect(normalizePhone(' 0796123456 ')).toBe('962796123456')
  })

  it('keeps non-Jordan numbers in international form', () => {
    expect(normalizePhone('+44 7911 123456')).toBe('447911123456')
    expect(normalizePhone('+1 (415) 555-2671')).toBe('14155552671')
  })

  it('rejects junk, truncations and impossible lengths', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone('   ')).toBeNull()
    expect(normalizePhone('not a phone')).toBeNull()
    expect(normalizePhone('12345')).toBeNull()                    // too short
    expect(normalizePhone('079612345')).toBeNull()                // local mobile missing a digit
    expect(normalizePhone('96279612345')).toBeNull()              // 962 but wrong length
    expect(normalizePhone('07961234567')).toBeNull()              // 11-digit local form
    expect(normalizePhone('96212345')).toBeNull()                 // Jordan landline truncated
    expect(normalizePhone('0' + '9'.repeat(16))).toBeNull()       // over E.164 max
  })
})

describe('maskPhone / isJordanMobile', () => {
  it('never exposes more than the last 3 digits', () => {
    expect(maskPhone('962796123456')).toBe('***456')
    expect(maskPhone('962796123456').length).toBe(6)
  })
  it('recognises Jordanian mobiles only after normalisation', () => {
    expect(isJordanMobile('962796123456')).toBe(true)
    expect(isJordanMobile('447911123456')).toBe(false)
    expect(isJordanMobile(JORDAN_CC + '212345678')).toBe(false) // not a mobile (no leading 7)
  })
})

// ---------------------------------------------------------------- code hashing

describe('OTP hashing (codes are never stored in plain text)', () => {
  const SECRET = 'test-otp-secret-at-least-16-chars'
  const uid = 'user_1'
  const phone = '962796123456'

  it('produces a deterministic 64-char hex digest, different from the code', () => {
    const h1 = otpHash(SECRET, uid, phone, '123456')
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(h1).not.toContain('123456')
    expect(otpHash(SECRET, uid, phone, '123456')).toBe(h1)
  })

  it('differs per code, per user and per phone', () => {
    const base = otpHash(SECRET, uid, phone, '123456')
    expect(otpHash(SECRET, uid, phone, '654321')).not.toBe(base)
    expect(otpHash(SECRET, 'user_2', phone, '123456')).not.toBe(base)
    expect(otpHash(SECRET, uid, '962770123456', '123456')).not.toBe(base)
  })

  it('is keyed by the secret — another secret cannot verify the code', () => {
    expect(otpMatches(SECRET, uid, phone, '123456', otpHash(SECRET, uid, phone, '123456'))).toBe(true)
    expect(otpMatches(SECRET, uid, phone, '123456', otpHash('another-secret-16-chars!!', uid, phone, '123456'))).toBe(false)
  })

  it('verifies the right code in constant time and rejects wrong ones', () => {
    const stored = otpHash(SECRET, uid, phone, '042917')
    expect(otpMatches(SECRET, uid, phone, '042917', stored)).toBe(true)
    expect(otpMatches(SECRET, uid, phone, '042918', stored)).toBe(false)
    expect(otpMatches(SECRET, uid, phone, '04291', stored)).toBe(false)
    expect(otpMatches(SECRET, uid, phone, '0042917', stored)).toBe(false)
  })

  it('generates 6-digit codes (leading zeros included)', () => {
    for (let i = 0; i < 50; i++) {
      const c = generateOtp()
      expect(c).toMatch(/^\d{6}$/)
    }
  })
})

// ---------------------------------------------------------------- verification decisions

describe('verifyOtpVerdict (expiry + attempt limits)', () => {
  const now = new Date('2026-11-08T12:00:00Z')

  it('has no verdict without a pending row', () => {
    expect(verifyOtpVerdict(null, now)).toBe('NO_PENDING')
    expect(verifyOtpVerdict(undefined, now)).toBe('NO_PENDING')
    expect(verifyOtpVerdict({ status: 'VERIFIED', attempts: 0, expiresAt: new Date(now.getTime() + OTP_TTL_MS) }, now)).toBe('NO_PENDING')
    expect(verifyOtpVerdict({ status: 'CONSUMED', attempts: 0, expiresAt: new Date(now.getTime() + OTP_TTL_MS) }, now)).toBe('NO_PENDING')
  })

  it('accepts a live pending code', () => {
    expect(verifyOtpVerdict({ status: 'PENDING', attempts: 0, expiresAt: new Date(now.getTime() + OTP_TTL_MS) }, now)).toBe('OK')
  })
  it('expires exactly at the 10-minute mark and after', () => {
    // A code created at now-10min carries expiresAt = now: one millisecond
    // before the mark it is still valid, from the mark itself it is dead.
    expect(verifyOtpVerdict({ status: 'PENDING', attempts: 0, expiresAt: new Date(now.getTime() + 1) }, now)).toBe('OK')
    expect(verifyOtpVerdict({ status: 'PENDING', attempts: 0, expiresAt: new Date(now.getTime()) }, now)).toBe('EXPIRED')
    expect(verifyOtpVerdict({ status: 'PENDING', attempts: 0, expiresAt: new Date(now.getTime() - 60_000) }, now)).toBe('EXPIRED')
  })

  it('refuses even a correct code once 5 wrong tries are spent', () => {
    const live = { status: 'PENDING' as const, expiresAt: new Date(now.getTime() + OTP_TTL_MS) }
    expect(verifyOtpVerdict({ ...live, attempts: OTP_MAX_ATTEMPTS - 1 }, now)).toBe('OK')
    expect(verifyOtpVerdict({ ...live, attempts: OTP_MAX_ATTEMPTS }, now)).toBe('TOO_MANY_ATTEMPTS')
    expect(verifyOtpVerdict({ ...live, attempts: OTP_MAX_ATTEMPTS + 3 }, now)).toBe('TOO_MANY_ATTEMPTS')
  })

  it('checks the attempt limit before expiry (dead code stays dead)', () => {
    expect(
      verifyOtpVerdict({ status: 'PENDING', attempts: OTP_MAX_ATTEMPTS, expiresAt: new Date(now.getTime() - 1) }, now)
    ).toBe('TOO_MANY_ATTEMPTS')
  })
})

// ---------------------------------------------------------------- send-rate windows

describe('checkSendLimits (5/15min member, 3/hour phone, 20/15min network, 60s gap)', () => {
  const now = new Date('2026-11-08T12:00:00Z')

  it('allows a normal first send', () => {
    expect(checkSendWindows({ memberSendCount15m: 0, phoneSendCount60m: 0, ipSendCount15m: 0, lastSentAt: null }, now)).toEqual({ ok: true })
  })

  it('enforces the 60-second spacing between sends', () => {
    const r = checkSendWindows(
      { memberSendCount15m: 0, phoneSendCount60m: 0, ipSendCount15m: 0, lastSentAt: new Date(now.getTime() - 59_000) },
      now,
    )
    expect(r).toEqual({ ok: false, reason: 'TOO_SOON', retryAfterMs: 1000 })
    expect(checkSendWindows(
      { memberSendCount15m: 0, phoneSendCount60m: 0, ipSendCount15m: 0, lastSentAt: new Date(now.getTime() - 60_000) },
      now,
    )).toEqual({ ok: true })
  })

  it('caps the member at 5 sends per 15 minutes', () => {
    const r = checkSendWindows({ memberSendCount15m: 5, phoneSendCount60m: 0, ipSendCount15m: 0, lastSentAt: null }, now)
    expect(r).toEqual({ ok: false, reason: 'MEMBER_LIMIT', retryAfterMs: 15 * 60_000 })
    expect(checkSendWindows({ memberSendCount15m: 4, phoneSendCount60m: 0, ipSendCount15m: 0, lastSentAt: null }, now)).toEqual({ ok: true })
  })

  it('caps the phone number at 3 sends per hour', () => {
    const r = checkSendWindows({ memberSendCount15m: 0, phoneSendCount60m: 3, ipSendCount15m: 0, lastSentAt: null }, now)
    expect(r).toEqual({ ok: false, reason: 'PHONE_LIMIT', retryAfterMs: 60 * 60_000 })
    expect(checkSendWindows({ memberSendCount15m: 0, phoneSendCount60m: 2, ipSendCount15m: 0, lastSentAt: null }, now)).toEqual({ ok: true })
  })

  it('caps the network prefix at 20 sends per 15 minutes', () => {
    const r = checkSendWindows({ memberSendCount15m: 0, phoneSendCount60m: 0, ipSendCount15m: 20, lastSentAt: null }, now)
    expect(r).toEqual({ ok: false, reason: 'IP_LIMIT', retryAfterMs: 15 * 60_000 })
    expect(checkSendWindows({ memberSendCount15m: 0, phoneSendCount60m: 0, ipSendCount15m: 19, lastSentAt: null }, now)).toEqual({ ok: true })
  })

  it('checks spacing before the counters', () => {
    const r = checkSendWindows({ memberSendCount15m: 9, phoneSendCount60m: 9, ipSendCount15m: 9, lastSentAt: new Date(now.getTime() - 5_000) }, now)
    expect(r).toEqual({ ok: false, reason: 'TOO_SOON', retryAfterMs: 55_000 })
  })
})
