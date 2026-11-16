/**
 * Sample launch-content regression tests (trust rule).
 *
 * The fictional launch-preview cafés exist to show visitors how the product
 * looks before real partners onboard. Three invariants must always hold:
 *
 * 1. The seed list and the SAMPLE_CAFE_SLUGS set (the single source of truth
 *    for "Sample" labelling everywhere) stay in sync.
 * 2. Every sample listing and perk is fully bilingual — an Arabic visitor must
 *    never see an English-only demo café.
 * 3. The scanner rejection for sample cafés has a user-facing bilingual label,
 *    so a blocked scan explains itself instead of showing a raw code.
 */
import { describe, it, expect } from 'vitest'
import { SAMPLE_CAFES, SAMPLE_PERKS, SAMPLE_CAFE_SLUGS } from '../src/lib/launch-content'
import { dict } from '../src/lib/i18n'
import {
  GALLERY_POOL, COFFEE, DRINKS, TEA, FOOD, DESSERTS, menuFor, GALLERY_DIR, DISH_DIR,
} from '../src/lib/mockup-content'
import { MENU_CATEGORIES } from '../src/lib/menu'
import * as fs from 'fs'
import * as path from 'path'

describe('sample launch content stays in sync and honest', () => {
  it('SAMPLE_CAFE_SLUGS is exactly the set of seeded sample slugs', () => {
    expect(SAMPLE_CAFES.length).toBeGreaterThan(0)
    expect(new Set(SAMPLE_CAFES.map((c) => c.slug)).size).toBe(SAMPLE_CAFES.length) // slugs unique
    expect(SAMPLE_CAFE_SLUGS.size).toBe(SAMPLE_CAFES.length)
    for (const c of SAMPLE_CAFES) expect(SAMPLE_CAFE_SLUGS.has(c.slug)).toBe(true)
  })

  it('every sample café and perk is fully bilingual (no English-only demo content)', () => {
    for (const c of SAMPLE_CAFES) {
      expect(c.name.length).toBeGreaterThan(0)
      expect(c.nameAr.length).toBeGreaterThan(0)
      expect(c.desc.length).toBeGreaterThan(0)
      expect(c.descAr.length).toBeGreaterThan(0)
      expect(c.hoodAr.length).toBeGreaterThan(0)
    }
    for (const p of SAMPLE_PERKS) {
      expect(p.t.length).toBeGreaterThan(0)
      expect(p.tAr.length).toBeGreaterThan(0)
      expect(p.d.length).toBeGreaterThan(0)
      expect(p.dAr.length).toBeGreaterThan(0)
    }
  })

  it('every seeded perk belongs to a seeded sample café (no orphan perk rows)', () => {
    for (const p of SAMPLE_PERKS) {
      expect(SAMPLE_CAFE_SLUGS.has(p.cafe), `perk "${p.t}" references unknown café "${p.cafe}"`).toBe(true)
    }
  })

  it('the sample-café scan rejection has a bilingual user-facing label', () => {
    const label = dict['reason.SAMPLE_CAFE']
    expect(label).toBeDefined()
    expect(label.en).toContain('Sample')
    expect(label.ar.length).toBeGreaterThan(0)
  })
})

describe('mockup media pools (gallery photos + demo menus)', () => {
  it('the gallery pool covers 4 unique photos per sample café', () => {
    expect(GALLERY_POOL.length).toBeGreaterThanOrEqual(SAMPLE_CAFES.length * 4)
    expect(new Set(GALLERY_POOL.map((p) => p.file)).size).toBe(GALLERY_POOL.length)
  })

  it('every pool image exists on disk and is a real file (the loader reads them at runtime)', () => {
    for (const p of GALLERY_POOL) {
      expect(() => fs.statSync(path.join(GALLERY_DIR, p.file)), p.file).not.toThrow()
      expect(fs.statSync(path.join(GALLERY_DIR, p.file)).size).toBeGreaterThan(5000)
    }
    for (const d of [...COFFEE, ...DRINKS, ...TEA, ...FOOD, ...DESSERTS]) {
      expect(() => fs.statSync(path.join(DISH_DIR, d.file)), d.file).not.toThrow()
      expect(fs.statSync(path.join(DISH_DIR, d.file)).size).toBeGreaterThan(3000)
    }
  })

  it('menuFor gives every café a valid 7-item bilingual menu in known categories', () => {
    const categoryIds = MENU_CATEGORIES.map((c) => c.id)
    for (let i = 0; i < SAMPLE_CAFES.length; i++) {
      const menu = menuFor(i)
      expect(menu).toHaveLength(7)
      for (const d of menu) {
        expect(categoryIds).toContain(d.category)
        expect(d.name.length).toBeGreaterThan(0)
        expect(d.nameAr.length).toBeGreaterThan(0)
        expect(d.descriptionAr.length).toBeGreaterThan(0)
        expect(d.price).toBeGreaterThan(0)
      }
    }
  })

  it('gallery captions are bilingual', () => {
    for (const p of GALLERY_POOL) {
      expect(p.caption.length).toBeGreaterThan(0)
      expect(p.captionAr.length).toBeGreaterThan(0)
    }
  })
})
