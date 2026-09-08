/**
 * Diagnostics tests for `describeDbFailure` — the safe, non-secret Postgres
 * error extractor used by the HTTP error handler and the reconciliation cron.
 *
 * It must (a) surface the SQLSTATE so schema drift (e.g. `42703` column /
 * `42P01` relation missing) is legible in server logs, (b) walk the Drizzle
 * `cause` chain, and (c) NEVER report a non-database error as a database
 * failure or read fields that can carry captured values (it reads only
 * `code`, `table`, `constraint` and the generic server `message`).
 *
 * Run:  node --import tsx --test src/http/errors.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeDbFailure } from './errors'

test('extracts a top-level Postgres error (42703 column does not exist)', () => {
  const diag = describeDbFailure({
    code: '42703',
    message: 'column product_variants.acquisition_cost_minor does not exist',
    table: 'product_variants',
  })
  assert.deepEqual(diag, {
    sqlstate: '42703',
    table: 'product_variants',
    constraint: null,
    message: 'column product_variants.acquisition_cost_minor does not exist',
  })
})

test('extracts a relation-missing error (42P01) with no message', () => {
  const diag = describeDbFailure({ code: '42P01', table: 'stock_reservations' })
  assert.deepEqual(diag, {
    sqlstate: '42P01',
    table: 'stock_reservations',
    constraint: null,
    message: 'SQLSTATE 42P01',
  })
})

test('walks the Drizzle cause chain (outer wrapper has no code, real error on .cause)', () => {
  const err = new Error('query failed', {
    cause: {
      code: '42703',
      message: 'column customers.status does not exist',
      table: 'customers',
    },
  })
  const diag = describeDbFailure(err)
  assert.equal(diag?.sqlstate, '42703')
  assert.equal(diag?.table, 'customers')
  assert.equal(diag?.constraint, null)
})

test('recognises the custom LH SQLSTATE guards (5-char uppercase code)', () => {
  const diag = describeDbFailure({
    code: 'LH003',
    message: 'payments: attempt to modify an immutable column',
    constraint: 'lh_payments_transition_guard',
  })
  assert.deepEqual(diag, {
    sqlstate: 'LH003',
    table: null,
    constraint: 'lh_payments_transition_guard',
    message: 'payments: attempt to modify an immutable column',
  })
})

test('returns null for a non-database error (no code)', () => {
  assert.equal(describeDbFailure(new Error('boom')), null)
})

test('returns null for a library/runtime error whose code is not an SQLSTATE', () => {
  assert.equal(describeDbFailure({ code: 'ECONNRESET', message: 'socket hang up' }), null)
})

test('returns null for a seed error without a 5-character code', () => {
  assert.equal(describeDbFailure({ code: 'ERR', message: 'short code' }), null)
})

test('returns null for primitives', () => {
  assert.equal(describeDbFailure(undefined), null)
  assert.equal(describeDbFailure(null), null)
  assert.equal(describeDbFailure('string'), null)
})

test('returns null when the cause chain never contains a database error', () => {
  const err = new Error('outer', { cause: new Error('inner', { cause: { code: 'X' } }) })
  assert.equal(describeDbFailure(err), null)
})

test('never reads driver `detail` (which can carry captured values)', () => {
  const diag = describeDbFailure({
    code: '23505',
    message: 'duplicate key value violates unique constraint "customers_phone_normalized_unique"',
    constraint: 'customers_phone_normalized_unique',
    detail: 'Key (phone_normalized)=(+970599000000) already exists.',
  })
  assert.equal(diag?.sqlstate, '23505')
  assert.equal(diag?.constraint, 'customers_phone_normalized_unique')
  assert.ok(
    !JSON.stringify(diag).includes('+970599000000'),
    'captured values must never reach the diagnostic payload',
  )
})
