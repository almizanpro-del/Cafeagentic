import { describe, it, expect } from 'vitest'
import { idemKey, backoffMinutes } from '../../src/lib/agents/bus'

/**
 * Event bus pure helpers (PRD §5.2): deterministic idempotency keys and the
 * n²-minute retry backoff with its 60-minute ceiling.
 */

describe('idemKey', () => {
  it('joins parts with a pipe so replays compute the identical key', () => {
    expect(idemKey('retention', 'COOLING_10_21', 'user_1', '2026-11')).toBe('retention|COOLING_10_21|user_1|2026-11')
    expect(idemKey('a', 1, 'b')).toBe('a|1|b')
    expect(idemKey()).toBe('')
  })

  it('different occurrences never collide', () => {
    expect(idemKey('m1', '2026-11-08')).not.toBe(idemKey('m2', '2026-11-08'))
  })
})

describe('backoffMinutes — attempts² capped at 60', () => {
  it('squares the attempt count', () => {
    expect(backoffMinutes(1)).toBe(1)
    expect(backoffMinutes(2)).toBe(4)
    expect(backoffMinutes(3)).toBe(9)
    expect(backoffMinutes(7)).toBe(49)
  })

  it('never exceeds 60 minutes', () => {
    expect(backoffMinutes(8)).toBe(60)
    expect(backoffMinutes(20)).toBe(60)
  })
})
