/**
 * CSS guard for the category display-image stage.
 *
 * The storefront hexagon must keep its hand-crafted frame visible while a
 * category image fills it without distortion. These assertions read the real
 * `hive.css` shipped to the storefront (never a copy) and pin the contract:
 * the stage is a rounded, overflow-clipped inset square and the image fills it
 * with `cover` + centered crop. A refactor that reintroduces `contain` (→
 * letterboxing) or drops the clipping would fail here before it ships.
 *
 * Run:  node --import tsx --test src/lib/shop/category-media-css.test.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { resolve } from 'node:path'

const HIVE_CSS = resolve('src/app/(store)/styles/hive.css')

test('storefront hive.css ships the category-image stage rules', () => {
  const css = readFileSync(HIVE_CSS, 'utf8')

  const stageBlock = blockFor(css, '.lh .lh-cat-card__image')
  assert.ok(stageBlock, '.lh .lh-cat-card__image rule must exist')
  assert.match(stageBlock, /position:\s*absolute/, 'stage is positioned inside the hexagon')
  assert.match(stageBlock, /overflow:\s*hidden/, 'stage clips the image to its rounded mask')
  assert.match(stageBlock, /border-radius:\s*\d+px/, 'stage has a rounded mask')

  const imageBlock = blockFor(css, '.lh .lh-cat-card__image-img')
  assert.ok(imageBlock, '.lh .lh-cat-card__image-img rule must exist')
  assert.match(imageBlock, /object-fit:\s*cover/, 'image covers the stage (never letterboxed)')
  assert.match(imageBlock, /object-position:\s*center/, 'image is center-cropped')
})

/** Returns the first declaration block matching `selector`, or null. */
function blockFor(css: string, selector: string): string | null {
  const escaped = selector.replace(/\./g, '\\.').replace(/\s/g, '\\s+')
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)
  return match ? match[1]! : null
}
