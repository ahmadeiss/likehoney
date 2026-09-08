import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseMoneyDraft } from './money-input'

test('money input preserves typing and converts minor units without truncation', () => {
  for (const [text, valueMinor] of [
    ['1.15', 115],
    ['0.29', 29],
    ['12.', 1200],
    ['.5', 50],
    ['', 0],
    ['.', 0],
  ] as const) {
    assert.deepEqual(parseMoneyDraft(text), { text, valueMinor })
  }
})

test('money input accepts Arabic digits and rejects malformed or unsafe amounts', () => {
  assert.deepEqual(parseMoneyDraft('١٢٫٣٤'), { text: '12.34', valueMinor: 1234 })
  assert.deepEqual(parseMoneyDraft('۱۲.۳۴'), { text: '12.34', valueMinor: 1234 })
  for (const text of ['1.234', '1.2.3', '-2', '1e5', 'Infinity', '999999999999999999']) {
    assert.equal(parseMoneyDraft(text), null)
  }
})
