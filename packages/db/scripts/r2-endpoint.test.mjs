import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveR2Host, validateR2Config, R2_ENDPOINT_SUFFIX } from './lib/r2-endpoint.mjs'

const ACCOUNT_ID = '77b859059ea00d59cb87601928865b20'

test('a bare R2_ACCOUNT_ID resolves to the canonical R2 S3 endpoint host', () => {
  assert.equal(resolveR2Host({ accountId: ACCOUNT_ID }), `${ACCOUNT_ID}${R2_ENDPOINT_SUFFIX}`)
  assert.equal(
    resolveR2Host({ accountId: `   ${ACCOUNT_ID}  ` }),
    `${ACCOUNT_ID}${R2_ENDPOINT_SUFFIX}`,
  )
})

test('the raw account id is never produced as a hostname', () => {
  const host = resolveR2Host({ accountId: ACCOUNT_ID })
  assert.notEqual(host, ACCOUNT_ID)
  assert.match(host, /\.r2\.cloudflarestorage\.com$/)
})

test('empty account id fails closed', () => {
  assert.throws(() => resolveR2Host({ accountId: '' }), /R2_ACCOUNT_ID is required/)
  assert.throws(() => resolveR2Host({ accountId: undefined }), /R2_ACCOUNT_ID is required/)
  assert.throws(() => resolveR2Host({}), /R2_ACCOUNT_ID is required/)
})

test('a bare account id is rejected as R2_ENDPOINT (must be a full https URL)', () => {
  assert.throws(() => resolveR2Host({ accountId: ACCOUNT_ID, endpoint: ACCOUNT_ID }), /R2_ENDPOINT/)
  assert.throws(
    () => resolveR2Host({ accountId: ACCOUNT_ID, endpoint: '127.0.0.1' }),
    /https|parse/,
  )
})

test('non-https R2_ENDPOINT is rejected', () => {
  assert.throws(
    () =>
      resolveR2Host({
        accountId: ACCOUNT_ID,
        endpoint: `http://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      }),
    /must use https:\/\//,
  )
})

test('R2_ENDPOINT hostname must end with .r2.cloudflarestorage.com', () => {
  assert.throws(
    () => resolveR2Host({ accountId: ACCOUNT_ID, endpoint: `https://${ACCOUNT_ID}.example.com` }),
    /hostname must end with/,
  )
})

test('valid https R2_ENDPOINT override is accepted, including jurisdiction endpoints', () => {
  assert.equal(
    resolveR2Host({
      accountId: ACCOUNT_ID,
      endpoint: `https://${ACCOUNT_ID}.eu.r2.cloudflarestorage.com/`,
    }),
    `${ACCOUNT_ID}.eu.r2.cloudflarestorage.com`,
  )
  assert.equal(
    resolveR2Host({
      accountId: ACCOUNT_ID,
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    }),
    `${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  )
})

test('R2_ENDPOINT must start with the configured account id', () => {
  assert.throws(
    () =>
      resolveR2Host({
        accountId: ACCOUNT_ID,
        endpoint: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
      }),
    /must begin with the configured R2_ACCOUNT_ID/,
  )
})

test('R2_ENDPOINT with a path is rejected', () => {
  assert.throws(
    () =>
      resolveR2Host({
        accountId: ACCOUNT_ID,
        endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/extra`,
      }),
    /must not include a path/,
  )
})

test('validateR2Config never throws and reports reasons safely', () => {
  const good = validateR2Config({ accountId: ACCOUNT_ID })
  assert.equal(good.ok, true)
  assert.equal(good.host, `${ACCOUNT_ID}.r2.cloudflarestorage.com`)

  const bad = validateR2Config({ accountId: ACCOUNT_ID, endpoint: ACCOUNT_ID })
  assert.equal(bad.ok, false)
  assert.match(bad.reason, /R2_ENDPOINT/)
  assert.ok(!bad.reason.includes(ACCOUNT_ID))
})
