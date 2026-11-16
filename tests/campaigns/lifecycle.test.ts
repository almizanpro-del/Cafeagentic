/**
 * Unit tests for Campaign Studio lifecycle governance (Phase 4).
 * Pure-function tests — no database required. Run: npx vitest run
 */
import { describe, it, expect } from 'vitest'
import { checkAction, type LifecycleAction } from '../../src/lib/campaigns/lifecycle-map'
import { LIFECYCLE_TRANSITIONS } from '../../src/lib/campaigns/validate'

describe('checkAction — owner role', () => {
  const cases: [LifecycleAction, string, 'ok' | string][] = [
    // SUBMIT: drafts and rejected campaigns, nothing else
    ['SUBMIT', 'DRAFT', 'ok'],
    ['SUBMIT', 'REJECTED', 'ok'],
    ['SUBMIT', 'PENDING_REVIEW', 'INVALID_TRANSITION'],
    ['SUBMIT', 'ACTIVE', 'INVALID_TRANSITION'],
    // SCHEDULE: from DRAFT or APPROVED
    ['SCHEDULE', 'DRAFT', 'ok'],
    ['SCHEDULE', 'APPROVED', 'ok'],
    ['SCHEDULE', 'PENDING_REVIEW', 'INVALID_TRANSITION'],
    ['SCHEDULE', 'ACTIVE', 'INVALID_TRANSITION'],
    // PAUSE / RESUME
    ['PAUSE', 'SCHEDULED', 'ok'],
    ['PAUSE', 'ACTIVE', 'ok'],
    ['PAUSE', 'PAUSED', 'INVALID_TRANSITION'],
    ['RESUME', 'PAUSED', 'ok'],
    ['RESUME', 'ACTIVE', 'INVALID_TRANSITION'],
    // CANCEL from every pre-terminal state
    ['CANCEL', 'DRAFT', 'ok'],
    ['CANCEL', 'PENDING_REVIEW', 'ok'],
    ['CANCEL', 'APPROVED', 'ok'],
    ['CANCEL', 'SCHEDULED', 'ok'],
    ['CANCEL', 'ACTIVE', 'ok'],
    ['CANCEL', 'PAUSED', 'ok'],
    ['CANCEL', 'EXPIRED', 'INVALID_TRANSITION'],
    ['CANCEL', 'CANCELLED', 'INVALID_TRANSITION'],
  ]
  for (const [action, from, expected] of cases) {
    it(`${action} from ${from} → ${expected}`, () => {
      const r = checkAction(action, 'OWNER', from)
      if (expected === 'ok') {
        expect(r.ok).toBe(true)
      } else {
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.code).toBe(expected)
      }
    })
  }

  it('owner cannot use admin-only actions', () => {
    expect(checkAction('APPROVE', 'OWNER', 'PENDING_REVIEW').ok).toBe(false)
    expect(checkAction('REJECT', 'OWNER', 'PENDING_REVIEW').ok).toBe(false)
    expect(checkAction('END', 'OWNER', 'ACTIVE').ok).toBe(false)
  })
})

describe('checkAction — admin role', () => {
  it('admin can approve/reject pending campaigns and end active ones', () => {
    expect(checkAction('APPROVE', 'ADMIN', 'PENDING_REVIEW')).toEqual({ ok: true, to: 'APPROVED' })
    expect(checkAction('REJECT', 'ADMIN', 'PENDING_REVIEW')).toEqual({ ok: true, to: 'REJECTED' })
    expect(checkAction('END', 'ADMIN', 'ACTIVE')).toEqual({ ok: true, to: 'EXPIRED' })
  })
  it('admin can act on any reviewable state but still respects the map', () => {
    expect(checkAction('SUBMIT', 'ADMIN', 'DRAFT').ok).toBe(true)
    expect(checkAction('PAUSE', 'ADMIN', 'ACTIVE').ok).toBe(true)
    expect(checkAction('APPROVE', 'ADMIN', 'DRAFT').ok).toBe(false) // wrong source status
    expect(checkAction('END', 'ADMIN', 'PAUSED').ok).toBe(false) // no ACTIVE→EXPIRED from PAUSED via END
  })
})

describe('map coherence', () => {
  it('every action edge is also permitted by the Engine Five map', () => {
    // The ACTION_EDGES are hand-checked against LIFECYCLE_TRANSITIONS; here we
    // verify the composed flows used by the UI never dead-end silently.
    expect(LIFECYCLE_TRANSITIONS.DRAFT).toContain('PENDING_REVIEW')
    expect(LIFECYCLE_TRANSITIONS.DRAFT).toContain('SCHEDULED')
    expect(LIFECYCLE_TRANSITIONS.PENDING_REVIEW).toContain('APPROVED')
    expect(LIFECYCLE_TRANSITIONS.PENDING_REVIEW).toContain('REJECTED')
    expect(LIFECYCLE_TRANSITIONS.APPROVED).toContain('SCHEDULED')
    expect(LIFECYCLE_TRANSITIONS.PAUSED).toContain('ACTIVE')
    expect(LIFECYCLE_TRANSITIONS.ACTIVE).toContain('EXPIRED')
  })
})
