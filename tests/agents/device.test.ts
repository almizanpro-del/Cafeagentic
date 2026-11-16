import { describe, it, expect } from 'vitest'
import { ipPrefix, deviceFingerprint, deviceSignalsFromHeaders } from '../../src/lib/agents/device'

/**
 * Device signals (PRD Agent 1 + §6 privacy): coarse fingerprints only.
 * We never store the raw IP — the prefix (/24 IPv4, /48 IPv6) and a SHA-256
 * fingerprint are the strongest signals we keep.
 */

describe('ipPrefix — coarse network prefix', () => {
  it('keeps the first three octets of an IPv4 address', () => {
    expect(ipPrefix('94.22.17.201')).toBe('94.22.17')
    expect(ipPrefix('1.2.3.4')).toBe('1.2.3')
  })

  it('keeps the first three hextets of an IPv6 address', () => {
    expect(ipPrefix('2a01:9700:11::5')).toBe('2a01:9700:11')
  })

  it('returns null for junk or missing IPs', () => {
    expect(ipPrefix('not-an-ip')).toBeNull()
    expect(ipPrefix(null)).toBeNull()
    expect(ipPrefix('')).toBeNull()
  })
})

describe('deviceFingerprint', () => {
  const input = { userAgent: 'Mozilla/5.0 (iPhone)', acceptLanguage: 'en-US,en;q=0.9', ip: '94.22.17.201' }

  it('is stable for identical signals', () => {
    expect(deviceFingerprint(input)).toBe(deviceFingerprint({ ...input }))
  })

  it('changes when any signal changes', () => {
    const base = deviceFingerprint(input)!
    expect(deviceFingerprint({ ...input, userAgent: 'Other/1.0' })).not.toBe(base)
    expect(deviceFingerprint({ ...input, ip: '94.22.18.1' })).not.toBe(base)
    expect(deviceFingerprint({ ...input, acceptLanguage: 'ar-JO,ar;q=0.9' })).not.toBe(base)
  })

  it('is a sha-256 hex digest', () => {
    expect(deviceFingerprint(input)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns null when there is nothing to fingerprint', () => {
    expect(deviceFingerprint({ userAgent: '', acceptLanguage: null, ip: null })).toBeNull()
    expect(deviceFingerprint({ userAgent: '', acceptLanguage: null, ip: 'not-an-ip' })).toBeNull()
  })
})

describe('deviceSignalsFromHeaders', () => {
  it('reads proxy headers, takes the first XFF hop, and derives both fields', () => {
    const headers = new Headers({
      'user-agent': 'Mozilla/5.0 (Android)',
      'accept-language': 'ar-JO,ar;q=0.9',
      'x-forwarded-for': '94.22.17.201, 10.0.0.1',
    })
    const out = deviceSignalsFromHeaders(headers)
    expect(out.ipPrefix).toBe('94.22.17')
    expect(out.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('never stores the raw IP anywhere in the result', () => {
    const out = deviceSignalsFromHeaders(new Headers({ 'x-forwarded-for': '94.22.17.201' }))
    expect(JSON.stringify(out)).not.toContain('94.22.17.201')
  })

  it('degrades gracefully on an empty request', () => {
    const out = deviceSignalsFromHeaders(new Headers())
    expect(out.fingerprint).toBeNull()
    expect(out.ipPrefix).toBeNull()
  })
})
