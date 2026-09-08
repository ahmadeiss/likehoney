import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeCart } from './cart'

const variantId = '11111111-1111-4111-8111-111111111111'

test('corrupt cart storage cannot send invalid quantities or identifiers to checkout', () => {
  assert.deepEqual(normalizeCart(null), [])
  assert.deepEqual(
    normalizeCart([
      null,
      {},
      { variantId: 'broken', quantity: 1 },
      ...[NaN, Infinity, -1, 0, '2'].map((quantity) => ({ variantId, quantity })),
    ]),
    [],
  )
})

test('cart combines duplicate variants and caps quantities', () => {
  assert.deepEqual(
    normalizeCart([
      { variantId, quantity: 2.9 },
      { variantId, quantity: 3 },
    ]),
    [{ variantId, quantity: 5 }],
  )
  assert.deepEqual(normalizeCart([{ variantId, quantity: 99999 }]), [{ variantId, quantity: 999 }])
})
