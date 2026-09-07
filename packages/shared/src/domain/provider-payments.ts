/**
 * Gate B4 Stage 3 — provider-agnostic electronic payment adapter contract.
 *
 * Pure, portable types + the `PaymentProvider` interface every adapter (the
 * Stage-3 development TEST provider, a real gateway in B5) implements. No
 * database handle, no repository, no HTTP framework context ever crosses this
 * boundary — an adapter only talks to its provider and normalizes the result;
 * business services (order/payment/reservation/inventory transitions) are a
 * separate, later concern (Stage 4).
 *
 * `ProviderPaymentStatus` is intentionally a NARROWER, DIFFERENT vocabulary
 * from `PaymentAttemptStatus` (`./payments`): the DB attempt also has an
 * internal `created` state ("a row exists, provider init hasn't conclusively
 * finished") that no provider ever reports. Never conflate the two.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Normalized provider payment status
// ---------------------------------------------------------------------------

/**
 * The provider's own truth about one payment, normalized across adapters.
 * - `pending`   provider has an open attempt, no conclusive result yet.
 * - `succeeded` provider confirms the charge captured. Terminal.
 * - `failed`    provider explicitly declined/rejected. Terminal.
 * - `expired`   provider's own window closed with no success. Terminal.
 * - `unknown`   provider truth is INCONCLUSIVE (network failure, ambiguous
 *               response, provider itself uncertain). This is NOT `failed`,
 *               NOT `expired`, NOT cancelled — reconciliation must keep
 *               retrying and a reservation backed by `unknown` is NEVER
 *               released on that basis alone (Stage 4).
 */
export const PROVIDER_PAYMENT_STATUSES = [
  'pending',
  'succeeded',
  'failed',
  'expired',
  'unknown',
] as const
export type ProviderPaymentStatus = (typeof PROVIDER_PAYMENT_STATUSES)[number]
export const providerPaymentStatusSchema = z.enum(PROVIDER_PAYMENT_STATUSES)

// ---------------------------------------------------------------------------
// createPayment
// ---------------------------------------------------------------------------

/**
 * Minimal, provider-agnostic payment-creation input. Never the full order or
 * customer object — a provider gets only what it needs to open a charge.
 */
export interface ProviderCreatePaymentInput {
  /** The `payments` row id this call is for (idempotency scope). */
  attemptId: string
  orderId: string
  /** Human-facing order number / merchant reference (e.g. `LH-000123`). */
  merchantReference: string
  /** The attempt's own idempotency key — MUST be reused on retry (§10). */
  idempotencyKey: string
  amountMinor: number
  currency: string
  returnUrl?: string
  cancelUrl?: string
}

/**
 * The provider accepted the attempt and returned an identity. `status` is
 * `succeeded` only for providers that can settle synchronously; otherwise
 * `pending` with a `redirectUrl` to complete the charge.
 *
 * Gate B4 Stage 4 (§2/§3): a `succeeded` result is USABLE for business truth
 * ONLY when `amountMinor`/`currency` are present — that is the provider's own
 * confirmed financials, never the caller's expected amount echoed back. A
 * real adapter must leave these `undefined` unless the provider's own
 * response actually carried them; the canonical success service (Stage 4)
 * refuses to apply a `succeeded` result with either field missing and falls
 * back to an authoritative `getPaymentStatus` lookup instead. The TEST
 * provider may simulate authoritative confirmation (it is both "provider" and
 * "expected" in a test), but a real adapter must never fabricate this.
 */
export interface ProviderCreatePaymentCreated {
  outcome: 'created'
  providerPaymentId: string
  redirectUrl?: string
  status: Extract<ProviderPaymentStatus, 'pending' | 'succeeded'>
  /** Provider-confirmed amount. Required in practice when `status: 'succeeded'`. */
  amountMinor?: number
  /** Provider-confirmed currency. Required in practice when `status: 'succeeded'`. */
  currency?: string
}

/** True only when a `succeeded` create result carries provider-confirmed financials. */
export function hasConfirmedFinancials(
  result: Pick<ProviderCreatePaymentCreated, 'amountMinor' | 'currency'>,
): result is { amountMinor: number; currency: string } {
  return typeof result.amountMinor === 'number' && typeof result.currency === 'string'
}

/** The provider CONCLUSIVELY rejected or timed out the attempt. Terminal. */
export interface ProviderCreatePaymentDefinitiveFailure {
  outcome: 'definitive_failure'
  status: Extract<ProviderPaymentStatus, 'failed' | 'expired'>
  providerPaymentId?: string
  reason?: string
}

/**
 * The outcome could not be determined (network timeout, ambiguous response).
 * The provider MAY have created the payment anyway — recovery happens later
 * via `getPaymentStatus` using the durable attempt identity (§11), never by
 * blindly retrying `createPayment` with a fresh identity.
 */
export interface ProviderCreatePaymentIndeterminate {
  outcome: 'indeterminate'
  providerPaymentId?: string
  reason?: string
}

/**
 * Discriminated union — a generic `catch` must NEVER collapse into
 * `definitive_failure`. An indeterminate/network outcome stays indeterminate.
 */
export type ProviderCreatePaymentResult =
  | ProviderCreatePaymentCreated
  | ProviderCreatePaymentDefinitiveFailure
  | ProviderCreatePaymentIndeterminate

// ---------------------------------------------------------------------------
// getPaymentStatus (lookup / unknown-init recovery)
// ---------------------------------------------------------------------------

/**
 * Lookup input MUST NOT require only `providerPaymentId` — initialization can
 * time out AFTER the provider actually created the payment, before the id was
 * persisted locally. `idempotencyKey` / `merchantReference` are the durable
 * attempt identity a provider that supports it can use to recover.
 *
 * `expectedAmountMinor`/`expectedCurrency` are a TEST/simulation aid ONLY — a
 * real adapter MUST ignore them and return its own authoritative truth
 * regardless of what is passed (never echo the caller's expectation as
 * provider-confirmed). They exist so the stateless TEST provider can still
 * demonstrate financial confirmation on lookup without holding server-side
 * state — the caller (reconciliation) already has the expected values from
 * the local `payments` row.
 */
export interface ProviderPaymentLookupInput {
  providerPaymentId?: string
  idempotencyKey: string
  merchantReference: string
  expectedAmountMinor?: number
  expectedCurrency?: string
}

export interface ProviderPaymentLookupResult {
  status: ProviderPaymentStatus
  /** Safe provider identity where available — never business truth by itself. */
  providerPaymentId?: string
  amountMinor?: number
  currency?: string
}

// ---------------------------------------------------------------------------
// Webhook verification + normalized event
// ---------------------------------------------------------------------------

export interface ProviderWebhookVerificationInput {
  rawBody: string
  headers: Record<string, string>
}

export interface ProviderWebhookParseInput {
  rawBody: string
  headers: Record<string, string>
}

/**
 * Provider-neutral parsed webhook event. No PAN/CVV/secret/raw body — the raw
 * body itself stays outside this object (the Stage-4 event pipeline hashes it
 * for the crash-safe ledger; it is never this adapter's concern to persist).
 */
export interface NormalizedProviderEvent {
  providerEventId: string
  providerPaymentId: string | null
  eventType: string
  paymentStatus: ProviderPaymentStatus
  amountMinor: number | null
  currency: string | null
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/** Stable, machine-coded reasons electronic payment is not usable right now. */
export const PAYMENT_READINESS_BLOCKERS = [
  /** No provider code configured for this deployment. */
  'payment_provider_not_configured',
  /** A provider is configured but is not permitted in this environment
   *  (the TEST provider outside development). */
  'payment_provider_not_allowed',
  /** A provider code is configured but unrecognized / not implemented. */
  'payment_provider_unavailable',
  /** Provider is fine, but Stage-4 checkout/webhook/reconciliation
   *  infrastructure this readiness depends on does not exist yet. */
  'payment_infrastructure_not_ready',
] as const
export type PaymentReadinessBlocker = (typeof PAYMENT_READINESS_BLOCKERS)[number]

/** Narrow provider-level readiness — says nothing about business enablement. */
export interface PaymentProviderReadiness {
  /** A provider code resolved to an implementation. */
  configured: boolean
  /** The resolved provider is currently usable (never a network health check). */
  operational: boolean
  providerCode?: string
  blockers: PaymentReadinessBlocker[]
}

/**
 * Overall electronic-checkout readiness — provider readiness is necessary but
 * not sufficient (§17). `availableForCheckout` is the only field a public
 * surface may treat as "can a customer actually pay electronically now".
 */
export interface ElectronicPaymentReadiness {
  /** The saved Admin preference — NOT the same as actual availability (§18). */
  enabledSetting: boolean
  availableForCheckout: boolean
  provider: PaymentProviderReadiness
  blockers: PaymentReadinessBlocker[]
}

// ---------------------------------------------------------------------------
// The adapter interface
// ---------------------------------------------------------------------------

/**
 * One payment provider adapter. Implementations perform ONLY provider
 * communication, authentication and response normalization — never a
 * database write, repository call, or order/payment/reservation transition.
 */
export interface PaymentProvider {
  readonly code: string
  getReadiness(): PaymentProviderReadiness
  createPayment(input: ProviderCreatePaymentInput): Promise<ProviderCreatePaymentResult>
  getPaymentStatus(input: ProviderPaymentLookupInput): Promise<ProviderPaymentLookupResult>
  verifyWebhook(input: ProviderWebhookVerificationInput): Promise<boolean>
  parseWebhook(input: ProviderWebhookParseInput): Promise<NormalizedProviderEvent>
}

// ---------------------------------------------------------------------------
// Payment settings (canonical, provider-agnostic)
// ---------------------------------------------------------------------------

/** The typed payment-settings service contract — never a raw JSON blob. */
export interface PaymentSettings {
  codEnabled: boolean
  electronicEnabled: boolean
  /** Minutes after which a held reservation becomes eligible for reconciliation
   *  (Stage 4 sweep trigger). Does NOT authorize stock release by itself. */
  reservationReconcileAfterMinutes: number
}

/** Read model: configured preference AND actual current availability. */
export interface PaymentSettingsReadModel {
  cod: { enabled: boolean; available: boolean }
  electronic: {
    enabled: boolean
    available: boolean
    configured: boolean
    blockers: PaymentReadinessBlocker[]
  }
  reservationReconcileAfterMinutes: number
}

export const RESERVATION_RECONCILE_MINUTES_MIN = 1
export const RESERVATION_RECONCILE_MINUTES_MAX = 1440
export const DEFAULT_RESERVATION_RECONCILE_MINUTES = 20

export const paymentSettingsUpdateSchema = z
  .object({
    codEnabled: z.boolean().optional(),
    electronicEnabled: z.boolean().optional(),
    reservationReconcileAfterMinutes: z
      .number()
      .int()
      .min(RESERVATION_RECONCILE_MINUTES_MIN)
      .max(RESERVATION_RECONCILE_MINUTES_MAX)
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one payment setting field is required',
  })
export type PaymentSettingsUpdateInput = z.infer<typeof paymentSettingsUpdateSchema>
