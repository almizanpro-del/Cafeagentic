/**
 * Unit tests for Campaign Studio governance rules (Phase 6) and the
 * Engine Three copy-assist guards. Pure-function tests — no database.
 * Run: npx vitest run
 */
import { describe, it, expect } from 'vitest'
import { resolveRuleValue, allowsOneMoreLiveCampaign, LIVE_CAMPAIGN_STATUSES } from '../../src/lib/campaigns/rules'
import { normalizeDigits, verifyNoInventedNumbers, clipSuggestion, parseSuggestionReply, buildAssistMessages } from '../../src/lib/campaigns/assist'

// ---------------------------------------------------------------- rules

const rule = (over: Partial<{ scope: string; marketId: string | null; family: string | null; key: string; valueJson: string }>) => ({
  scope: 'GLOBAL', marketId: null, family: null, key: 'maxActiveCampaignsPerCafe', valueJson: '3', ...over,
})

describe('resolveRuleValue', () => {
  it('returns the global value when nothing more specific matches', () => {
    const rows = [rule({ scope: 'GLOBAL', valueJson: '2' })]
    expect(resolveRuleValue(rows, 'maxActiveCampaignsPerCafe', { marketId: 'JO', family: 'BUNDLE' }, Infinity)).toBe(2)
  })

  it('prefers a market rule over the global one', () => {
    const rows = [rule({ scope: 'GLOBAL', valueJson: '2' }), rule({ scope: 'MARKET', marketId: 'JO', valueJson: '5' })]
    expect(resolveRuleValue(rows, 'maxActiveCampaignsPerCafe', { marketId: 'JO', family: 'BUNDLE' }, Infinity)).toBe(5)
    expect(resolveRuleValue(rows, 'maxActiveCampaignsPerCafe', { marketId: 'AE', family: 'BUNDLE' }, Infinity)).toBe(2)
  })

  it('prefers a family rule over market and global', () => {
    const rows = [
      rule({ scope: 'GLOBAL', valueJson: '2' }),
      rule({ scope: 'MARKET', marketId: 'JO', valueJson: '5' }),
      rule({ scope: 'FAMILY', family: 'SEASONAL', valueJson: '1' }),
    ]
    expect(resolveRuleValue(rows, 'maxActiveCampaignsPerCafe', { marketId: 'JO', family: 'SEASONAL' }, Infinity)).toBe(1)
    expect(resolveRuleValue(rows, 'maxActiveCampaignsPerCafe', { marketId: 'JO', family: 'WELCOME' }, Infinity)).toBe(5)
  })

  it('ignores rows with a different key', () => {
    const rows = [rule({ key: 'someOtherRule', valueJson: '9' })]
    expect(resolveRuleValue(rows, 'maxActiveCampaignsPerCafe', { marketId: 'JO', family: 'BUNDLE' }, Infinity)).toBe(Infinity)
  })

  it('falls back when valueJson is unparsable', () => {
    const rows = [rule({ scope: 'GLOBAL', valueJson: 'not-json' })]
    expect(resolveRuleValue(rows, 'maxActiveCampaignsPerCafe', {}, Infinity)).toBe(Infinity)
  })

  it('falls back when no row matches the context', () => {
    const rows = [rule({ scope: 'MARKET', marketId: 'AE', valueJson: '4' })]
    expect(resolveRuleValue(rows, 'maxActiveCampaignsPerCafe', { marketId: 'JO' }, Infinity)).toBe(Infinity)
  })

  it('returns the fallback for an empty rule set', () => {
    expect(resolveRuleValue([], 'maxActiveCampaignsPerCafe', { marketId: 'JO' }, 7)).toBe(7)
  })
})

describe('allowsOneMoreLiveCampaign', () => {
  it('blocks when the live count already reached the maximum', () => {
    expect(allowsOneMoreLiveCampaign(3, 3)).toBe(false)
    expect(allowsOneMoreLiveCampaign(5, 3)).toBe(false)
  })

  it('allows when under the maximum', () => {
    expect(allowsOneMoreLiveCampaign(2, 3)).toBe(true)
    expect(allowsOneMoreLiveCampaign(0, 1)).toBe(true)
  })

  it('always allows when no rule is configured (non-finite max)', () => {
    expect(allowsOneMoreLiveCampaign(50, Infinity)).toBe(true)
  })
})

describe('LIVE_CAMPAIGN_STATUSES', () => {
  it('counts scheduled, active and paused as live commitments', () => {
    expect(LIVE_CAMPAIGN_STATUSES).toEqual(['SCHEDULED', 'ACTIVE', 'PAUSED'])
  })
})

// ---------------------------------------------------------------- assist guards

describe('normalizeDigits', () => {
  it('maps Arabic-Indic digits to ASCII', () => {
    expect(normalizeDigits('خصم ٢٥٪')).toBe('خصم 25٪')
    expect(normalizeDigits('٣ مشروبات')).toBe('3 مشروبات')
  })

  it('maps extended Persian digits too', () => {
    expect(normalizeDigits('۵۰')).toBe('50')
  })

  it('leaves ASCII text untouched', () => {
    expect(normalizeDigits('Buy 2 get 1')).toBe('Buy 2 get 1')
  })
})

describe('verifyNoInventedNumbers', () => {
  const sources = ['Happy Hour: 25% off coffee', 'deal: buy 2 get 1', 'promo ٣ مشروبات']

  it('accepts copy whose numbers all come from the sources', () => {
    expect(verifyNoInventedNumbers('Enjoy 25% off — buy 2 get 1!', sources)).toBe(true)
  })

  it('accepts copy with no numbers at all', () => {
    expect(verifyNoInventedNumbers('A warm welcome awaits', sources)).toBe(true)
  })

  it('rejects invented numbers', () => {
    expect(verifyNoInventedNumbers('Enjoy 50% off your coffee', sources)).toBe(false)
    expect(verifyNoInventedNumbers('Only 10 JD today', sources)).toBe(false)
  })

  it('accepts Arabic-Indic digits that match ASCII sources', () => {
    expect(verifyNoInventedNumbers('عرض ٢٥٪ على القهوة', sources)).toBe(true)
  })

  it('rejects any number when the sources contain none', () => {
    expect(verifyNoInventedNumbers('Welcome offer', ['no digits here'])).toBe(true)
    expect(verifyNoInventedNumbers('Welcome 25 offer', ['no digits here'])).toBe(false)
  })
})

describe('clipSuggestion', () => {
  it('clips titles to 120 and descriptions to 600 characters', () => {
    const out = clipSuggestion({ title: 'x'.repeat(300), description: 'y'.repeat(900) })
    expect(out.title.length).toBe(120)
    expect(out.description.length).toBe(600)
  })

  it('coerces non-strings to empty strings', () => {
    const out = clipSuggestion({ title: 42, description: null })
    expect(out.title).toBe('')
    expect(out.description).toBe('')
  })

  it('keeps short strings intact', () => {
    const out = clipSuggestion({ title: 'Short', titleAr: 'قصير' })
    expect(out.title).toBe('Short')
    expect(out.titleAr).toBe('قصير')
  })
})

describe('parseSuggestionReply', () => {
  it('parses a strict JSON reply', () => {
    const out = parseSuggestionReply('{"title":"Hi","titleAr":"مرحبا"}')
    expect(out).toEqual({ title: 'Hi', titleAr: 'مرحبا' })
  })

  it('parses a fenced JSON reply', () => {
    const out = parseSuggestionReply('```json\n{"title":"Hi"}\n```')
    expect(out).toEqual({ title: 'Hi' })
  })

  it('returns null for prose or broken JSON', () => {
    expect(parseSuggestionReply('Here is your copy: title Hi')).toBeNull()
    expect(parseSuggestionReply('{"title":')).toBeNull()
    expect(parseSuggestionReply('[1,2,3]')).toBeNull()
  })

  it('drops non-string and empty values', () => {
    const out = parseSuggestionReply('{"title":123,"description":"","titleAr":"س"}')
    expect(out).toEqual({ titleAr: 'س' })
  })
})

describe('buildAssistMessages', () => {
  it('includes the truthfulness contract and both template wordings', () => {
    const { system, user } = buildAssistMessages({
      templateName: 'Happy Hour',
      templateNameAr: 'ساعة السعادة',
      templateDescription: 'Discount during quiet hours',
      templateDescriptionAr: 'خصم في الساعات الهادئة',
      fields: [{ label: 'Discount percent', labelAr: 'نسبة الخصم', value: '25' }],
    })
    expect(system).toContain('Never invent numbers')
    expect(user).toContain('Happy Hour')
    expect(user).toContain('ساعة السعادة')
    expect(user).toContain('Discount percent: 25')
  })

  it('handles a template with no configured fields', () => {
    const { user } = buildAssistMessages({
      templateName: 'Welcome', templateNameAr: 'ترحيب',
      templateDescription: 'd', templateDescriptionAr: 'ع',
      fields: [],
    })
    expect(user).toContain('No configured values.')
  })
})
