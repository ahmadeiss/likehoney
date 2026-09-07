/**
 * Gate C — customer phone identity key.
 *
 * `normalizePhone` is the canonical form; `isValidNormalizedPhone` is the
 * gate that decides whether that form is safe to use as an automatic
 * IDENTITY-MATCH key (§6). Pure functions, no DB.
 *
 * Run:  node --test src/services/gate-c-phone-identity.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isValidNormalizedPhone, normalizePhone } from '@likehoney/shared'

test('§6 every real Palestinian input shape normalizes to the same 970 + 9-digit key', () => {
  const variants = [
    '0591234567',
    '059 123 4567',
    '059-123-4567',
    '+970591234567',
    '00970591234567',
    '970591234567',
    '591234567',
    ' 059 123 4567 ',
  ]
  const normalized = variants.map(normalizePhone)
  for (const n of normalized) {
    assert.equal(n, '970591234567', `expected 970591234567, got ${n}`)
    assert.equal(isValidNormalizedPhone(n), true)
  }
  // one canonical identity for every variant
  assert.equal(new Set(normalized).size, 1)
})

test('§6 two DIFFERENT phones never collapse to one key', () => {
  assert.notEqual(normalizePhone('0591234567'), normalizePhone('0599999999'))
})

test('§6 garbage / too-short input never passes the identity gate', () => {
  for (const bad of ['', 'abc', '12', '00', '05', '970', '97012']) {
    assert.equal(
      isValidNormalizedPhone(normalizePhone(bad)),
      false,
      `"${bad}" must not be a valid identity key`,
    )
  }
})

test('normalizePhone never throws, even on garbage (raw snapshot can still store it)', () => {
  assert.doesNotThrow(() => normalizePhone('!!!'))
  assert.equal(typeof normalizePhone('!!!'), 'string')
})
