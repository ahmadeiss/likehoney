/**
 * Gate B4 Stage 3 — canonical payment settings service.
 *
 * The ONLY writer of the three protected `store_settings` keys
 * (`checkout:cod.enabled`, `payments:electronic.enabled`,
 * `payments:reservation.reconcile_after_minutes`). The generic
 * `PUT /settings/:key` endpoint refuses them (see `services/settings.ts`).
 *
 * Enforces, atomically across keys in one transaction:
 *  - the electronic-enablement guard (§32) — `electronicEnabled: true` is
 *    rejected unless a provider is configured, allowed in this environment,
 *    operational, AND the (Stage-4, not-yet-built) infrastructure is ready;
 *  - the no-zero-payment-method invariant (§33) — a write may never leave
 *    both COD and electronic unavailable at checkout.
 */
import {
  DEFAULT_RESERVATION_RECONCILE_MINUTES,
  NoPaymentMethodEnabledError,
  PaymentInfrastructureNotReadyError,
  PaymentProviderNotAllowedError,
  PaymentProviderNotConfiguredError,
  PaymentProviderUnavailableError,
  type PaymentReadinessBlocker,
  type PaymentSettings,
  type PaymentSettingsReadModel,
  type PaymentSettingsUpdateInput,
} from '@likehoney/shared'
import { getSetting, upsertSetting, type DbClient } from '@likehoney/db'

import type { Env } from '../../env'
import { auditMeta, recordAudit, type AuditActor } from '../audit'
import { isCodEnabled } from '../orders'
import { getElectronicOperationalBlockers, type ElectronicReadinessOverrides } from './readiness'

const KEY_COD = 'checkout:cod.enabled' as const
const KEY_ELECTRONIC = 'payments:electronic.enabled' as const
const KEY_RECONCILE = 'payments:reservation.reconcile_after_minutes' as const

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Electronic absent ⇒ FALSE (§30) — never enabled merely because it was never set. */
async function readElectronicEnabled(db: DbClient): Promise<boolean> {
  const row = await getSetting(db, KEY_ELECTRONIC)
  if (row === undefined) return false
  const parsed = tryParseJson(row.valueJson) as { enabled?: unknown } | null
  return parsed?.enabled === true
}

/** Absent ⇒ the shared default (20 minutes). Never persisted merely because it was read. */
async function readReconcileMinutes(db: DbClient): Promise<number> {
  const row = await getSetting(db, KEY_RECONCILE)
  if (row === undefined) return DEFAULT_RESERVATION_RECONCILE_MINUTES
  const parsed = tryParseJson(row.valueJson) as { minutes?: unknown } | null
  return typeof parsed?.minutes === 'number'
    ? parsed.minutes
    : DEFAULT_RESERVATION_RECONCILE_MINUTES
}

/** Read the typed settings only — no readiness computation. */
export async function getPaymentSettingsService(db: DbClient): Promise<PaymentSettings> {
  const [codEnabled, electronicEnabled, reservationReconcileAfterMinutes] = await Promise.all([
    isCodEnabled(db),
    readElectronicEnabled(db),
    readReconcileMinutes(db),
  ])
  return { codEnabled, electronicEnabled, reservationReconcileAfterMinutes }
}

/** Map the first operational blocker to its stable `ServiceError`. */
function blockerToError(blocker: PaymentReadinessBlocker): Error {
  switch (blocker) {
    case 'payment_provider_not_configured':
      return new PaymentProviderNotConfiguredError()
    case 'payment_provider_not_allowed':
      return new PaymentProviderNotAllowedError()
    case 'payment_provider_unavailable':
      return new PaymentProviderUnavailableError()
    case 'payment_infrastructure_not_ready':
      return new PaymentInfrastructureNotReadyError()
  }
}

/** Read model: configured preference AND actual current availability (§37). */
export async function getPaymentSettingsReadModelService(
  db: DbClient,
  env: Env,
  overrides: ElectronicReadinessOverrides = {},
): Promise<PaymentSettingsReadModel> {
  const settings = await getPaymentSettingsService(db)
  const { blockers, provider } = getElectronicOperationalBlockers(env, overrides)
  const electronicAvailable = settings.electronicEnabled && blockers.length === 0

  return {
    cod: { enabled: settings.codEnabled, available: settings.codEnabled },
    electronic: {
      enabled: settings.electronicEnabled,
      available: electronicAvailable,
      configured: provider.configured,
      blockers,
    },
    reservationReconcileAfterMinutes: settings.reservationReconcileAfterMinutes,
  }
}

/**
 * Atomic, invariant-enforcing update. Applies only the fields present in
 * `input`; every other current value is preserved and re-validated together
 * (a partial update can still trip the zero-payment-method invariant).
 */
export async function updatePaymentSettingsService(
  db: DbClient,
  env: Env,
  input: PaymentSettingsUpdateInput,
  actor: AuditActor,
  overrides: ElectronicReadinessOverrides = {},
): Promise<PaymentSettingsReadModel> {
  await db.transaction(async (tx) => {
    const current = await getPaymentSettingsService(tx)
    const next: PaymentSettings = {
      codEnabled: input.codEnabled ?? current.codEnabled,
      electronicEnabled: input.electronicEnabled ?? current.electronicEnabled,
      reservationReconcileAfterMinutes:
        input.reservationReconcileAfterMinutes ?? current.reservationReconcileAfterMinutes,
    }

    if (next.electronicEnabled) {
      const { blockers } = getElectronicOperationalBlockers(env, overrides)
      if (blockers.length > 0) throw blockerToError(blockers[0]!)
    }

    if (!next.codEnabled && !next.electronicEnabled) {
      throw new NoPaymentMethodEnabledError({
        attempted: { codEnabled: next.codEnabled, electronicEnabled: next.electronicEnabled },
      })
    }

    if (input.codEnabled !== undefined) {
      await upsertSetting(tx, KEY_COD, JSON.stringify({ enabled: next.codEnabled }))
    }
    if (input.electronicEnabled !== undefined) {
      await upsertSetting(tx, KEY_ELECTRONIC, JSON.stringify({ enabled: next.electronicEnabled }))
    }
    if (input.reservationReconcileAfterMinutes !== undefined) {
      await upsertSetting(
        tx,
        KEY_RECONCILE,
        JSON.stringify({ minutes: next.reservationReconcileAfterMinutes }),
      )
    }

    await recordAudit(
      tx,
      actor,
      'payment_settings.updated',
      'setting',
      'payments',
      auditMeta({ applied: input }),
    )
  })

  return getPaymentSettingsReadModelService(db, env, overrides)
}
