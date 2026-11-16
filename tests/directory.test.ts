import { describe, it, expect } from 'vitest'
import {
  DIRECTORY_CAFES, DIRECTORY_SLUGS, GUIDE_CITIES, GUIDE_VIBES,
  directoryBySlug, mapsUrlFor, cityLabel, vibeLabel,
} from '../src/lib/directory'

describe('directory dataset', () => {
  it('has exactly 54 cafés across the three cities', () => {
    expect(DIRECTORY_CAFES.length).toBe(54)
    const byCity = { amman: 0, irbid: 0, aqaba: 0 }
    for (const c of DIRECTORY_CAFES) byCity[c.city]++
    expect(byCity.amman).toBe(30)
    expect(byCity.irbid).toBe(11)
    expect(byCity.aqaba).toBe(13)
  })

  it('has unique, URL-safe slugs', () => {
    const slugs = DIRECTORY_CAFES.map((c) => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('every listing is complete and bilingual', () => {
    for (const c of DIRECTORY_CAFES) {
      expect(c.name.trim().length).toBeGreaterThan(1)
      expect(c.blurb.trim().length).toBeGreaterThan(20)
      expect(c.blurbAr.trim().length).toBeGreaterThan(20)
      expect(GUIDE_CITIES.some((x) => x.key === c.city)).toBe(true)
      expect(c.vibes.length).toBeGreaterThan(0)
      for (const v of c.vibes) expect(GUIDE_VIBES.some((x) => x.key === v)).toBe(true)
    }
  })

  it('never references Google-copied content — links only', () => {
    for (const c of DIRECTORY_CAFES) {
      expect(c.blurb.toLowerCase()).not.toContain('google')
      expect(c.blurbAr).not.toContain('جوجل مابس')
    }
  })

  it('mapsUrlFor builds public Google Maps search links', () => {
    const url = mapsUrlFor(DIRECTORY_CAFES[0])
    expect(url.startsWith('https://www.google.com/maps/search/?api=1&query=')).toBe(true)
    expect(decodeURIComponent(url)).toContain(DIRECTORY_CAFES[0].name)
    expect(decodeURIComponent(url)).toContain('Jordan')
  })

  it('resolves lookups and labels in both locales', () => {
    expect(directoryBySlug('rumi-cafe')?.name).toBe('Rumi Café')
    expect(directoryBySlug('nope-nope')).toBeUndefined()
    expect(DIRECTORY_SLUGS.has('kava-aqaba')).toBe(true)
    expect(cityLabel('irbid', 'ar')).toBe('إربد')
    expect(vibeLabel('specialty', 'en')).toBe('Specialty coffee')
    expect(vibeLabel('view', 'ar')).toBe('إطلالات مميزة')
  })

  it('multi-location cafés get distinct slugs', () => {
    expect(DIRECTORY_SLUGS.has('dimitris-coffee-roasters')).toBe(true)
    expect(DIRECTORY_SLUGS.has('dimitris-coffee-aqaba')).toBe(true)
    expect(DIRECTORY_SLUGS.has('melange-abdoun')).toBe(true)
    expect(DIRECTORY_SLUGS.has('melange-aqaba')).toBe(true)
  })
})
