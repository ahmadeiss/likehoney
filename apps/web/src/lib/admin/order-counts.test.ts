import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatBadgeCount, shouldShowOrderBadge } from './order-counts'

test('badge count caps at 99+ so the pill geometry stays stable', () => {
  assert.equal(formatBadgeCount(0), '0')
  assert.equal(formatBadgeCount(1), '1')
  assert.equal(formatBadgeCount(9), '9')
  assert.equal(formatBadgeCount(99), '99')
  assert.equal(formatBadgeCount(100), '99+')
  assert.equal(formatBadgeCount(1200), '99+')
})

test('badge is hidden until the first successful read and at zero', () => {
  assert.equal(shouldShowOrderBadge({ ready: false, processing: 0 }), false)
  assert.equal(shouldShowOrderBadge({ ready: false, processing: 5 }), false)
  assert.equal(shouldShowOrderBadge({ ready: true, processing: 0 }), false)
  assert.equal(shouldShowOrderBadge({ ready: true, processing: 3 }), true)
})
