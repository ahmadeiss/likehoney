import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dockUnits, isProductDetailRoute, shouldShowCartDock } from './cart-dock'

test('cart dock is hidden only where the cart/checkout is the stage itself', () => {
  assert.equal(shouldShowCartDock('/'), true)
  assert.equal(shouldShowCartDock('/shop'), true)
  assert.equal(shouldShowCartDock('/shop?category=toy'), true)
  assert.equal(shouldShowCartDock('/shop/product/11111111-1111-4111-8111-111111111111'), true)
  assert.equal(shouldShowCartDock('/shop/review'), true)

  assert.equal(shouldShowCartDock('/shop/cart'), false)
  assert.equal(shouldShowCartDock('/shop/checkout'), false)
  assert.equal(shouldShowCartDock('/shop/checkout/success'), false)
})

test('product detail detection drives the PDP sticky-bar offset only', () => {
  assert.equal(isProductDetailRoute('/shop/product/11111111-1111-4111-8111-111111111111'), true)
  assert.equal(isProductDetailRoute('/shop'), false)
  assert.equal(isProductDetailRoute('/shop/cart'), false)
})

test('dock units word agrees with the count (singular vs plural)', () => {
  assert.equal(dockUnits(1, 'قطعة', 'قطع'), 'قطعة')
  assert.equal(dockUnits(2, 'قطعة', 'قطع'), 'قطع')
  assert.equal(dockUnits(1, 'item', 'items'), 'item')
  assert.equal(dockUnits(7, 'item', 'items'), 'items')
})
