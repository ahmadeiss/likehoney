/**
 * CSS guard for the admin category visual picker (icon-key feature).
 *
 * These assertions read the REAL `globals.css` shipped to the admin console
 * (never a copy) and pin the contract for the new picker controls: a
 * segmented image/icon/auto switch, a responsive curated icon grid with a
 * selected state, and the automatic-fallback panel. A refactor that drops a
 * rule, removes the logical (RTL-aware) properties, or reintroduces an
 * auto-fit column outside the mobile-friendly range fails here before it
 * ships.
 *
 * Run:  node --import tsx --test src/lib/admin/category-icon-css.test.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { resolve } from 'node:path'

const GLOBALS_CSS = resolve('src/app/globals.css')

test('globals.css ships the segmented visual-mode switch', () => {
  const css = readFileSync(GLOBALS_CSS, 'utf8')

  const container = blockFor(css, '.lh-segmented')
  assert.ok(container, '.lh-segmented rule must exist')
  assert.match(container, /display:\s*flex/, 'items are laid out in a row')
  assert.match(container, /border-radius/, 'segmented control has a rounded track')

  const item = blockFor(css, '.lh-segmented__item')
  assert.ok(item, '.lh-segmented__item rule must exist')
  assert.match(item, /cursor:\s*pointer/, 'segments are interactive buttons')

  const active = blockFor(css, '.lh-segmented__item.is-active')
  assert.ok(active, 'active segment is visually distinguishable')
  assert.match(active, /background|box-shadow|color/, 'active segment has a selection style')

  const focus = blockFor(css, '.lh-segmented__item:focus-visible')
  assert.ok(focus, 'keyboard focus is visible')
  assert.match(focus, /outline/, 'focus uses an outline')
})

test('globals.css ships the responsive curated icon grid', () => {
  const css = readFileSync(GLOBALS_CSS, 'utf8')

  const grid = blockFor(css, '.lh-icon-grid')
  assert.ok(grid, '.lh-icon-grid rule must exist')
  assert.match(grid, /display:\s*grid/, 'icons are laid out on an explicit grid')
  assert.match(
    grid,
    /repeat\(\s*auto-fill,\s*minmax\(\s*5\.5rem,\s*1fr\s*\)\s*\)/,
    'grid auto-fills compact tiles (mobile-friendly)',
  )
  assert.match(grid, /padding-inline-end/, 'scroll gutter uses a logical (RTL-aware) property')

  const option = blockFor(css, '.lh-icon-option')
  assert.ok(option, '.lh-icon-option rule must exist')
  assert.match(option, /cursor:\s*pointer/, 'options are interactive')
  assert.match(option, /flex-direction:\s*column/, 'icon sits above its label')

  const selected = blockFor(css, '.lh-icon-option.is-selected')
  assert.ok(selected, 'selected option is visually distinct')
  assert.match(selected, /honey/, 'selection uses the honey brand accent')

  const focus = blockFor(css, '.lh-icon-option:focus-visible')
  assert.ok(focus, 'keyboard focus is visible on options')
  assert.match(focus, /outline/, 'focus uses an outline')
})

test('globals.css ships the automatic-fallback panel', () => {
  const css = readFileSync(GLOBALS_CSS, 'utf8')
  const panel = blockFor(css, '.lh-auto-panel')
  assert.ok(panel, '.lh-auto-panel rule must exist')
  assert.match(panel, /flex-direction:\s*column/, 'panel stacks its content')
})

/** Returns the first declaration block matching `selector`, or null. */
function blockFor(css: string, selector: string): string | null {
  const escaped = selector.replace(/\./g, '\\.').replace(/\s/g, '\\s+')
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)
  return match ? match[1]! : null
}
