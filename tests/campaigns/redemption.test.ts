/**
 * Unit tests for Campaign Studio redemption-time evaluation (Phase 3).
 * Pure-function tests — no database required. Run: npx vitest run
 */
import { describe, it, expect } from 'vitest'
import {
  campaignWindowStatus,
  withinCampaignSchedule,
  planEligible,
  withinCampaignCaps,
  evaluateCampaignAvailability,
  campaignValueText,
  jordanStartOfMonth,
} from '../../src/lib/campaigns/redemption'

/** A jordanNow()-style Date: UTC fields carry Jordan wall-clock time. */
function jordan(y: number, m: number, d: number, hh = 12, mm = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, hh, mm))
}
/** UTC midnight of a campaign calendar day (how owner-picked dates are stored). */
function utcDay(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d))
}

const baseInput = {
  status: 'ACTIVE',
  startsAt: null,
  endsAt: null,
  days: '0,1,2,3,4,5,6',
  startTime: '00:00',
  endTime: '23:59',
  capPerMember: null,
  capMonthly: null,
  capTotal: null,
  membershipTypes: 'ALL',
  planName: 'Monthly',
}

const emptyUsage = { memberTotal: 0, memberMonthly: 0, total: 0 }

describe('campaignWindowStatus', () => {
  it('is UPCOMING before the start day and RUNNING on it', () => {
    const s = utcDay(2026, 11, 5)
    expect(campaignWindowStatus(s, null, jordan(2026, 11, 4))).toBe('UPCOMING')
    expect(campaignWindowStatus(s, null, jordan(2026, 11, 5, 0, 1))).toBe('RUNNING')
  })
  it('keeps the end day inclusive and finishes the day after', () => {
    const s = utcDay(2026, 11, 1)
    const e = utcDay(2026, 11, 7)
    expect(campaignWindowStatus(s, e, jordan(2026, 11, 7, 23, 59))).toBe('RUNNING')
    expect(campaignWindowStatus(s, e, jordan(2026, 11, 8, 0, 0))).toBe('FINISHED')
  })
  it('handles open-ended windows', () => {
    expect(campaignWindowStatus(null, null, jordan(2026, 11, 5))).toBe('RUNNING')
    expect(campaignWindowStatus(null, utcDay(2026, 11, 4), jordan(2026, 11, 5))).toBe('FINISHED')
  })
})

describe('withinCampaignSchedule', () => {
  it('admits any moment on the default all-days full-time schedule', () => {
    expect(withinCampaignSchedule('0,1,2,3,4,5,6', '00:00', '23:59', jordan(2026, 11, 5, 3, 24)).available).toBe(true)
  })
  it('blocks a wrong weekday', () => {
    // 2026-11-05 is a Thursday (day 4)
    expect(withinCampaignSchedule('5,6,0', '00:00', '23:59', jordan(2026, 11, 5)).reason).toBe('CAMPAIGN_OUT_OF_SCHEDULE')
  })
  it('blocks outside the daily hours and admits inside them', () => {
    const days = '0,1,2,3,4,5,6'
    expect(withinCampaignSchedule(days, '12:00', '17:00', jordan(2026, 11, 5, 11, 59)).available).toBe(false)
    expect(withinCampaignSchedule(days, '12:00', '17:00', jordan(2026, 11, 5, 12, 0)).available).toBe(true)
    expect(withinCampaignSchedule(days, '12:00', '17:00', jordan(2026, 11, 5, 17, 0)).available).toBe(true)
    expect(withinCampaignSchedule(days, '12:00', '17:00', jordan(2026, 11, 5, 17, 1)).available).toBe(false)
  })
})

describe('planEligible', () => {
  it('admits everyone when the gate is ALL or empty', () => {
    expect(planEligible('ALL', 'Monthly')).toBe(true)
    expect(planEligible('', 'Monthly')).toBe(true)
  })
  it('matches case-insensitively against the configured list', () => {
    expect(planEligible('monthly, yearly', 'Monthly')).toBe(true)
    expect(planEligible('Monthly', 'monthly')).toBe(true)
    expect(planEligible('yearly', 'Monthly')).toBe(false)
  })
})

describe('withinCampaignCaps', () => {
  it('enforces the per-member cap', () => {
    const caps = { capPerMember: 2, capMonthly: null, capTotal: null }
    expect(withinCampaignCaps(caps, { memberTotal: 1, memberMonthly: 1, total: 5 }).available).toBe(true)
    expect(withinCampaignCaps(caps, { memberTotal: 2, memberMonthly: 2, total: 5 }).reason).toBe('CAMPAIGN_MEMBER_CAP')
  })
  it('enforces the monthly and total caps', () => {
    expect(withinCampaignCaps({ capPerMember: null, capMonthly: 1, capTotal: null }, { memberTotal: 0, memberMonthly: 1, total: 0 }).reason).toBe('CAMPAIGN_MONTHLY_CAP')
    expect(withinCampaignCaps({ capPerMember: null, capMonthly: null, capTotal: 5 }, { memberTotal: 0, memberMonthly: 0, total: 5 }).reason).toBe('CAMPAIGN_TOTAL_CAP')
  })
  it('is unlimited when caps are null', () => {
    expect(withinCampaignCaps({ capPerMember: null, capMonthly: null, capTotal: null }, { memberTotal: 99, memberMonthly: 99, total: 999 }).available).toBe(true)
  })
})

describe('evaluateCampaignAvailability', () => {
  it('rejects non-ACTIVE instances first', () => {
    expect(evaluateCampaignAvailability({ ...baseInput, status: 'SCHEDULED' }, emptyUsage, jordan(2026, 11, 5)).reason).toBe('CAMPAIGN_NOT_LIVE')
    expect(evaluateCampaignAvailability({ ...baseInput, status: 'PAUSED' }, emptyUsage, jordan(2026, 11, 5)).reason).toBe('CAMPAIGN_NOT_LIVE')
  })
  it('reports not-started before ended for a finished window', () => {
    expect(
      evaluateCampaignAvailability(
        { ...baseInput, startsAt: utcDay(2026, 12, 1), endsAt: utcDay(2026, 12, 31) },
        emptyUsage, jordan(2026, 11, 5),
      ).reason,
    ).toBe('CAMPAIGN_NOT_STARTED')
    expect(
      evaluateCampaignAvailability(
        { ...baseInput, startsAt: utcDay(2026, 10, 1), endsAt: utcDay(2026, 10, 31) },
        emptyUsage, jordan(2026, 11, 5),
      ).reason,
    ).toBe('CAMPAIGN_ENDED')
  })
  it('passes a fully eligible campaign', () => {
    const r = evaluateCampaignAvailability(
      { ...baseInput, capPerMember: 3 },
      { memberTotal: 2, memberMonthly: 1, total: 40 },
      jordan(2026, 11, 5, 15, 0),
    )
    expect(r.available).toBe(true)
  })
  it('checks the plan gate before caps', () => {
    const r = evaluateCampaignAvailability(
      { ...baseInput, membershipTypes: 'yearly', capPerMember: 1 },
      { memberTotal: 5, memberMonthly: 5, total: 5 },
      jordan(2026, 11, 5),
    )
    expect(r.reason).toBe('CAMPAIGN_PLAN_NOT_ELIGIBLE')
  })
})

describe('campaignValueText', () => {
  it('formats discount percents', () => {
    expect(campaignValueText('DISCOUNT', { discountPercent: 15 })).toBe('15%')
    expect(campaignValueText('DISCOUNT', { discountPercent: '25' })).toBe('25%')
  })
  it('formats priced bundles in JOD', () => {
    expect(campaignValueText('BUNDLE_PRICE', { comboPrice: 3.5, comboItems: 'Coffee + pastry' })).toBe('3.5 JOD')
    expect(campaignValueText('BUNDLE_PRICE', { introPrice: 2 })).toBe('2 JOD')
  })
  it('uses the configured benefit label for free items', () => {
    expect(campaignValueText('FREE_ITEM', { benefitValue: 'Free selected drink' })).toBe('Free selected drink')
    expect(campaignValueText('FREE_ITEM', { perkLabel: 'Free refill' })).toBe('Free refill')
    expect(campaignValueText('FREE_ITEM', { rewardLabel: 'Free pastry' })).toBe('Free pastry')
    expect(campaignValueText('FREE_ITEM', { treatLabel: 'Free slice of cake' })).toBe('Free slice of cake')
  })
  it('falls back to a string field or the benefit type', () => {
    expect(campaignValueText('UPGRADE', { windowNote: 'Afternoon 12:00-17:00' })).toBe('Afternoon 12:00-17:00')
    expect(campaignValueText('EXPERIENCE', {})).toBe('experience')
  })
})

describe('jordanStartOfMonth', () => {
  it('returns the real UTC instant of Jordan midnight on the 1st', () => {
    const s = jordanStartOfMonth(jordan(2026, 11, 5, 10, 0))
    // Jordan is UTC+3: midnight on Nov 1 in Jordan = Nov 1, 21:00 UTC of Oct 31
    expect(s.toISOString()).toBe('2026-10-31T21:00:00.000Z')
  })
})
