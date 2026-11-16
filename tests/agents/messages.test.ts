import { describe, it, expect } from 'vitest'
import {
  renderTemplate,
  FRAUD_STAFF_MESSAGES,
  MATCHER_EXPLANATIONS,
  RETENTION_TEMPLATES,
} from '../../src/lib/agents/messages'

/**
 * PRD §2 rule 5: everything a user or staff member reads exists in EN and AR.
 * messages.ts promises "messages.test.ts enforces it" — this file is that
 * enforcement: every template id must render in both languages, never leak
 * "undefined", and fall back safely for unknown ids.
 */

const STAFF_PARAMS = { masked: 'CP-••42', cafe: 'Rumi', count: 3, km: '12', min: 9, reason: 'Two cafés, 9 minutes' }
const MATCHER_PARAMS = { min: 4, visits: 3, value: '20% off', rating: '4.8' }
const RETENTION_PARAMS = { name: 'Sara', cafe: 'Rumi', cafeLast: 'Wander', perk: 'Free flat white', value: 'free coffee', days: 5 }

type AnyTemplate = { en: (p: Record<string, unknown>) => string; ar: (p: Record<string, unknown>) => string }

describe('agent message templates (EN/AR parity)', () => {
  const registries: [string, Record<string, AnyTemplate>, Record<string, unknown>][] = [
    ['FRAUD_STAFF_MESSAGES', FRAUD_STAFF_MESSAGES as unknown as Record<string, AnyTemplate>, STAFF_PARAMS],
    ['MATCHER_EXPLANATIONS', MATCHER_EXPLANATIONS as unknown as Record<string, AnyTemplate>, MATCHER_PARAMS],
    ['RETENTION_TEMPLATES', RETENTION_TEMPLATES as unknown as Record<string, AnyTemplate>, RETENTION_PARAMS],
  ]

  for (const [name, registry, params] of registries) {
    it(`${name}: every id renders in both languages without leaking placeholders`, () => {
      const ids = Object.keys(registry)
      expect(ids.length).toBeGreaterThan(0)
      for (const id of ids) {
        const t = registry[id]
        expect(typeof t.en, `${id} .en missing`).toBe('function')
        expect(typeof t.ar, `${id} .ar missing`).toBe('function')
        const en = t.en(params)
        const ar = t.ar(params)
        expect(en.trim().length, `${id} en empty`).toBeGreaterThan(3)
        expect(ar.trim().length, `${id} ar empty`).toBeGreaterThan(3)
        expect(en, `${id} en leaks undefined/null`).not.toMatch(/undefined/)
        expect(ar, `${id} ar leaks undefined/null`).not.toMatch(/undefined/)
        // Arabic must actually contain Arabic script (catches an English string pasted into .ar)
        expect(ar, `${id} ar has no Arabic script`).toMatch(/[\u0600-\u06FF]/)
      }
    })

    it(`${name}: missing params never print "undefined" (renderTemplate hardening)`, () => {
      for (const id of Object.keys(registry)) {
        // All agent code renders through renderTemplate — verify the real path
        expect(renderTemplate(registry, id, 'en', {})).not.toMatch(/undefined/)
        expect(renderTemplate(registry, id, 'ar', {})).not.toMatch(/undefined/)
      }
    })
  }

  it('renderTemplate picks the language and falls back to the id for unknown keys', () => {
    expect(renderTemplate(MATCHER_EXPLANATIONS, 'OPEN_NOW', 'en', {})).toBe('Open now')
    expect(renderTemplate(MATCHER_EXPLANATIONS, 'OPEN_NOW', 'ar', {})).toBe('مفتوح الآن')
    expect(renderTemplate(MATCHER_EXPLANATIONS, 'TOTALLY_UNKNOWN', 'en', {})).toBe('TOTALLY_UNKNOWN')
  })

  it('retention subjects exist for every body template', () => {
    for (const id of ['NEVER_REDEEMED', 'ONE_THEN_SILENT', 'COOLING_OFF', 'NEAR_EXPIRY']) {
      expect(RETENTION_TEMPLATES[id]).toBeDefined()
      expect(RETENTION_TEMPLATES[`${id}_SUBJECT`]).toBeDefined()
    }
  })
})
