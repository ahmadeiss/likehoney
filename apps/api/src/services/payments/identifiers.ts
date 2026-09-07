/**
 * Gate B4 Stage 4 — server-owned payment attempt identifiers (§13/§14).
 *
 * Checkout idempotency (`orders.idempotency_key` / `checkout_claims`) and
 * provider payment idempotency (`payments.idempotency_key`) are separate
 * concepts. Both derivations here are PURE functions of already-durable,
 * non-PII local data — never random, never generated inside a transaction
 * retry closure (a `40P01`/`40001` retry must reuse the exact same value).
 */
import { fingerprint } from '@likehoney/shared'

/**
 * The provider idempotency key for the Nth payment attempt of one checkout.
 * Deterministic from the checkout's own idempotency key (client-supplied,
 * durable) + the attempt ordinal (1 for the checkout-time attempt, 2+ for
 * each internal retry) — computed once, BEFORE entering (or retrying) the
 * database transaction, and passed in.
 */
export function deriveProviderIdempotencyKey(
  checkoutIdempotencyKey: string,
  attemptOrdinal: number,
): Promise<string> {
  return fingerprint({
    scope: 'lh-electronic-attempt',
    checkoutIdempotencyKey,
    attemptOrdinal,
  })
}

/**
 * A deterministic, non-PII merchant reference for one attempt — reproducible
 * later from immutable local data alone (order number + attempt ordinal).
 * Never customer phone/name/address. Distinct per attempt of the same order.
 */
export function buildMerchantReference(orderNumber: string, attemptOrdinal: number): string {
  return `${orderNumber}-A${attemptOrdinal}`
}
