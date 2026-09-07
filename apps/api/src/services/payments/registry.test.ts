/**
 * Gate B4 Stage 3 — provider registry tests. Pure/unit-level: plain `Env`
 * objects, no Worker runtime, no DB.
 *
 * Run:  node --test src/services/payments/registry.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEV_APP_ENV, type Env } from '../../env'
import {
  getConfiguredPaymentProvider,
  resolveConfiguredProvider,
  resolveProviderByCode,
} from './registry'
import { TEST_PROVIDER_CODE } from './test-provider'

// §44.A — no PAYMENT_PROVIDER configured
test('no provider configured -> not configured, not operational', () => {
  const env: Env = { APP_ENV: DEV_APP_ENV }
  const { provider, readiness } = resolveConfiguredProvider(env)
  assert.equal(provider, null)
  assert.equal(readiness.configured, false)
  assert.equal(readiness.operational, false)
  assert.deepEqual(readiness.blockers, ['payment_provider_not_configured'])
})

// §44.B — development + TEST provider configured
test('development + PAYMENT_PROVIDER=test -> configured and operational', () => {
  const env: Env = { APP_ENV: DEV_APP_ENV, PAYMENT_PROVIDER: TEST_PROVIDER_CODE }
  const { provider, readiness } = resolveConfiguredProvider(env)
  assert.notEqual(provider, null)
  assert.equal(provider?.code, TEST_PROVIDER_CODE)
  assert.equal(readiness.configured, true)
  assert.equal(readiness.operational, true)
  assert.deepEqual(readiness.blockers, [])
})

// §44.C / §25 / §48 — production-mode + TEST provider is a hard rejection
test('production-mode + PAYMENT_PROVIDER=test -> rejected, no provider instance', () => {
  const env: Env = { APP_ENV: 'production', PAYMENT_PROVIDER: TEST_PROVIDER_CODE }
  const { provider, readiness } = resolveConfiguredProvider(env)
  assert.equal(provider, null, 'registry must never return a usable TEST provider in production')
  assert.equal(readiness.configured, true)
  assert.equal(readiness.operational, false)
  assert.deepEqual(readiness.blockers, ['payment_provider_not_allowed'])
})

test('unset APP_ENV (typical production deploy) + PAYMENT_PROVIDER=test -> rejected (fail-closed)', () => {
  const env: Env = { PAYMENT_PROVIDER: TEST_PROVIDER_CODE }
  const { provider, readiness } = resolveConfiguredProvider(env)
  assert.equal(provider, null)
  assert.deepEqual(readiness.blockers, ['payment_provider_not_allowed'])
})

test('getConfiguredPaymentProvider mirrors resolveConfiguredProvider.provider', () => {
  const env: Env = { APP_ENV: 'production', PAYMENT_PROVIDER: TEST_PROVIDER_CODE }
  assert.equal(getConfiguredPaymentProvider(env), null)
})

// §44.D — unknown provider code
test('unknown provider code -> not ready, no fallback to test', () => {
  const env: Env = { APP_ENV: DEV_APP_ENV, PAYMENT_PROVIDER: 'some-real-gateway' }
  const { provider, readiness } = resolveConfiguredProvider(env)
  assert.equal(provider, null)
  assert.equal(readiness.configured, true)
  assert.equal(readiness.operational, false)
  assert.equal(readiness.providerCode, 'some-real-gateway')
  assert.deepEqual(readiness.blockers, ['payment_provider_unavailable'])
})

// §4 — historical provider resolution: existing attempts use their
// snapshotted payments.provider code, independent of the CURRENTLY
// configured provider.
test('§4 resolveProviderByCode resolves the historical code even if a different provider is now configured', () => {
  const env: Env = { APP_ENV: DEV_APP_ENV, PAYMENT_PROVIDER: 'some-future-real-gateway' }
  const { provider } = resolveProviderByCode(TEST_PROVIDER_CODE, env)
  assert.notEqual(provider, null)
  assert.equal(provider?.code, TEST_PROVIDER_CODE)
})

test('§4 resolveProviderByCode: historical provider unavailable stays unavailable, never falls back to the currently configured one', () => {
  const env: Env = { APP_ENV: DEV_APP_ENV, PAYMENT_PROVIDER: TEST_PROVIDER_CODE }
  const { provider, readiness } = resolveProviderByCode('a-retired-gateway', env)
  assert.equal(provider, null)
  assert.deepEqual(readiness.blockers, ['payment_provider_unavailable'])
})

test('§4 resolveProviderByCode: TEST provider still impossible outside development for historical lookups', () => {
  const env: Env = { APP_ENV: 'production' }
  const { provider, readiness } = resolveProviderByCode(TEST_PROVIDER_CODE, env)
  assert.equal(provider, null)
  assert.deepEqual(readiness.blockers, ['payment_provider_not_allowed'])
})

test('§48 mandatory: no code path yields a usable TEST provider in production, even with webhook secret set', () => {
  const env: Env = {
    APP_ENV: 'production',
    PAYMENT_PROVIDER: TEST_PROVIDER_CODE,
    TEST_PAYMENT_WEBHOOK_SECRET: 'leaked-secret-should-not-matter',
  }
  const { provider } = resolveConfiguredProvider(env)
  assert.equal(provider, null)
  // createPayment is provably unreachable: there is no provider object to call it on.
})
