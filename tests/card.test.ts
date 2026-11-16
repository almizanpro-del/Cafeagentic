/**
 * Member card tests — the pure field surface of src/lib/card.ts.
 *
 * The card PNG itself is composed on a browser canvas (device fonts render
 * Arabic names correctly — a serverless font stack can't be trusted), so
 * what's testable without a browser is exactly what must be right: the
 * masked serial that ships on a screenshot-able card, the filename, the
 * bilingual share caption, the validity line, and a layout whose
 * proportions match a real CR80 membership card.
 */
import { describe, it, expect } from 'vitest'
import {
  CARD_LAYOUT,
  maskedSerial,
  cardFilename,
  cardShareText,
  formatValidUntil,
} from '../src/lib/card'

describe('maskedSerial (the only token hint a screenshot may carry)', () => {
  it('shows only the last four characters, uppercased', () => {
    expect(maskedSerial('a83fge91x7k2')).toBe('CP-•••-X7K2')
    expect(maskedSerial('tok-ab12')).toBe('CP-•••-AB12')
  })

  it('falls back to dots when the tail is not a clean 4-char alphanumeric run', () => {
    expect(maskedSerial('abc')).toBe('CP-•••-····') // too short
    expect(maskedSerial('token with spaces!!')).toBe('CP-•••-····')
  })
})

describe('cardFilename', () => {
  it('is sortable and zero-padded', () => {
    expect(cardFilename(new Date('2026-11-04T10:20:00Z'))).toBe('cafepass-card-2026-11-04.png')
    expect(cardFilename(new Date('2026-03-05T10:20:00Z'))).toMatch(/cafepass-card-2026-03-05\.png/)
  })
})

describe('cardShareText (bilingual caption)', () => {
  it('gives both languages a caption that says what the card is for', () => {
    expect(cardShareText('en')).toMatch(/CafePass/i)
    expect(cardShareText('en')).toMatch(/counter/i)
    expect(cardShareText('ar')).toMatch(/CafePass/)
    expect(cardShareText('ar')).toMatch(/الكاشير/)
  })
})

describe('formatValidUntil', () => {
  it('labels the validity line in English', () => {
    expect(formatValidUntil('2027-03-03T00:00:00Z', 'en')).toMatch(/^Valid until 3 Mar 2027$/)
  })

  it('labels the validity line in Arabic with ar-JO formatting (Arabic-Indic digits)', () => {
    const line = formatValidUntil('2027-03-03T00:00:00Z', 'ar')
    expect(line).toContain('صالحة حتى')
    expect(line).toContain('٢٠٢٧') // ar-JO renders the year in Arabic-Indic digits
    expect(line).not.toMatch(/Invalid/i)
  })

  it('answers an invalid date with an empty string, never "Invalid Date"', () => {
    expect(formatValidUntil('not-a-date', 'en')).toBe('')
  })
})

describe('CARD_LAYOUT (CR80 landscape geometry)', () => {
  it('matches a physical membership card ratio (85.6 × 54 mm ≈ 1.585)', () => {
    const ratio = CARD_LAYOUT.width / CARD_LAYOUT.height
    expect(ratio).toBeGreaterThan(1.55)
    expect(ratio).toBeLessThan(1.62)
  })

  it('keeps padding and radius inside the canvas', () => {
    expect(CARD_LAYOUT.padding * 2).toBeLessThan(CARD_LAYOUT.width)
    expect(CARD_LAYOUT.radius * 2).toBeLessThan(CARD_LAYOUT.height)
  })

  it('carries the full brand palette as hex colors', () => {
    for (const [name, value] of Object.entries(CARD_LAYOUT.colors)) {
      expect(value, `color ${name}`).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
