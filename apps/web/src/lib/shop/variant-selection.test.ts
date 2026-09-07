/**
 * Regression tests for the ONE canonical option-selection algorithm shared by
 * Product Detail and the Quick Option Sheet. Pure logic, no DOM, no network —
 * a synthetic two-option (Color × Size) fixture shaped like the real Kids
 * Sport Shoes dev fixture used for live verification, but addressed only by
 * option/value ids (never English names — see directive §20).
 *
 * Run:  node --import tsx --test src/lib/shop/variant-selection.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isValueReachable,
  pruneIncompatibleSelection,
  resolveExactVariant,
  type OptionSelection,
  type SelectableVariant,
} from './variant-selection'

const COLOR = 'opt-color'
const SIZE = 'opt-size'
const optionIds = [COLOR, SIZE]

const BLACK = 'val-black'
const WHITE = 'val-white'
const S28 = 'val-28'
const S29 = 'val-29'
const S30 = 'val-30'
const S31 = 'val-31'

interface Fixture extends SelectableVariant {
  quantityOnHand: number
}

const black28: Fixture = { id: 'v-black-28', optionValueIds: [BLACK, S28], quantityOnHand: 3 }
const black29: Fixture = { id: 'v-black-29', optionValueIds: [BLACK, S29], quantityOnHand: 1 }
// Active but zero stock — an OFFERED combination, distinct from "not offered".
const black30: Fixture = { id: 'v-black-30', optionValueIds: [BLACK, S30], quantityOnHand: 0 }
const white28: Fixture = { id: 'v-white-28', optionValueIds: [WHITE, S28], quantityOnHand: 5 }
const white29: Fixture = { id: 'v-white-29', optionValueIds: [WHITE, S29], quantityOnHand: 2 }
// White/30 deliberately absent — mirrors an inactive/draft combination the
// public API never returns; "not in this array" IS "not offered".
// Size 31 added post-creation (§7 example): only Black/31 activated so far —
// White/31 deliberately absent, same "not offered" meaning as White/30.
const black31: Fixture = { id: 'v-black-31', optionValueIds: [BLACK, S31], quantityOnHand: 4 }

const variants: Fixture[] = [black28, black29, black30, white28, white29, black31]

test('White selected -> Size 30 is unreachable (no White/30 combination is offered)', () => {
  const selection: OptionSelection = { [COLOR]: WHITE }
  assert.equal(isValueReachable(variants, optionIds, SIZE, S30, selection), false)
})

test('Black selected -> Size 30 is structurally reachable (Black/30 is offered, even at zero stock)', () => {
  const selection: OptionSelection = { [COLOR]: BLACK }
  assert.equal(isValueReachable(variants, optionIds, SIZE, S30, selection), true)
})

test('Black + 30 resolves the exact active, zero-stock variant', () => {
  const selection: OptionSelection = { [COLOR]: BLACK, [SIZE]: S30 }
  const resolved = resolveExactVariant(optionIds, variants, selection)
  assert.equal(resolved?.id, black30.id)
  assert.equal(resolved?.quantityOnHand, 0)
})

test('Black + 30 -> switch to White: White is selectable, 30 is pruned, and White/30 stays unavailable', () => {
  const initial: OptionSelection = { [COLOR]: BLACK, [SIZE]: S30 }
  // Color is the earlier option group — it must always stay reachable so the
  // shopper can change their mind, even with an edge value already selected.
  assert.equal(isValueReachable(variants, optionIds, COLOR, WHITE, initial), true)

  const afterSwitch = pruneIncompatibleSelection(variants, optionIds, {
    ...initial,
    [COLOR]: WHITE,
  })
  assert.deepEqual(afterSwitch, { [COLOR]: WHITE })
  assert.equal(SIZE in afterSwitch, false)

  // And 30 is still correctly disabled for White — never silently re-offered.
  assert.equal(isValueReachable(variants, optionIds, SIZE, S30, afterSwitch), false)
})

test('White + 29 -> switch to Black: 29 survives (Black/29 is offered)', () => {
  const initial: OptionSelection = { [COLOR]: WHITE, [SIZE]: S29 }
  const afterSwitch = pruneIncompatibleSelection(variants, optionIds, {
    ...initial,
    [COLOR]: BLACK,
  })
  assert.deepEqual(afterSwitch, { [COLOR]: BLACK, [SIZE]: S29 })
})

test('Black + 29 resolves the exact Black/29 variant', () => {
  const selection: OptionSelection = { [COLOR]: BLACK, [SIZE]: S29 }
  assert.equal(resolveExactVariant(optionIds, variants, selection)?.id, black29.id)
})

test('White + 29 resolves the exact White/29 variant (distinct from Black/29)', () => {
  const selection: OptionSelection = { [COLOR]: WHITE, [SIZE]: S29 }
  const resolved = resolveExactVariant(optionIds, variants, selection)
  assert.equal(resolved?.id, white29.id)
  assert.notEqual(resolved?.id, black29.id)
})

test('after adding Size 31 and activating only Black/31: Black -> 31 available, White -> 31 unavailable', () => {
  assert.equal(isValueReachable(variants, optionIds, SIZE, S31, { [COLOR]: BLACK }), true)
  assert.equal(isValueReachable(variants, optionIds, SIZE, S31, { [COLOR]: WHITE }), false)

  const resolved = resolveExactVariant(optionIds, variants, { [COLOR]: BLACK, [SIZE]: S31 })
  assert.equal(resolved?.id, black31.id)
  assert.equal(resolveExactVariant(optionIds, variants, { [COLOR]: WHITE, [SIZE]: S31 }), undefined)
})
