import { describe, it, expect } from 'vitest'
import { clientIp, escHtml, csvCell, idTokenClaimsValid, timingSafeEqualText } from '../src/lib/security'

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) })

describe('clientIp', () => {
  it('uses the rightmost x-forwarded-for hop, not a client-forged leftmost one', () => {
    // attacker sends "1.2.3.4" themselves; the platform appends the real peer last
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }))).toBe('203.0.113.9')
  })
  it('a single hop is returned as-is', () => {
    expect(clientIp(req({ 'x-forwarded-for': '198.51.100.7' }))).toBe('198.51.100.7')
  })
  it('falls back to x-real-ip, then "unknown"', () => {
    expect(clientIp(req({ 'x-real-ip': ' 192.0.2.5 ' }))).toBe('192.0.2.5')
    expect(clientIp(req({}))).toBe('unknown')
  })
})

describe('escHtml', () => {
  it('neutralises markup in user-entered names', () => {
    expect(escHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;')
    expect(escHtml(`Ali "the" <a href='x'>&`)).toBe('Ali &quot;the&quot; &lt;a href=&#39;x&#39;&gt;&amp;')
  })
  it('handles null/undefined and non-strings', () => {
    expect(escHtml(null)).toBe('')
    expect(escHtml(undefined)).toBe('')
    expect(escHtml(42)).toBe('42')
  })
})

describe('csvCell', () => {
  it('prefixes formula-looking values so spreadsheets do not execute them', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`)
    expect(csvCell('+1+1')).toBe(`'+1+1`)
    expect(csvCell('-2')).toBe(`'-2`)
    expect(csvCell('@SUM(A1)')).toBe(`'@SUM(A1)`)
  })
  it('quotes commas, quotes and newlines (RFC 4180)', () => {
    expect(csvCell('Cafe, Downtown')).toBe('"Cafe, Downtown"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('a\nb')).toBe('"a\nb"')
  })
  it('leaves ordinary values and dates alone', () => {
    expect(csvCell('Amman Roasters')).toBe('Amman Roasters')
    expect(csvCell(null)).toBe('')
    expect(csvCell(new Date('2026-10-31T00:00:00Z'))).toBe('2026-10-31T00:00:00.000Z')
    expect(csvCell(true)).toBe('true')
  })
})

describe('idTokenClaimsValid', () => {
  const now = Date.UTC(2026, 9, 31, 12, 0, 0)
  const good = { iss: 'https://accounts.google.com', aud: 'client-123', exp: now / 1000 + 600 }
  it('accepts a fresh token issued by Google for this app', () => {
    expect(idTokenClaimsValid(good, 'client-123', now)).toBe(true)
    expect(idTokenClaimsValid({ ...good, iss: 'accounts.google.com' }, 'client-123', now)).toBe(true)
  })
  it('rejects a token issued for another app (aud)', () => {
    expect(idTokenClaimsValid({ ...good, aud: 'some-other-app' }, 'client-123', now)).toBe(false)
    expect(idTokenClaimsValid({ ...good, aud: ['x', 'client-123'] }, 'client-123', now)).toBe(true)
  })
  it('rejects a foreign issuer', () => {
    expect(idTokenClaimsValid({ ...good, iss: 'https://evil.example' }, 'client-123', now)).toBe(false)
  })
  it('rejects an expired or claim-less token', () => {
    expect(idTokenClaimsValid({ ...good, exp: now / 1000 - 1 }, 'client-123', now)).toBe(false)
    expect(idTokenClaimsValid({ iss: good.iss, aud: good.aud }, 'client-123', now)).toBe(false)
  })
})

describe('timingSafeEqualText', () => {
  it('accepts equal text and rejects different or differently sized text', () => {
    expect(timingSafeEqualText('oauth-state', 'oauth-state')).toBe(true)
    expect(timingSafeEqualText('oauth-state', 'oauth-stats')).toBe(false)
    expect(timingSafeEqualText('oauth-state', 'oauth-state-longer')).toBe(false)
  })
})
