import test from 'node:test'
import assert from 'node:assert/strict'

import {
  validateProductionTarget,
  resolveConnectionTarget,
  isSameConnectionTarget,
} from './lib/connection-target.mjs'

const DEV_URL =
  'postgres://devuser:devpass@ep-dev-123.us-east-2.aws.neon.tech/likehoneydb?sslmode=require'

test('production URL with database pathname /likehoneydb is ACCEPTED', () => {
  const prod =
    'postgresql://owner:s3cret@ep-prod-999.eu-west-1.aws.neon.tech/likehoneydb?sslmode=require'
  const res = validateProductionTarget(prod, { devUrlValue: DEV_URL })
  assert.equal(res.ok, true)
})

test('production URL on a DIFFERENT Neon endpoint with the same db name is ACCEPTED', () => {
  const prod = 'postgres://owner:s3cret@ep-other-777.ap-southeast-1.aws.neon.tech/likehoneydb'
  const res = validateProductionTarget(prod, { devUrlValue: DEV_URL })
  assert.equal(res.ok, true)
})

test('an exact known development connection is REJECTED', () => {
  const res = validateProductionTarget(DEV_URL, { devUrlValue: DEV_URL })
  assert.equal(res.ok, false)
})

test('postgres and postgresql schemes with the SAME endpoint resolve to the same target (REJECTED)', () => {
  const prod = 'postgresql://devuser:devpass@ep-dev-123.us-east-2.aws.neon.tech/likehoneydb'
  const res = validateProductionTarget(prod, { devUrlValue: DEV_URL })
  assert.equal(res.ok, false)
})

test('localhost is REJECTED', () => {
  const res = validateProductionTarget('postgres://u:p@localhost:5432/likehoney', {
    devUrlValue: DEV_URL,
  })
  assert.equal(res.ok, false)
})

test('127.0.0.1 is REJECTED', () => {
  const res = validateProductionTarget('postgres://u:p@127.0.0.1:5432/likehoney', {
    devUrlValue: DEV_URL,
  })
  assert.equal(res.ok, false)
})

test('IPv6 loopback is REJECTED', () => {
  const res = validateProductionTarget('postgres://u:p@[::1]:5432/likehoney', {
    devUrlValue: DEV_URL,
  })
  assert.equal(res.ok, false)
})

test('an invalid PRODUCTION_DATABASE_URL is REJECTED', () => {
  const res = validateProductionTarget('not-a-url', { devUrlValue: DEV_URL })
  assert.equal(res.ok, false)
})

test('resolveConnectionTarget normalizes scheme/port and excludes credentials', () => {
  const a = resolveConnectionTarget('postgres://u:p@Ep-Dev-123.us-east-2.aws.neon.tech/likehoneydb')
  const b = resolveConnectionTarget(
    'postgresql://different:pw@ep-dev-123.us-east-2.aws.neon.tech:5432/likehoneydb',
  )
  assert.equal(a.scheme, 'postgresql')
  assert.equal(a.host, 'ep-dev-123.us-east-2.aws.neon.tech')
  assert.equal(a.port, 5432)
  assert.equal(a.database, 'likehoneydb')
  assert.equal(isSameConnectionTarget(a, b), true)
})

test('a different database on the SAME Neon endpoint is a different target (ACCEPTED)', () => {
  const prod = 'postgres://devuser:devpass@ep-dev-123.us-east-2.aws.neon.tech/productiondb'
  const res = validateProductionTarget(prod, { devUrlValue: DEV_URL })
  assert.equal(res.ok, true)
})
