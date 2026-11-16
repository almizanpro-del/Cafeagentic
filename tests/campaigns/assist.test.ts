/**
 * Unit tests for the Campaign Studio Engine Three copy-assist guards.
 * Pure-function tests — no database, no network, no API key required.
 * Run: npx vitest run
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeDigits,
  verifyNoInventedNumbers,
  clipSuggestion,
  parseSuggestionReply,
  buildAssistMessages,
} from '../../src/lib/campaigns/assist'

describe('normalizeDigits', () => {
  it('maps Arabic-Indic digits to ASCII', () => {
    expect(normalizeDigits('خصم ٥٠٪')).toBe('خصم 50٪')
    expect(normalizeDigits('٪١٥')).toBe('٪15')
  })

  it('maps extended (Persian) digits too', () => {
    expect(normalizeDigits('۵۰')).toBe('50')
  })

  it('leaves ASCII digits and letters untouched', () => {
    expect(normalizeDigits('Buy 1 get 1 free')).toBe('Buy 1 get 1 free')
  })
})

describe('verifyNoInventedNumbers', () => {
  const sources = [
    'Welcome Drink — a free selected drink on your first visit',
    'Discount percentage: 15',
    'Valid for 7 days',
  ]

  it('accepts a suggestion that reuses only existing numbers', () => {
    expect(verifyNoInventedNumbers('Enjoy a free selected drink — 15% off your first order', sources)).toBe(true)
  })

  it('accepts a suggestion with no numbers at all', () => {
    expect(verifyNoInventedNumbers('A warm welcome awaits at your favourite table', sources)).toBe(true)
  })

  it('rejects an invented percentage', () => {
    expect(verifyNoInventedNumbers('Get 50% off everything today', sources)).toBe(false)
  })

  it('rejects an invented date even inside prose', () => {
    expect(verifyNoInventedNumbers('Offer valid until 2027 — hurry!', sources)).toBe(false)
  })

  it('normalises Arabic-Indic digits before comparing', () => {
    // ٥٠ → 50 is NOT among the allowed sources → must be rejected.
    expect(verifyNoInventedNumbers('خصم ٥٠٪ على كل شيء', sources)).toBe(false)
    // ١٥ → 15 IS among the allowed sources → accepted.
    expect(verifyNoInventedNumbers('خصم ١٥٪ لأول زيارة', sources)).toBe(true)
  })

  it('treats a multi-digit sequence as one token (15 is allowed, 150 is not)', () => {
    expect(verifyNoInventedNumbers('Save 150 JOD', sources)).toBe(false)
  })

  it('with no allowed sources, only number-free text passes', () => {
    expect(verifyNoInventedNumbers('No numbers here', [])).toBe(true)
    expect(verifyNoInventedNumbers('Buy 2 get 1', [])).toBe(false)
  })

  it('accepts numbers sourced from the café config values', () => {
    expect(verifyNoInventedNumbers('Combo meal for 3.5 JOD', ['Combo price: 3.5'])).toBe(true)
  })
})

describe('clipSuggestion', () => {
  it('passes through copy within the caps', () => {
    const out = clipSuggestion({ title: 'Morning welcome', description: 'A free drink with your first visit.' })
    expect(out).toEqual({ title: 'Morning welcome', description: 'A free drink with your first visit.', titleAr: '', descriptionAr: '' })
  })

  it('clips an oversized title to 120 chars (with ellipsis)', () => {
    const out = clipSuggestion({ title: 'a'.repeat(300) })
    expect(out.title.length).toBe(120)
    expect(out.title.endsWith('…')).toBe(true)
  })

  it('clips an oversized description to 600 chars', () => {
    const out = clipSuggestion({ description: 'ب'.repeat(1000) })
    expect(out.description.length).toBe(600)
  })

  it('coerces non-string values to empty strings', () => {
    const out = clipSuggestion({ title: 42, description: null })
    expect(out.title).toBe('')
    expect(out.description).toBe('')
  })
})

describe('parseSuggestionReply', () => {
  it('parses a strict JSON reply with all four keys', () => {
    const raw = JSON.stringify({ title: 'Welcome treat', titleAr: 'ترحيب', description: 'Free drink', descriptionAr: 'مشروب مجاني' })
    expect(parseSuggestionReply(raw)).toEqual({
      title: 'Welcome treat',
      titleAr: 'ترحيب',
      description: 'Free drink',
      descriptionAr: 'مشروب مجاني',
    })
  })

  it('tolerates a ```json fence around the JSON', () => {
    const raw = '```json\n{"title":"Hi"}\n```'
    expect(parseSuggestionReply(raw)).toEqual({ title: 'Hi' })
  })

  it('keeps only non-empty string values', () => {
    const raw = JSON.stringify({ title: 'Hi', description: '   ', titleAr: 5 })
    expect(parseSuggestionReply(raw)).toEqual({ title: 'Hi' })
  })

  it('returns null for prose, arrays, numbers and broken JSON', () => {
    expect(parseSuggestionReply('Here is your copy: {"title":"Hi"}')).toBeNull()
    expect(parseSuggestionReply('["title"]')).toBeNull()
    expect(parseSuggestionReply('42')).toBeNull()
    expect(parseSuggestionReply('{"title":')).toBeNull()
    expect(parseSuggestionReply('')).toBeNull()
  })
})

describe('buildAssistMessages', () => {
  const base = {
    templateName: 'Welcome Drink',
    templateNameAr: 'مشروب الترحيب',
    templateDescription: 'A free selected drink on the first visit.',
    templateDescriptionAr: 'مشروب مجاني عند أول زيارة.',
    fields: [{ label: 'Discount %', labelAr: 'نسبة الخصم', value: '15' }],
  }

  it('states the truthfulness contract in the system message', () => {
    const { system } = buildAssistMessages(base)
    expect(system).toContain('Never invent numbers')
    expect(system).toContain('strict JSON')
  })

  it('carries only approved wording + configured values in the user message', () => {
    const { user } = buildAssistMessages(base)
    expect(user).toContain('Welcome Drink')
    expect(user).toContain('مشروب الترحيب')
    expect(user).toContain('Discount %: 15 | نسبة الخصم')
  })

  it('includes the owner hints only when provided', () => {
    const without = buildAssistMessages(base)
    const withHints = buildAssistMessages({ ...base, ownerHint: 'Cozy autumn vibe', ownerHintAr: 'إحساس الخريف' })
    expect(without.user).not.toContain('preferred title direction')
    expect(withHints.user).toContain('Cozy autumn vibe')
    expect(withHints.user).toContain('إحساس الخريف')
  })

  it('says there are no configured values when the list is empty', () => {
    const { user } = buildAssistMessages({ ...base, fields: [] })
    expect(user).toContain('No configured values.')
  })
})
