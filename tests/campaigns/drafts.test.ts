/**
 * Unit tests for Campaign Studio draft assembly (Phase 2).
 * Pure functions only — no database required. Run: npx vitest run
 */
import { describe, it, expect } from 'vitest'
import {
  buildDraftCopy,
  parseSchedulePermissions,
  validateDraft,
} from '../../src/lib/campaigns/drafts'
import type { FieldDef } from '../../src/lib/campaigns/validate'

const FIELDS: FieldDef[] = [
  { key: 'discountPercent', type: 'int', label: 'Discount %', labelAr: 'نسبة الخصم %', required: true, min: 5, max: 50, unit: '%' },
  { key: 'appliesTo', type: 'text', label: 'Applies to', labelAr: 'يطبق على', required: true, max: 120 },
  { key: 'tier', type: 'enum', label: 'Tier', options: ['Basic', 'Plus'] },
]

const TEMPLATE = {
  status: 'ACTIVE',
  minDurationDays: 14,
  maxDurationDays: 120,
  requiresReview: false,
}

const VERSION = {
  fieldSchema: JSON.stringify(FIELDS),
  capRanges: JSON.stringify({ perMemberMin: 1, perMemberMax: 5, monthlyMin: 1, monthlyMax: 100 }),
  schedulePermissions: 'DAYS,HOURS,DATES',
}

const DURATION = { minDurationDays: 14, maxDurationDays: 120 }
const OK_CTX = {
  template: TEMPLATE,
  marketStatus: 'AVAILABLE' as const,
  version: VERSION,
  duration: DURATION,
}

const future = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString()

describe('parseSchedulePermissions', () => {
  it('parses all listed aspects', () => {
    expect(parseSchedulePermissions('DAYS,HOURS,DATES')).toEqual({ dates: true, days: true, hours: true })
  })
  it('marks unlisted aspects as forbidden', () => {
    expect(parseSchedulePermissions('HOURS')).toEqual({ dates: false, days: false, hours: true })
  })
  it('treats empty/null as nothing permitted', () => {
    expect(parseSchedulePermissions('')).toEqual({ dates: false, days: false, hours: false })
    expect(parseSchedulePermissions(null)).toEqual({ dates: false, days: false, hours: false })
  })
  it('is case-insensitive', () => {
    expect(parseSchedulePermissions('dates')).toEqual({ dates: true, days: false, hours: false })
  })
})

describe('buildDraftCopy', () => {
  it('defaults titles and descriptions to the approved template wording', () => {
    const copy = buildDraftCopy(
      { name: 'Weekday member special', nameAr: 'عرض الأعضاء', description: 'A member discount.', descriptionAr: 'خصم للأعضاء.' },
      FIELDS,
      {},
    )
    expect(copy.title).toBe('Weekday member special')
    expect(copy.titleAr).toBe('عرض الأعضاء')
    expect(copy.description).toBe('A member discount.')
    expect(copy.promoText).toBe('')
    expect(copy.promoTextAr).toBe('')
  })

  it('joins configured values with bilingual field labels', () => {
    const copy = buildDraftCopy(
      { name: 'T', nameAr: 'ق', description: 'D', descriptionAr: 'و' },
      FIELDS,
      { discountPercent: 15, appliesTo: 'all hot drinks' },
    )
    expect(copy.promoText).toBe('Discount %: 15 · Applies to: all hot drinks')
    expect(copy.promoTextAr).toBe('نسبة الخصم %: 15 · يطبق على: all hot drinks')
  })

  it('skips empty values and falls back to the English label when no Arabic label', () => {
    const copy = buildDraftCopy(
      { name: 'T', nameAr: 'ق', description: 'D', descriptionAr: 'و' },
      FIELDS,
      { tier: 'Plus', discountPercent: '' },
    )
    expect(copy.promoText).toBe('Tier: Plus')
    expect(copy.promoTextAr).toBe('Tier: Plus')
  })

  it('clips extremely long values', () => {
    const copy = buildDraftCopy(
      { name: 'T', nameAr: 'ق', description: 'D', descriptionAr: 'و' },
      FIELDS,
      { appliesTo: 'x'.repeat(500) },
    )
    expect(copy.promoText.length).toBeLessThanOrEqual(280)
    expect(copy.promoText.endsWith('…') || copy.promoText.length < 280).toBe(true)
  })
})

describe('validateDraft', () => {
  const good = () => ({
    config: { discountPercent: 15, appliesTo: 'hot drinks' },
    startsAt: future(1).slice(0, 10),
    endsAt: future(31).slice(0, 10),
    days: '0,1,2,3,4,5,6',
    startTime: '00:00',
    endTime: '23:59',
    capPerMember: 3,
    capMonthly: 50,
  })

  it('accepts a fully valid draft', () => {
    const r = validateDraft(good(), OK_CTX)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('aggregates template, config and cap violations together', () => {
    const r = validateDraft(
      { ...good(), config: { discountPercent: 90 }, capPerMember: 50, capMonthly: null },
      { ...OK_CTX, template: { ...TEMPLATE, status: 'RETIRED' }, marketStatus: 'UNAVAILABLE' },
    )
    expect(r.ok).toBe(false)
    const codes = r.errors.map((e) => e.code)
    expect(codes).toContain('TEMPLATE_RETIRED')
    expect(codes).toContain('MARKET_UNAVAILABLE')
    expect(codes).toContain('CONFIG_OUT_OF_RANGE')
    expect(codes).toContain('CAP_OUT_OF_RANGE')
  })

  it('enforces the pinned version field schema (unknown + missing fields)', () => {
    const r = validateDraft({ ...good(), config: { freeMoney: true } }, OK_CTX)
    expect(r.ok).toBe(false)
    const codes = r.errors.map((e) => e.code)
    expect(codes).toContain('CONFIG_UNKNOWN_FIELD')
    expect(codes).toContain('CONFIG_REQUIRED')
  })

  it('forbids schedule aspects the template does not permit', () => {
    const r = validateDraft(
      { ...good(), days: '1,2,3' },
      { ...OK_CTX, version: { ...VERSION, schedulePermissions: 'HOURS' } },
    )
    expect(r.ok).toBe(false)
    expect(r.errors).toContainEqual({ code: 'SCHEDULE_NOT_PERMITTED', field: 'days' })
  })

  it('enforces the template duration range', () => {
    const r = validateDraft(
      { ...good(), endsAt: future(200).slice(0, 10) },
      OK_CTX,
    )
    expect(r.errors).toContainEqual({ code: 'SCHEDULE_TOO_LONG', field: 'duration' })
  })

  it('rejects a cap when the template permits none', () => {
    const r = validateDraft(
      { ...good(), capTotal: 5 },
      { ...OK_CTX, version: { ...VERSION, capRanges: JSON.stringify({}) } },
    )
    expect(r.errors).toContainEqual({ code: 'CAP_NOT_PERMITTED', field: 'capTotal' })
  })

  it('accepts defaults untouched when no schedule aspects are permitted', () => {
    const r = validateDraft(good(), {
      ...OK_CTX,
      version: { ...VERSION, schedulePermissions: '' },
    })
    // dates were supplied → not permitted
    expect(r.ok).toBe(false)
    expect(r.errors).toContainEqual({ code: 'SCHEDULE_NOT_PERMITTED', field: 'dates' })

    const plain = validateDraft(
      { config: good().config, startsAt: null, endsAt: null, days: '0,1,2,3,4,5,6', startTime: '00:00', endTime: '23:59', capPerMember: 3 },
      { ...OK_CTX, version: { ...VERSION, schedulePermissions: '' } },
    )
    expect(plain.ok).toBe(true)
  })
})
