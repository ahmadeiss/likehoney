/**
 * Category icon selection guard tests (shared two-tier registry + frontend
 * maps).
 *
 * The storefront renders an icon key by its exact name; a key without a
 * Lucide component would produce an empty card, so EVERY registered key MUST
 * resolve in the frontend map. These tests pin that invariant plus the
 * manual-key validation pipeline (which validates against the FULL registry —
 * Advanced may type a registry-only icon like `camera`), and the storefront
 * visual priority across the persisted display modes.
 *
 * Run:  node --import tsx --test src/lib/category-icons.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CATEGORY_ICON_KEYS,
  CATEGORY_ICON_REGISTRY,
  CATEGORY_VISUAL_MODES,
  isCategoryIconKey,
  isCategoryIconRegistryKey,
  normalizeCategoryIconKey,
  resolveCategoryIconKey,
} from '@likehoney/shared'

import { categoryIconComponent, resolveCategoryVisual } from './category-icons'

test('every registry key (curated + registry-only) resolves to a renderable component', () => {
  for (const key of CATEGORY_ICON_REGISTRY) {
    assert.ok(
      categoryIconComponent(key) !== undefined,
      `missing Lucide component for registered key "${key}"`,
    )
  }
  assert.ok(
    CATEGORY_ICON_REGISTRY.length > CATEGORY_ICON_KEYS.length,
    'registry must exceed curated',
  )
})

test('every curated key is a registry key', () => {
  for (const key of CATEGORY_ICON_KEYS) {
    assert.equal(isCategoryIconRegistryKey(key), true)
    assert.equal(isCategoryIconKey(key), true)
  }
})

test('unknown or absent keys resolve to undefined — never a crash or empty preview', () => {
  assert.equal(categoryIconComponent('shoe'), undefined)
  assert.equal(categoryIconComponent('not-an-icon'), undefined)
  assert.equal(categoryIconComponent(null), undefined)
  assert.equal(categoryIconComponent(''), undefined)
})

test('curated key succeeds through the normal validation pipeline', () => {
  assert.equal(resolveCategoryIconKey('shirt'), 'shirt')
  assert.equal(resolveCategoryIconKey('  toy-brick  '), 'toy-brick')
  assert.equal(isCategoryIconKey('shirt'), true)
})

test('a valid registry-only key succeeds through Advanced', () => {
  assert.equal(isCategoryIconRegistryKey('camera'), true)
  assert.equal(
    isCategoryIconKey('camera'),
    false,
    'registry-only must NOT appear in the curated grid',
  )
  assert.equal(resolveCategoryIconKey(' Camera '), 'camera', 'trim + lowercase + registry match')
  assert.equal(resolveCategoryIconKey('camera'), 'camera')
  assert.ok(
    categoryIconComponent('camera') !== undefined,
    'registry-only key must have a renderable component',
  )
})

test('unknown keys fail the Advanced pipeline (not in the registry)', () => {
  for (const value of ['shoe', 'teddy', 'dress', 'not-an-icon', 'camera-lens']) {
    assert.equal(resolveCategoryIconKey(value), null, JSON.stringify(value))
  }
  assert.equal(isCategoryIconRegistryKey('shoe'), false)
})

test('storefront renders a registry-only valid key (resolves to a component)', () => {
  const visual = resolveCategoryVisual({ imageUrl: null, iconKey: 'camera', visualMode: 'auto' })
  assert.equal(visual, 'icon')
  assert.ok(categoryIconComponent('camera') !== undefined)
})

test('manual key validation: unsafe or malformed input is refused', () => {
  for (const value of [
    '',
    '   ',
    null,
    undefined,
    'https://evil.example/x',
    '/etc/passwd',
    'shirt;pants',
    'shirt<script>',
    'a'.repeat(65),
  ]) {
    assert.equal(resolveCategoryIconKey(value), null, JSON.stringify(value))
    assert.equal(normalizeCategoryIconKey(value), null, JSON.stringify(value))
  }
})

test('auto mode: image beats icon beats fallback', () => {
  assert.equal(resolveCategoryVisual({ imageUrl: 'http://x/1.webp', iconKey: 'shirt' }), 'image')
  assert.equal(
    resolveCategoryVisual({ imageUrl: 'http://x/1.webp', iconKey: 'shirt', visualMode: 'auto' }),
    'image',
  )
  assert.equal(resolveCategoryVisual({ imageUrl: null, iconKey: 'shirt' }), 'icon')
  assert.equal(resolveCategoryVisual({ imageUrl: null, iconKey: 'camera' }), 'icon')
  assert.equal(resolveCategoryVisual({ imageUrl: null, iconKey: null, visualMode: 'auto' }), 'auto')
  assert.equal(resolveCategoryVisual({ imageUrl: null, iconKey: 'shoe' }), 'auto')
})

test('icon mode: the icon shows even when an image is stored (mode is not decorative)', () => {
  assert.equal(
    resolveCategoryVisual({ imageUrl: 'http://x/1.webp', iconKey: 'shirt', visualMode: 'icon' }),
    'icon',
  )
  assert.equal(
    resolveCategoryVisual({
      imageUrl: 'http://x/1.webp',
      iconKey: 'camera',
      visualMode: 'icon',
    }),
    'icon',
  )
  // No icon → automatic/code fallback (never the stored image).
  assert.equal(
    resolveCategoryVisual({ imageUrl: 'http://x/1.webp', iconKey: null, visualMode: 'icon' }),
    'auto',
  )
})

test('image mode: shows the image when present, otherwise a safe fallback', () => {
  assert.equal(
    resolveCategoryVisual({ imageUrl: 'http://x/1.webp', iconKey: 'shirt', visualMode: 'image' }),
    'image',
  )
  assert.equal(
    resolveCategoryVisual({ imageUrl: null, iconKey: 'shirt', visualMode: 'image' }),
    'icon',
  )
  assert.equal(
    resolveCategoryVisual({ imageUrl: null, iconKey: null, visualMode: 'image' }),
    'auto',
  )
})

test('only the three controlled visual modes are valid', () => {
  assert.deepEqual(CATEGORY_VISUAL_MODES, ['auto', 'image', 'icon'])
})

test('registered keys are canonical lowercase identifiers (storefront render invariant)', () => {
  for (const key of CATEGORY_ICON_REGISTRY) {
    assert.match(key, /^[a-z][a-z0-9-]{0,63}$/, `${key} is a plain ASCII identifier`)
    assert.equal(resolveCategoryIconKey(key), key)
  }
})
