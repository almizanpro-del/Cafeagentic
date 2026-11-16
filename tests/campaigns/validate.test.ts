/**
 * Unit tests for the Campaign Studio deterministic validation engine.
 * These are pure-function tests — no database required.
 * Run: npx vitest run
 */
import { describe, it, expect } from 'vitest'
import {
  parseFieldSchema,
  parseCapRanges,
  validateConfig,
  validateSchedule,
  validateCaps,
  validateTemplateUsable,
  canTransition,
  type FieldDef,
} from '../../src/lib/campaigns/validate'

const FIELDS: FieldDef[] = [
  { key: 'benefitValue', type: 'enum', label: 'Benefit', required: true, options: ['Free selected drink', 'Free size upgrade'] },
  { key: 'discountPercent', type: 'int', label: 'Discount %', min: 5, max: 50 },
  { key: 'comboPrice', type: 'number', label: 'Price', min: 0.5, max: 10 },
  { key: 'productNote', type: 'text', label: 'Note' },
]

describe('validateConfig', () => {
  it('accepts a valid configuration', () => {
    const r = validateConfig(FIELDS, { benefitValue: 'Free selected drink', discountPercent: 15 })
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('rejects an unknown field not permitted by the template', () => {
    const r = validateConfig(FIELDS, { freeMoney: true })
    expect(r.ok).toBe(false)
    expect(r.errors).toContainEqual({ code: 'CONFIG_UNKNOWN_FIELD', field: 'freeMoney' })
  })

  it('rejects a missing required field', () => {
    const r = validateConfig(FIELDS, {})
    expect(r.ok).toBe(false)
    expect(r.errors).toContainEqual({ code: 'CONFIG_REQUIRED', field: 'benefitValue' })
  })

  it('rejects an enum value outside the permitted options', () => {
    const r = validateConfig(FIELDS, { benefitValue: 'Free car' })
    expect(r.ok).toBe(false)
    expect(r.errors).toContainEqual({ code: 'CONFIG_INVALID_OPTION', field: 'benefitValue' })
  })

  it('rejects an int outside the permitted range and a non-integer int', () => {
    expect(validateConfig(FIELDS, { discountPercent: 80 }).errors).toContainEqual({ code: 'CONFIG_OUT_OF_RANGE', field: 'discountPercent' })
    expect(validateConfig(FIELDS, { discountPercent: 12.5 }).errors).toContainEqual({ code: 'CONFIG_INVALID', field: 'discountPercent' })
  })

  it('rejects a number outside the permitted range', () => {
    expect(validateConfig(FIELDS, { comboPrice: 25 }).errors).toContainEqual({ code: 'CONFIG_OUT_OF_RANGE', field: 'comboPrice' })
  })

  it('rejects non-object configuration', () => {
    expect(validateConfig(FIELDS, 'oops' as unknown as Record<string, unknown>).ok).toBe(false)
  })
})

describe('validateSchedule', () => {
  const duration = { minDurationDays: 7, maxDurationDays: 90 }
  const permsAll = { dates: true, days: true, hours: true }
  const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString()

  it('accepts defaults with no input', () => {
    expect(validateSchedule({}, permsAll, duration).ok).toBe(true)
  })

  it('accepts a valid future date range within duration limits', () => {
    const r = validateSchedule({ startsAt: future(1), endsAt: future(31) }, permsAll, duration)
    expect(r.ok).toBe(true)
  })

  it('rejects end before start', () => {
    const r = validateSchedule({ startsAt: future(10), endsAt: future(5) }, permsAll, duration)
    expect(r.errors).toContainEqual({ code: 'SCHEDULE_END_BEFORE_START' })
  })

  it('rejects durations outside the template range', () => {
    const short = validateSchedule({ startsAt: future(1), endsAt: future(3) }, permsAll, duration)
    expect(short.errors).toContainEqual({ code: 'SCHEDULE_TOO_SHORT', field: 'duration' })
    const long = validateSchedule({ startsAt: future(1), endsAt: future(200) }, permsAll, duration)
    expect(long.errors).toContainEqual({ code: 'SCHEDULE_TOO_LONG', field: 'duration' })
  })

  it('rejects a start date in the past', () => {
    const r = validateSchedule({ startsAt: new Date(Date.now() - 5 * 86400000).toISOString(), endsAt: future(10) }, permsAll, duration)
    expect(r.errors).toContainEqual({ code: 'SCHEDULE_START_IN_PAST', field: 'startsAt' })
  })

  it('rejects invalid days and hours formats', () => {
    expect(validateSchedule({ days: '0,1,9' }, permsAll, duration).errors).toContainEqual({ code: 'SCHEDULE_INVALID_DAYS', field: 'days' })
    expect(validateSchedule({ startTime: '25:00', endTime: '23:59' }, permsAll, duration).errors).toContainEqual({ code: 'SCHEDULE_INVALID_HOURS', field: 'startTime' })
    expect(validateSchedule({ startTime: '14:00', endTime: '09:00' }, permsAll, duration).errors).toContainEqual({ code: 'SCHEDULE_INVALID_HOURS_RANGE' })
  })

  it('enforces schedule permissions: a template without DATES cannot receive dates', () => {
    const r = validateSchedule({ startsAt: future(1), endsAt: future(31) }, { dates: false, days: true, hours: true }, duration)
    expect(r.errors).toContainEqual({ code: 'SCHEDULE_NOT_PERMITTED', field: 'dates' })
  })

  it('enforces schedule permissions: a template without HOURS cannot receive custom hours', () => {
    const r = validateSchedule({ startTime: '09:00', endTime: '12:00' }, { dates: true, days: true, hours: false }, duration)
    expect(r.errors).toContainEqual({ code: 'SCHEDULE_NOT_PERMITTED', field: 'hours' })
  })
})

describe('validateCaps', () => {
  it('accepts caps within permitted ranges', () => {
    const r = validateCaps({ capPerMember: 1, capMonthly: 100 }, { perMemberMin: 1, perMemberMax: 1, monthlyMin: 1, monthlyMax: 500 })
    expect(r.ok).toBe(true)
  })

  it('rejects a cap the template does not permit at all', () => {
    const r = validateCaps({ capTotal: 10 }, {})
    expect(r.errors).toContainEqual({ code: 'CAP_NOT_PERMITTED', field: 'capTotal' })
  })

  it('rejects caps outside the permitted range', () => {
    const r = validateCaps({ capMonthly: 900 }, { monthlyMin: 1, monthlyMax: 500 })
    expect(r.errors).toContainEqual({ code: 'CAP_OUT_OF_RANGE', field: 'capMonthly' })
  })

  it('rejects invalid cap values', () => {
    expect(validateCaps({ capMonthly: 0 }, { monthlyMin: 1, monthlyMax: 5 }).errors).toContainEqual({ code: 'CAP_INVALID', field: 'capMonthly' })
    expect(validateCaps({ capMonthly: 2.5 }, { monthlyMin: 1, monthlyMax: 5 }).errors).toContainEqual({ code: 'CAP_INVALID', field: 'capMonthly' })
  })
})

describe('validateTemplateUsable', () => {
  const base = { status: 'ACTIVE', minDurationDays: 7, maxDurationDays: 90, requiresReview: false }

  it('accepts an active template available in the market', () => {
    expect(validateTemplateUsable(base, 'AVAILABLE').ok).toBe(true)
  })

  it('rejects a retired template', () => {
    expect(validateTemplateUsable({ ...base, status: 'RETIRED' }, 'AVAILABLE').errors).toContainEqual({ code: 'TEMPLATE_RETIRED' })
  })

  it('rejects a draft template', () => {
    expect(validateTemplateUsable({ ...base, status: 'DRAFT' }, 'AVAILABLE').errors).toContainEqual({ code: 'TEMPLATE_NOT_ACTIVE' })
  })

  it('rejects when the market is unavailable or not configured', () => {
    expect(validateTemplateUsable(base, 'UNAVAILABLE').errors).toContainEqual({ code: 'MARKET_UNAVAILABLE' })
    expect(validateTemplateUsable(base, undefined).errors).toContainEqual({ code: 'MARKET_NOT_CONFIGURED' })
  })
})

describe('parseFieldSchema / parseCapRanges', () => {
  it('parses a valid schema and drops malformed entries', () => {
    const fields = parseFieldSchema(JSON.stringify([
      { key: 'a', type: 'enum', label: 'A', options: ['x'] },
      { key: 'bad', type: 'nonsense', label: 'B' },
      'junk',
    ]))
    expect(fields).toHaveLength(1)
    expect(fields[0].key).toBe('a')
  })

  it('returns empty structures on invalid JSON instead of throwing', () => {
    expect(parseFieldSchema('not json')).toEqual([])
    expect(parseCapRanges('not json')).toEqual({})
  })
})

describe('canTransition (lifecycle map)', () => {
  it('allows the forward lifecycle', () => {
    expect(canTransition('DRAFT', 'SCHEDULED')).toBe(true)
    expect(canTransition('PENDING_REVIEW', 'APPROVED')).toBe(true)
    expect(canTransition('ACTIVE', 'PAUSED')).toBe(true)
    expect(canTransition('PAUSED', 'ACTIVE')).toBe(true)
  })

  it('forbids bypassing approval and resurrecting ended campaigns', () => {
    expect(canTransition('PENDING_REVIEW', 'ACTIVE')).toBe(false)
    expect(canTransition('DRAFT', 'ACTIVE')).toBe(false)
    expect(canTransition('EXPIRED', 'ACTIVE')).toBe(false)
    expect(canTransition('CANCELLED', 'ACTIVE')).toBe(false)
  })
})
