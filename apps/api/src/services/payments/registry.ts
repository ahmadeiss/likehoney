/**
 * Gate B4 Stage 3 — the ONE canonical payment-provider resolver.
 *
 * Every caller that needs a provider (or just its readiness) goes through
 * `resolveConfiguredProvider` / `getConfiguredPaymentProvider`. No `if
 * (provider === 'test')` scattered through services — this is the single
 * place provider selection happens, and the single place the production
 * TEST-provider prohibition is enforced.
 *
 * An unconfigured or unrecognized `PAYMENT_PROVIDER` NEVER silently falls
 * back to the TEST provider — it resolves to "not ready" with a stable
 * blocker code.
 */
import type { PaymentProvider, PaymentProviderReadiness } from '@likehoney/shared'

import { DEV_APP_ENV, type Env } from '../../env'
import { createTestPaymentProvider, TEST_PROVIDER_CODE } from './test-provider'

export interface ResolvedPaymentProvider {
  /** `null` whenever `readiness.operational` is false — never a half-usable adapter. */
  provider: PaymentProvider | null
  readiness: PaymentProviderReadiness
}

/**
 * Resolve the configured provider for this environment. Fail-closed: only
 * `APP_ENV === 'development'` (the exact same marker every other dev-only
 * path in this API already uses) is treated as development; anything else —
 * including unset — is non-development.
 */
export function resolveConfiguredProvider(env: Env): ResolvedPaymentProvider {
  const providerCode = env.PAYMENT_PROVIDER?.trim()

  if (providerCode === undefined || providerCode.length === 0) {
    return {
      provider: null,
      readiness: {
        configured: false,
        operational: false,
        blockers: ['payment_provider_not_configured'],
      },
    }
  }

  return resolveProviderByCode(providerCode, env)
}

/** Convenience: just the resolved provider, or `null` when not usable. */
export function getConfiguredPaymentProvider(env: Env): PaymentProvider | null {
  return resolveConfiguredProvider(env).provider
}

/**
 * Gate B4 Stage 4 (§4) — resolve the adapter for an EXISTING persisted
 * payment/event by its snapshotted `payments.provider` code, never by
 * whatever `PAYMENT_PROVIDER` happens to be configured today. If the
 * currently-configured provider later changes (or the historical provider's
 * adapter becomes unavailable), a Provider-A attempt must never be
 * interpreted through Provider B, and must never silently fail/release —
 * callers keep reconciliation pending and audit `payment_provider_unavailable`
 * instead. The TEST provider is still impossible outside development,
 * regardless of which code path resolves it.
 */
export function resolveProviderByCode(providerCode: string, env: Env): ResolvedPaymentProvider {
  const isDevelopment = env.APP_ENV === DEV_APP_ENV

  if (providerCode === TEST_PROVIDER_CODE) {
    if (!isDevelopment) {
      return {
        provider: null,
        readiness: {
          configured: true,
          operational: false,
          providerCode: TEST_PROVIDER_CODE,
          blockers: ['payment_provider_not_allowed'],
        },
      }
    }
    const provider = createTestPaymentProvider({
      webhookSecret: env.TEST_PAYMENT_WEBHOOK_SECRET,
      defaultScenario: isKnownDefaultScenario(env.TEST_PAYMENT_DEFAULT_SCENARIO)
        ? env.TEST_PAYMENT_DEFAULT_SCENARIO
        : undefined,
    })
    return { provider, readiness: provider.getReadiness() }
  }

  return {
    provider: null,
    readiness: {
      configured: true,
      operational: false,
      providerCode,
      blockers: ['payment_provider_unavailable'],
    },
  }
}

const KNOWN_DEFAULT_SCENARIOS = new Set([
  'pending',
  'succeeded',
  'failed',
  'expired',
  'unknown',
  'indeterminate',
])

function isKnownDefaultScenario(
  value: string | undefined,
): value is 'pending' | 'succeeded' | 'failed' | 'expired' | 'unknown' | 'indeterminate' {
  return typeof value === 'string' && KNOWN_DEFAULT_SCENARIOS.has(value)
}
