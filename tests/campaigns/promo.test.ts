/**
 * Unit tests for the promo unlock-condition vocabulary (prototype salvage).
 * Pure-function tests — no database required. Run: npx vitest run
 *
 * The salvage contract: the prototype's condition/reward vocabulary survives,
 * its cart-and-checkout money machinery does not. Conditions are verified at
 * scan time against staff-entered or system-measured facts; the purchase
 * itself always settles directly between member and café.
 */
import { describe, it, expect } from 'vitest'
import {
  normalizePromoConditionType,
  parsePromoCondition,
  evaluatePromoCondition,
  parseConditionValue,
  promoConditionHint,
  PROMO_CONDITION_LABELS,
} from '../../src/lib/campaigns/promo'
import { CAMPAIGN_CODE_LABELS } from '../../src/lib/campaigns/reasons'
import { campaignValueText } from '../../src/lib/campaigns/redemption'

describe('normalizePromoConditionType', () => {
  it('accepts the canonical keys', () => {
    expect(normalizePromoConditionType('MIN_SPEND')).toBe('MIN_SPEND')
    expect(normalizePromoConditionType('GROUP_SIZE')).toBe('GROUP_SIZE')
    expect(normalizePromoConditionType('VISIT_COUNT')).toBe('VISIT_COUNT')
    expect(normalizePromoConditionType('NONE')).toBe('NONE')
  })

  it('accepts the template’s human-readable enum options', () => {
    expect(normalizePromoConditionType('Minimum spend unlock')).toBe('MIN_SPEND')
    expect(normalizePromoConditionType('Group visit unlock')).toBe('GROUP_SIZE')
    expect(normalizePromoConditionType('Nth visit unlock')).toBe('VISIT_COUNT')
    expect(normalizePromoConditionType('None — always available')).toBe('NONE')
  })

  it('accepts the prototype’s snake_case values and casing drift', () => {
    expect(normalizePromoConditionType('min_spend')).toBe('MIN_SPEND')
    expect(normalizePromoConditionType('Group Deal')).toBe('GROUP_SIZE')
    expect(normalizePromoConditionType('visit_count')).toBe('VISIT_COUNT')
  })

  it('returns null for garbage and non-strings', () => {
    expect(normalizePromoConditionType('free_pastry')).toBeNull()
    expect(normalizePromoConditionType('')).toBeNull()
    expect(normalizePromoConditionType(42)).toBeNull()
    expect(normalizePromoConditionType(null)).toBeNull()
  })
})

describe('parsePromoCondition', () => {
  it('returns null when no condition is configured', () => {
    expect(parsePromoCondition({})).toBeNull()
    expect(parsePromoCondition({ conditionType: 'None — always available', conditionAmount: 5 })).toBeNull()
    expect(parsePromoCondition(null)).toBeNull()
  })

  it('returns null for unrecognized types (safe reading: no extra condition)', () => {
    expect(parsePromoCondition({ conditionType: 'buy_x_get_y', conditionAmount: 3 })).toBeNull()
  })

  it('parses a complete minimum-spend condition incl. string amounts', () => {
    expect(parsePromoCondition({ conditionType: 'Minimum spend unlock', conditionAmount: 10 })).toEqual({
      type: 'MIN_SPEND',
      amount: 10,
    })
    expect(parsePromoCondition({ conditionType: 'min_spend', conditionAmount: '7.5' })).toEqual({
      type: 'MIN_SPEND',
      amount: 7.5,
    })
  })

  it('keeps a recognized type with a missing/invalid amount (surfaces as NOT_CONFIGURED)', () => {
    expect(parsePromoCondition({ conditionType: 'GROUP_SIZE' })).toEqual({ type: 'GROUP_SIZE', amount: null })
    expect(parsePromoCondition({ conditionType: 'VISIT_COUNT', conditionAmount: -3 })).toEqual({
      type: 'VISIT_COUNT',
      amount: null,
    })
    expect(parsePromoCondition({ conditionType: 'Nth visit unlock', conditionAmount: 'abc' })).toEqual({
      type: 'VISIT_COUNT',
      amount: null,
    })
  })
})

describe('evaluatePromoCondition', () => {
  it('blocks on a misconfigured amount', () => {
    const verdict = evaluatePromoCondition({ type: 'MIN_SPEND', amount: null }, { measured: 100, priorVisitsAtCafe: 9 })
    expect(verdict).toEqual({ met: false, reason: 'PROMO_NOT_CONFIGURED' })
  })

  it('MIN_SPEND: inclusive threshold, requires a measurement', () => {
    const cond = { type: 'MIN_SPEND' as const, amount: 10 }
    expect(evaluatePromoCondition(cond, { measured: 10, priorVisitsAtCafe: null }).met).toBe(true)
    expect(evaluatePromoCondition(cond, { measured: 12.5, priorVisitsAtCafe: null }).met).toBe(true)
    expect(evaluatePromoCondition(cond, { measured: 9.99, priorVisitsAtCafe: null })).toEqual({
      met: false,
      reason: 'PROMO_MIN_SPEND_UNMET',
    })
    expect(evaluatePromoCondition(cond, { measured: null, priorVisitsAtCafe: null })).toEqual({
      met: false,
      reason: 'PROMO_MEASUREMENT_REQUIRED',
    })
  })

  it('GROUP_SIZE: inclusive threshold, requires a measurement', () => {
    const cond = { type: 'GROUP_SIZE' as const, amount: 3 }
    expect(evaluatePromoCondition(cond, { measured: 3, priorVisitsAtCafe: null }).met).toBe(true)
    expect(evaluatePromoCondition(cond, { measured: 2, priorVisitsAtCafe: null })).toEqual({
      met: false,
      reason: 'PROMO_GROUP_SIZE_UNMET',
    })
    expect(evaluatePromoCondition(cond, { measured: null, priorVisitsAtCafe: null })).toEqual({
      met: false,
      reason: 'PROMO_MEASUREMENT_REQUIRED',
    })
  })

  it('VISIT_COUNT: the redeeming visit itself counts as the Nth', () => {
    const cond = { type: 'VISIT_COUNT' as const, amount: 5 }
    // 4 prior visits → this is visit #5 → unlocks
    expect(evaluatePromoCondition(cond, { measured: null, priorVisitsAtCafe: 4 }).met).toBe(true)
    // 5 prior visits → this is visit #6, already past → still fine (inclusive)
    expect(evaluatePromoCondition(cond, { measured: null, priorVisitsAtCafe: 5 }).met).toBe(true)
    // 3 prior visits → this is visit #4 → not yet
    expect(evaluatePromoCondition(cond, { measured: null, priorVisitsAtCafe: 3 })).toEqual({
      met: false,
      reason: 'PROMO_VISIT_COUNT_UNMET',
    })
    // System measurement missing → ask again rather than guess
    expect(evaluatePromoCondition(cond, { measured: null, priorVisitsAtCafe: null })).toEqual({
      met: false,
      reason: 'PROMO_MEASUREMENT_REQUIRED',
    })
  })
})

describe('parseConditionValue', () => {
  it('accepts numbers and numeric strings, rejects the rest', () => {
    expect(parseConditionValue(12.5)).toBe(12.5)
    expect(parseConditionValue('8')).toBe(8)
    expect(parseConditionValue('')).toBeNull()
    expect(parseConditionValue('abc')).toBeNull()
    expect(parseConditionValue(-1)).toBeNull()
    expect(parseConditionValue(2_000_000)).toBeNull()
  })
})

describe('promoConditionHint', () => {
  it('interpolates the café’s market currency for minimum spend', () => {
    const hint = promoConditionHint({ type: 'MIN_SPEND', amount: 10 }, 'AED')
    expect(hint.en).toContain('10 AED')
    expect(hint.ar).toContain('10 AED')
    expect(hint.en.length).toBeGreaterThan(0)
    expect(hint.ar.length).toBeGreaterThan(0)
  })

  it('covers group size and visit count bilingually', () => {
    expect(promoConditionHint({ type: 'GROUP_SIZE', amount: 4 }, 'JOD').en).toContain('4')
    expect(promoConditionHint({ type: 'GROUP_SIZE', amount: 4 }, 'JOD').ar.length).toBeGreaterThan(0)
    expect(promoConditionHint({ type: 'VISIT_COUNT', amount: 5 }, 'JOD').en).toContain('5')
    expect(promoConditionHint({ type: 'VISIT_COUNT', amount: 5 }, 'JOD').ar.length).toBeGreaterThan(0)
  })

  it('gives a fix-it hint for a misconfigured amount', () => {
    expect(promoConditionHint({ type: 'MIN_SPEND', amount: null }, 'JOD').en).toContain('owner')
  })
})

describe('label wiring', () => {
  it('PROMO_* codes are reachable through CAMPAIGN_CODE_LABELS', () => {
    for (const code of Object.keys(PROMO_CONDITION_LABELS)) {
      expect(CAMPAIGN_CODE_LABELS[code]).toBeDefined()
      expect(CAMPAIGN_CODE_LABELS[code].en.length).toBeGreaterThan(0)
      expect(CAMPAIGN_CODE_LABELS[code].ar.length).toBeGreaterThan(0)
    }
  })
})

describe('campaignValueText with custom promo config', () => {
  it('prefers rewardNote over generic config strings', () => {
    const config = { conditionType: 'Minimum spend unlock', conditionAmount: 10, rewardNote: 'Free cheesecake slice' }
    expect(campaignValueText('CUSTOM', config)).toBe('Free cheesecake slice')
  })

  it('falls back gracefully when rewardNote is absent', () => {
    expect(campaignValueText('CUSTOM', { conditionType: 'None — always available' })).toBe(
      'None — always available',
    )
  })
})
