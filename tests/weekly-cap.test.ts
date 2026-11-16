import { describe, it, expect } from 'vitest'
import { jordanWeekStart, jordanWeekRange, weeklyCapVerdict } from '../src/lib/week'

/**
 * Jordan week window: Sunday 00:00 Amman → next Sunday 00:00 Amman, i.e.
 * UTC instants [Sat 21:00Z, next Sat 21:00Z) — Jordan is UTC+3 year-round.
 * Anchors verified against Intl with timeZone 'Asia/Amman':
 *   2026-11-07T21:00:00Z → Sunday 2026-11-08 00:00 in Amman
 *   2026-11-14T20:59:59Z → Saturday 2026-11-14 in Amman
 *   2026-11-14T21:00:00Z → Sunday 2026-11-15 00:00 in Amman
 *   2026-12-26T21:00:00Z → Sunday 2026-12-27 00:00 in Amman
 */
const AMMAN = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Amman', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
})

function jordanLabel(d: Date): string {
  const parts = AMMAN.formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('weekday')} ${get('year')}-${get('month')}-${get('day')} ${get('hour')}:00`
}

describe('jordanWeekRange (Sunday → Saturday, Jordan time)', () => {
  it('starts the week at Sunday midnight Amman and ends exactly 7 days later', () => {
    const { start, end } = jordanWeekRange(new Date('2026-11-09T10:00:00Z')) // Monday 13:00 Amman
    expect(start.toISOString()).toBe('2026-11-07T21:00:00.000Z')
    expect(end.toISOString()).toBe('2026-11-14T21:00:00.000Z')
    expect(end.getTime() - start.getTime()).toBe(7 * 86_400_000)
    expect(jordanLabel(start)).toContain('Sunday')
  })

  it('keeps Saturday 23:59:59 Amman inside the running week', () => {
    const { start, end } = jordanWeekRange(new Date('2026-11-14T20:59:59Z'))
    expect(start.toISOString()).toBe('2026-11-07T21:00:00.000Z')
    expect(end.toISOString()).toBe('2026-11-14T21:00:00.000Z')
  })

  it('rolls over at Sunday 00:00 Amman into a new week', () => {
    const { start, end } = jordanWeekRange(new Date('2026-11-14T21:00:00.000Z'))
    expect(start.toISOString()).toBe('2026-11-14T21:00:00.000Z')
    expect(end.toISOString()).toBe('2026-11-21T21:00:00.000Z')
  })

  it('every day of the week resolves to the same window', () => {
    const days = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']
    const starts = days.map((d) => jordanWeekStart(new Date(`${d}T09:30:00Z`)).toISOString())
    expect(new Set(starts).size).toBe(1)
    expect(starts[0]).toBe('2026-11-07T21:00:00.000Z')
  })

  it('survives the month boundary (Oct 29–31 → Nov 1 2026)', () => {
    // Thu 2026-10-29, Fri 10-30 and Sat 10-31 all sit in the week that starts
    // Sunday 2026-10-25 Amman (= 2026-10-24T21:00Z); Sunday 2026-11-01 opens a
    // NEW week (= 2026-10-31T21:00Z) even though the month changed mid-week.
    expect(jordanWeekStart(new Date('2026-10-29T12:00:00Z')).toISOString()).toBe('2026-10-24T21:00:00.000Z')
    expect(jordanWeekStart(new Date('2026-10-30T12:00:00Z')).toISOString()).toBe('2026-10-24T21:00:00.000Z')
    expect(jordanWeekStart(new Date('2026-10-31T12:00:00Z')).toISOString()).toBe('2026-10-24T21:00:00.000Z')
    expect(jordanWeekStart(new Date('2026-11-01T12:00:00Z')).toISOString()).toBe('2026-10-31T21:00:00.000Z')
  })

  it('survives the year boundary (Dec 2026 → Jan 2027)', () => {
    // Week containing Thu 2026-12-31 and Fri 2027-01-01 starts Sunday 2026-12-27 Amman
    const { start, end } = jordanWeekRange(new Date('2027-01-01T10:00:00Z'))
    expect(start.toISOString()).toBe('2026-12-26T21:00:00.000Z')
    expect(end.toISOString()).toBe('2027-01-02T21:00:00.000Z')
    expect(jordanLabel(new Date('2026-12-31T15:00:00Z'))).toContain('2026-12-31') // 18:00 Amman, still Dec 31
    // Dec 31 stays in the same week as Jan 1
    expect(jordanWeekStart(new Date('2026-12-31T23:00:00Z')).toISOString()).toBe('2026-12-26T21:00:00.000Z')
  })

  it('survives the Feb→Mar boundary (Sat Feb 28 2026 → Sun Mar 1 2026)', () => {
    expect(jordanWeekStart(new Date('2026-02-28T12:00:00Z')).toISOString()).toBe('2026-02-21T21:00:00.000Z')
    expect(jordanWeekStart(new Date('2026-03-01T12:00:00Z')).toISOString()).toBe('2026-02-28T21:00:00.000Z')
  })

  it('property: for a full year of daily samples the window is 7 days, Sunday-anchored, and contains the sample', () => {
    const base = new Date('2026-01-01T08:00:00Z').getTime()
    for (let i = 0; i < 365; i += 7) {
      const sample = new Date(base + i * 86_400_000)
      const { start, end } = jordanWeekRange(sample)
      expect(end.getTime() - start.getTime()).toBe(7 * 86_400_000)
      // start + 3h is midnight Amman of a Sunday
      const startJordan = new Date(start.getTime() + 3 * 3_600_000)
      expect(startJordan.getUTCDay()).toBe(0) // Sunday
      expect(startJordan.toISOString().endsWith('T00:00:00.000Z')).toBe(true)
      expect(sample.getTime() >= start.getTime() && sample.getTime() < end.getTime()).toBe(true)
    }
  })
})

describe('weeklyCapVerdict (empty = no limit, cap counts ALL members)', () => {
  it('treats null, undefined and 0 as no cap', () => {
    expect(weeklyCapVerdict(null, 0)).toBe('NO_CAP')
    expect(weeklyCapVerdict(undefined, 5)).toBe('NO_CAP')
    expect(weeklyCapVerdict(0, 999)).toBe('NO_CAP')
  })

  it('blocks at the cap and above, allows below it', () => {
    expect(weeklyCapVerdict(10, 0)).toBe('OK')
    expect(weeklyCapVerdict(10, 9)).toBe('OK')
    expect(weeklyCapVerdict(10, 10)).toBe('WEEKLY_LIMIT_REACHED')
    expect(weeklyCapVerdict(10, 25)).toBe('WEEKLY_LIMIT_REACHED')
  })

  it('a cap of 1 means exactly one redemption this week', () => {
    expect(weeklyCapVerdict(1, 0)).toBe('OK')
    expect(weeklyCapVerdict(1, 1)).toBe('WEEKLY_LIMIT_REACHED')
  })
})
