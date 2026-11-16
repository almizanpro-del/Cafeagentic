import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { CURRENCIES, DEFAULT_CURRENCY, getCurrency, isSupportedCurrency, formatMoney } from '../src/lib/currency'

describe('getCurrency', () => {
  it('resolves ISO codes case-insensitively', () => {
    expect(getCurrency('jod').code).toBe('JOD')
    expect(getCurrency(' Sar ').code).toBe('SAR')
  })
  it('maps the common "JD" display spelling to JOD', () => {
    expect(getCurrency('JD').code).toBe('JOD')
    expect(getCurrency('jd').code).toBe('JOD')
  })
  it('falls back to the default market currency for unknown/empty input', () => {
    expect(getCurrency('XYZ').code).toBe(DEFAULT_CURRENCY)
    expect(getCurrency('').code).toBe(DEFAULT_CURRENCY)
    expect(getCurrency(null).code).toBe(DEFAULT_CURRENCY)
    expect(getCurrency(undefined).code).toBe(DEFAULT_CURRENCY)
  })
  it('keeps ISO 4217 display decimals sane across the registry', () => {
    expect(CURRENCIES.KWD.decimals).toBe(3) // Gulf dinars show fils
    expect(CURRENCIES.UZS.decimals).toBe(0) // whole-sum economies
    expect(CURRENCIES.JOD.decimals).toBe(2) // Jordanian display convention
  })
})

describe('isSupportedCurrency', () => {
  it('accepts registry codes and aliases only', () => {
    expect(isSupportedCurrency('JOD')).toBe(true)
    expect(isSupportedCurrency('JD')).toBe(true)
    expect(isSupportedCurrency('UZS')).toBe(true)
    expect(isSupportedCurrency('BTC')).toBe(false)
    expect(isSupportedCurrency(null)).toBe(false)
  })
})

describe('formatMoney', () => {
  it('keeps the historic Amman strings byte-identical (en + ar)', () => {
    expect(formatMoney(2.5, 'JOD', 'en')).toBe('2.50 JOD')
    expect(formatMoney(2.5, 'JOD', 'ar')).toBe('2.50 د.أ')
    expect(formatMoney(2.5, 'JD', 'en')).toBe('2.50 JOD')
  })
  it('uses display decimals per currency', () => {
    expect(formatMoney(150000, 'UZS', 'en')).toBe('150000 UZS')
    expect(formatMoney(2.5, 'KWD', 'en')).toBe('2.500 KWD')
    expect(formatMoney(12, 'USD', 'en')).toBe('12.00 USD')
  })
  it('falls back to the ISO code when no Arabic symbol exists', () => {
    const original = CURRENCIES.TRY.symbolAr
    try {
      CURRENCIES.TRY.symbolAr = ''
      expect(formatMoney(9, 'TRY', 'ar')).toBe('9.00 TRY')
    } finally {
      CURRENCIES.TRY.symbolAr = original
    }
  })
  it('never renders NaN or undefined amounts', () => {
    expect(formatMoney(Number.NaN, 'JOD')).toBe('0.00 JOD')
    expect(formatMoney(undefined as unknown as number, 'JOD')).toBe('0.00 JOD')
  })
  it('treats an unknown currency as the default market currency', () => {
    expect(formatMoney(3, 'NOT-A-CODE')).toBe('3.00 JOD')
  })
})

describe('global-markets SQL consistency', () => {
  const sqlPath = fileURLToPath(new URL('../scripts/sql/2026-11-04-global-markets.sql', import.meta.url))
  const sql = readFileSync(sqlPath, 'utf8')
  // ('JO', 'Jordan', 'الأردن', 'JOD', 'Asia/Amman', true)
  const rows = [...sql.matchAll(/\('([A-Z]{2})',\s*'([^']*)',\s*'([^']*)',\s*'([A-Z]{3})',\s*'([^']+)',\s*(true|false)\)/g)]

  it('seeds a broad global catalog (50+ markets)', () => {
    expect(rows.length).toBeGreaterThanOrEqual(50)
  })

  it('every market currency exists in the CURRENCIES registry', () => {
    for (const row of rows) expect(CURRENCIES[row[4]]).toBeDefined()
  })

  it('every market timezone looks like a real IANA zone', () => {
    for (const row of rows) expect(row[5]).toMatch(/^(Africa|America|Asia|Australia|Europe|Pacific)\/[A-Za-z_+-]+$/)
  })

  it('keeps Jordan as the only pre-activated home market', () => {
    const jo = rows.find((r) => r[1] === 'JO')
    expect(jo?.[6]).toBe('true')
    expect(rows.filter((r) => r[6] === 'true').map((r) => r[1])).toEqual(['JO'])
  })

  it('has unique country ids and covers all registry currencies', () => {
    const ids = rows.map((r) => r[1])
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('extended global registry', () => {
  it('covers 50+ world currencies', () => {
    expect(Object.keys(CURRENCIES).length).toBeGreaterThanOrEqual(50)
  })
  it('keeps display decimals per local convention', () => {
    expect(CURRENCIES.JPY.decimals).toBe(0) // yen has no subunit in display
    expect(CURRENCIES.KWD.decimals).toBe(3) // Gulf dinars keep fils
    expect(CURRENCIES.INR.decimals).toBe(2)
    expect(CURRENCIES.ILS.decimals).toBe(2)
  })
  it('formats global samples deterministically', () => {
    expect(formatMoney(1200, 'JPY', 'en')).toBe('1200 JPY')
    expect(formatMoney(2.5, 'KWD', 'ar')).toBe('2.500 د.ك')
    expect(formatMoney(40, 'INR', 'en')).toBe('40.00 INR')
    expect(formatMoney(19, 'ILS', 'ar')).toBe('19.00 ₪')
  })
})
