import { describe, it, expect } from 'vitest'
import { gateMessage, isQuietHours, jordanHHMM, weekStart } from '../../src/lib/agents/member-messaging'

/**
 * Agent messaging gates (PRD §5.3): opt-in per channel, Jordan quiet hours,
 * weekly cap — the pure gating core. Agents must never message anyone who
 * did not opt in, and never at night.
 */

describe('gateMessage — the consent-first matrix', () => {
  const base = { agentsEnabled: true, optedIn: true, quiet: false, messagesThisWeek: 0, weeklyCap: 3 }

  it('allows a subscribed member inside hours under the cap', () => {
    expect(gateMessage(base)).toEqual({ allowed: true })
  })

  it('blocks everything when agents are disabled (highest priority)', () => {
    expect(gateMessage({ ...base, agentsEnabled: false })).toEqual({ allowed: false, reason: 'AGENTS_DISABLED' })
  })

  it('never messages a channel the member has not opted into', () => {
    expect(gateMessage({ ...base, optedIn: false })).toEqual({ allowed: false, reason: 'OPT_OUT' })
  })

  it('respects quiet hours', () => {
    expect(gateMessage({ ...base, quiet: true })).toEqual({ allowed: false, reason: 'QUIET_HOURS' })
  })

  it('enforces the weekly cap', () => {
    expect(gateMessage({ ...base, messagesThisWeek: 3 })).toEqual({ allowed: false, reason: 'WEEKLY_CAP' })
    expect(gateMessage({ ...base, messagesThisWeek: 2, weeklyCap: 3 }).allowed).toBe(true)
  })

  it('agents-disabled wins over opt-out (defence in depth)', () => {
    expect(gateMessage({ ...base, agentsEnabled: false, optedIn: false, quiet: true, messagesThisWeek: 99 }).reason).toBe('AGENTS_DISABLED')
  })
})

describe('isQuietHours (member local time, Asia/Amman in v1)', () => {
  it('ordinary window', () => {
    expect(isQuietHours('23:30', '23:00', '07:00')).toBe(true)
    expect(isQuietHours('12:00', '23:00', '07:00')).toBe(false)
    expect(isQuietHours('06:59', '23:00', '07:00')).toBe(true)
  })

  it('window crossing midnight', () => {
    expect(isQuietHours('01:00', '23:00', '07:00')).toBe(true)
    expect(isQuietHours('22:00', '23:00', '07:00')).toBe(false)
  })

  it('start is inclusive, end exclusive', () => {
    expect(isQuietHours('11:00', '11:00', '13:00')).toBe(true)
    expect(isQuietHours('13:00', '11:00', '13:00')).toBe(false)
  })

  it('a degenerate window (start == end) is never quiet', () => {
    expect(isQuietHours('12:00', '12:00', '12:00')).toBe(false)
  })
})

describe('jordanHHMM — always Amman local time', () => {
  it('formats a UTC instant as Jordan time (UTC+3, year-round)', () => {
    expect(jordanHHMM(new Date('2026-11-08T12:00:00Z'))).toBe('15:00')
    expect(jordanHHMM(new Date('2026-07-15T21:30:00Z'))).toBe('00:30')
  })
})

describe('weekStart — rolling 7-day cap window', () => {
  it('is exactly 7 days before the given instant', () => {
    const now = new Date('2026-11-08T12:34:56Z')
    expect(weekStart(now).getTime()).toBe(new Date('2026-11-01T12:34:56Z').getTime())
  })
})
