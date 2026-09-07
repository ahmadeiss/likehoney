/**
 * Gate B4 Stage 3 — payment settings service tests against the real
 * b4-development Neon branch (not a mock). Captures and restores the three
 * protected setting rows around the run — including true absence (a raw
 * DELETE; `store_settings` carries no immutability guard, unlike
 * orders/payments/reservations).
 *
 * Run:  node --import tsx --test src/services/payments/settings.test.ts
 * Requires: packages/db/.env pointed at b4-development (db:runtime-check OK).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_RESERVATION_RECONCILE_MINUTES,
  NoPaymentMethodEnabledError,
  PaymentInfrastructureNotReadyError,
  PaymentProviderNotAllowedError,
  PaymentProviderNotConfiguredError,
} from '@likehoney/shared'
import { deleteSetting, getDb, getSetting, upsertSetting } from '@likehoney/db'

import { DEV_APP_ENV, type Env } from '../../env'
import {
  getPaymentSettingsReadModelService,
  getPaymentSettingsService,
  updatePaymentSettingsService,
} from './settings'
import { TEST_PROVIDER_CODE } from './test-provider'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(HERE, '..', '..', '..', '..', '..', 'packages/db/.env')
const dbUrl = fs
  .readFileSync(envPath, 'utf8')
  .match(/^DATABASE_URL=(.+)$/m)?.[1]
  ?.trim()
if (!dbUrl) throw new Error('settings.test.ts: packages/db/.env DATABASE_URL not found')
if (!/ep-snowy-block/.test(dbUrl)) {
  throw new Error('settings.test.ts REFUSES to run against a non-b4-development database')
}
const db = getDb(dbUrl)

const PROTECTED_KEYS = [
  'checkout:cod.enabled',
  'payments:electronic.enabled',
  'payments:reservation.reconcile_after_minutes',
] as const

const actor = { actorType: 'system' as const }

async function snapshot(): Promise<Map<string, string>> {
  const all = new Map<string, string>()
  for (const key of PROTECTED_KEYS) {
    const row = await getSetting(db, key)
    if (row !== undefined) all.set(key, row.valueJson)
  }
  return all
}

async function restore(before: Map<string, string>): Promise<void> {
  for (const key of PROTECTED_KEYS) {
    const priorValue = before.get(key)
    if (priorValue === undefined) {
      await deleteSetting(db, key)
    } else {
      await upsertSetting(db, key, priorValue)
    }
  }
}

const devTestEnv: Env = { APP_ENV: DEV_APP_ENV, PAYMENT_PROVIDER: TEST_PROVIDER_CODE }
const noProviderEnv: Env = { APP_ENV: DEV_APP_ENV }

// §30 defaults ---------------------------------------------------------------

test('absent settings use safe code defaults (electronic=false, reconcile=20min)', async () => {
  const before = await snapshot()
  try {
    for (const key of [
      'payments:electronic.enabled',
      'payments:reservation.reconcile_after_minutes',
    ] as const) {
      await deleteSetting(db, key)
    }
    const settings = await getPaymentSettingsService(db)
    assert.equal(settings.electronicEnabled, false)
    assert.equal(settings.reservationReconcileAfterMinutes, DEFAULT_RESERVATION_RECONCILE_MINUTES)

    // reading defaults must not persist them
    const row = await getSetting(db, 'payments:electronic.enabled')
    assert.equal(row, undefined, 'reading an absent setting must not write a row')
  } finally {
    await restore(before)
  }
})

// §44.A — no provider configured -----------------------------------------

test('§44.A no PAYMENT_PROVIDER: enabling electronic is rejected payment_provider_not_configured', async () => {
  const before = await snapshot()
  try {
    await assert.rejects(
      () => updatePaymentSettingsService(db, noProviderEnv, { electronicEnabled: true }, actor),
      PaymentProviderNotConfiguredError,
    )
    const settings = await getPaymentSettingsService(db)
    assert.equal(settings.electronicEnabled, false, 'rejected write must not persist')
  } finally {
    await restore(before)
  }
})

// §44.B — TEST provider configured, Stage-4 infrastructure now ships -------

test('§44.B dev + TEST provider configured: infrastructure ready by default post-Stage-4, electronic CAN be enabled', async () => {
  const before = await snapshot()
  try {
    const result = await updatePaymentSettingsService(
      db,
      devTestEnv,
      { electronicEnabled: true },
      actor,
    )
    assert.equal(result.electronic.enabled, true)
    assert.equal(result.electronic.available, true)
    assert.deepEqual(result.electronic.blockers, [])
  } finally {
    await restore(before)
  }
})

test('§78 infrastructureReady override can still simulate a future regression', async () => {
  const before = await snapshot()
  try {
    await assert.rejects(
      () =>
        updatePaymentSettingsService(db, devTestEnv, { electronicEnabled: true }, actor, {
          infrastructureReady: false,
        }),
      PaymentInfrastructureNotReadyError,
    )
  } finally {
    await restore(before)
  }
})

// §44.C — production + TEST provider ---------------------------------------

test('§44.C production-mode + TEST provider: rejected payment_provider_not_allowed', async () => {
  const before = await snapshot()
  try {
    const prodEnv: Env = { APP_ENV: 'production', PAYMENT_PROVIDER: TEST_PROVIDER_CODE }
    await assert.rejects(
      () =>
        updatePaymentSettingsService(db, prodEnv, { electronicEnabled: true }, actor, {
          infrastructureReady: true, // even with infra "ready", prod must still refuse the TEST provider
        }),
      PaymentProviderNotAllowedError,
    )
  } finally {
    await restore(before)
  }
})

// §45 — future-ready injected settings test (never enabled in normal runtime)

test('§45 future-ready: with provider+infra readiness injected, electronic CAN become enabled', async () => {
  const before = await snapshot()
  try {
    const result = await updatePaymentSettingsService(
      db,
      devTestEnv,
      { electronicEnabled: true },
      actor,
      { infrastructureReady: true },
    )
    assert.equal(result.electronic.enabled, true)
    assert.equal(result.electronic.available, true)
    assert.deepEqual(result.electronic.blockers, [])
  } finally {
    await restore(before)
  }
})

test('§45 COD may then be disabled while electronic remains available', async () => {
  const before = await snapshot()
  try {
    await updatePaymentSettingsService(db, devTestEnv, { electronicEnabled: true }, actor, {
      infrastructureReady: true,
    })
    const result = await updatePaymentSettingsService(
      db,
      devTestEnv,
      { codEnabled: false },
      actor,
      { infrastructureReady: true },
    )
    assert.equal(result.cod.enabled, false)
    assert.equal(result.electronic.enabled, true)
    assert.equal(result.electronic.available, true)
  } finally {
    await restore(before)
  }
})

// §33 — no-zero-payment-method invariant ------------------------------------

test('§33 disabling COD in normal Stage-3 runtime (electronic never available) is rejected no_payment_method_enabled', async () => {
  const before = await snapshot()
  try {
    await assert.rejects(
      () => updatePaymentSettingsService(db, noProviderEnv, { codEnabled: false }, actor),
      NoPaymentMethodEnabledError,
    )
    const settings = await getPaymentSettingsService(db)
    assert.equal(settings.codEnabled, true, 'COD must remain enabled after the rejected write')
  } finally {
    await restore(before)
  }
})

test('§45 attempting to disable BOTH (even with electronic future-ready) is rejected no_payment_method_enabled', async () => {
  const before = await snapshot()
  try {
    await updatePaymentSettingsService(db, devTestEnv, { electronicEnabled: true }, actor, {
      infrastructureReady: true,
    })
    await assert.rejects(
      () =>
        updatePaymentSettingsService(
          db,
          devTestEnv,
          { codEnabled: false, electronicEnabled: false },
          actor,
          {
            infrastructureReady: true,
          },
        ),
      NoPaymentMethodEnabledError,
    )
  } finally {
    await restore(before)
  }
})

// §34 — atomic multi-key update, never a partial write ----------------------

test('§34 a rejected multi-field update leaves no partial write', async () => {
  const before = await snapshot()
  try {
    const startCod = await getPaymentSettingsService(db)
    await assert.rejects(
      () =>
        updatePaymentSettingsService(
          db,
          noProviderEnv,
          { codEnabled: false, electronicEnabled: true },
          actor,
        ),
      PaymentProviderNotConfiguredError,
    )
    const after = await getPaymentSettingsService(db)
    assert.equal(after.codEnabled, startCod.codEnabled, 'codEnabled must be unchanged')
    assert.equal(after.electronicEnabled, false)
  } finally {
    await restore(before)
  }
})

// §37 read model shape -------------------------------------------------

test('§37 read model exposes configured preference AND actual availability, no secrets', async () => {
  const model = await getPaymentSettingsReadModelService(db, noProviderEnv)
  assert.equal(typeof model.cod.enabled, 'boolean')
  assert.equal(typeof model.cod.available, 'boolean')
  assert.equal(typeof model.electronic.enabled, 'boolean')
  assert.equal(typeof model.electronic.available, 'boolean')
  assert.equal(typeof model.electronic.configured, 'boolean')
  assert.ok(Array.isArray(model.electronic.blockers))
  assert.equal(typeof model.reservationReconcileAfterMinutes, 'number')
  const json = JSON.stringify(model)
  assert.doesNotMatch(json, /secret/i)
  assert.doesNotMatch(json, /TEST_PAYMENT/)
})

// §26/§78 normal Stage-4 runtime: infra ready, but the SETTING defaults off -

test('§26/§78 normal runtime: infra blocker gone, but electronic stays unavailable until an Admin enables it', async () => {
  const before = await snapshot()
  try {
    await deleteSetting(db, 'payments:electronic.enabled') // ensure true absence -> default false
    const model = await getPaymentSettingsReadModelService(db, devTestEnv)
    assert.equal(model.electronic.enabled, false, 'default setting stays false (§30 unchanged)')
    assert.equal(
      model.electronic.available,
      false,
      'unavailable because the setting is off, not infra',
    )
    assert.deepEqual(
      model.electronic.blockers,
      [],
      'no operational blockers — provider configured, infra ready',
    )
  } finally {
    await restore(before)
  }
})

test('§80 production stays unavailable: infra ready ≠ a real provider selected', async () => {
  const prodEnv: Env = { APP_ENV: 'production' }
  const model = await getPaymentSettingsReadModelService(db, prodEnv)
  assert.equal(model.electronic.available, false)
  assert.ok(model.electronic.blockers.includes('payment_provider_not_configured'))
})
