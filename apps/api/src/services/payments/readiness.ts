/**
 * Gate B4 Stage 4 — overall electronic-payment readiness.
 *
 * Provider readiness alone is NOT sufficient (§17): business enablement also
 * requires the checkout engine, webhook pipeline and reconciliation sweep to
 * actually exist. Through Stage 3 that infrastructure did not exist, so
 * `payment_infrastructure_not_ready` was a PERMANENT blocker regardless of
 * provider state.
 *
 * Gate B4 Stage 4 §78 — READINESS ACTIVATION: the electronic checkout engine
 * (Phase A/B), provider-init recovery, the internal retry service, the
 * verified webhook HTTP boundary + crash-safe claim/process pipeline, the
 * canonical success/attempt-terminal/order-expiry services, the
 * reconciliation service and its scheduled handler are all implemented and
 * verified (real-Neon service tests + HTTP-level checkout + concurrency/
 * crash tests — see the Stage-4 final report). The permanent blocker is
 * therefore REMOVED here.
 *
 * This does NOT enable electronic payment: `payments:electronic.enabled`
 * still defaults to `false` (§30 unchanged), and even once an Admin enables
 * it, `payment_provider_not_configured`/`_not_allowed`/`_unavailable` still
 * apply — no real provider is selected, and the TEST provider stays
 * impossible outside development. "B4 foundation ready" is explicitly NOT
 * "real production payment ready" (§80).
 *
 * `overrides.infrastructureReady` stays available (default `true` now) so a
 * future regression can be simulated in tests by forcing it back to `false`
 * — it must never be wired to a runtime/env-driven code path.
 */
import type { ElectronicPaymentReadiness, PaymentReadinessBlocker } from '@likehoney/shared'

import type { Env } from '../../env'
import { resolveConfiguredProvider } from './registry'

export interface ElectronicReadinessOverrides {
  /** TEST-ONLY escape hatch to simulate infrastructure being unready. Never wired to env. */
  infrastructureReady?: boolean
}

export interface ElectronicOperationalBlockers {
  blockers: PaymentReadinessBlocker[]
  provider: ReturnType<typeof resolveConfiguredProvider>['readiness']
}

/**
 * Provider + infrastructure blockers ONLY — independent of the saved Admin
 * preference. This is what the electronic-enablement guard (`settings.ts`)
 * consults to decide whether `electronicEnabled: true` may be persisted at
 * all, and what `getElectronicPaymentReadiness` folds the setting into below.
 */
export function getElectronicOperationalBlockers(
  env: Env,
  overrides: ElectronicReadinessOverrides = {},
): ElectronicOperationalBlockers {
  const { readiness: provider } = resolveConfiguredProvider(env)
  const infrastructureReady = overrides.infrastructureReady !== false

  const blockers: PaymentReadinessBlocker[] = [...provider.blockers]
  if (!infrastructureReady) blockers.push('payment_infrastructure_not_ready')

  return { blockers, provider }
}

/**
 * Full read-model readiness: the saved preference AND the actual operational
 * blockers combined into one `availableForCheckout` a public surface may use.
 */
export function getElectronicPaymentReadiness(
  env: Env,
  enabledSetting: boolean,
  overrides: ElectronicReadinessOverrides = {},
): ElectronicPaymentReadiness {
  const { blockers, provider } = getElectronicOperationalBlockers(env, overrides)
  return {
    enabledSetting,
    availableForCheckout: enabledSetting && blockers.length === 0,
    provider,
    blockers,
  }
}
