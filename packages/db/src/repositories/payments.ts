/**
 * Payment attempt data access (Gate B4).
 *
 * One `payments` row = one logical charge attempt against a provider. This
 * layer only reads and writes rows; every invariant (status graph, write-once
 * provider identity, one-open-attempt-per-order, order/amount match) is
 * enforced by the DB trigger guards in `0008_b4_payment_integrity.sql` and the
 * `payments_one_open_per_order_uq` partial unique index. Guarded UPDATEs return
 * `undefined` when no row matched so the caller can map a lost race precisely.
 *
 * The chargeable-or-succeeded set is `('created','pending','succeeded')` — it
 * mirrors `CHARGEABLE_OR_SUCCEEDED_ATTEMPT_STATUSES` in `@likehoney/shared`
 * (this package must not import it) and the DB partial index predicate.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { DbClient } from '../client'
import { payments } from '../schema'

export type PaymentAttemptRow = typeof payments.$inferSelect

/** Attempt states inside the one-open-per-order partial unique index. */
export const OPEN_OR_SUCCEEDED_ATTEMPT_STATUSES = ['created', 'pending', 'succeeded'] as const

export interface NewPaymentAttempt {
  orderId: string
  provider: string
  idempotencyKey: string
  amountMinor: number
  currency: string
}

/**
 * Insert a fresh attempt in `status = 'created'` (provider identity + redirect
 * are attached later via `setProviderIdentityAndRedirect`). Raises the
 * `payments_one_open_per_order_uq` unique violation when the order already has
 * a `created` / `pending` / `succeeded` attempt — the caller re-reads to tell
 * `payment_attempt_active` from `payment_already_succeeded`.
 */
export async function createAttempt(
  db: DbClient,
  values: NewPaymentAttempt,
): Promise<PaymentAttemptRow> {
  const rows = await db
    .insert(payments)
    .values({
      orderId: values.orderId,
      provider: values.provider,
      idempotencyKey: values.idempotencyKey,
      amountMinor: values.amountMinor,
      currency: values.currency,
      status: 'created',
    })
    .returning()
  return rows[0] as PaymentAttemptRow
}

export async function getAttemptById(
  db: DbClient,
  id: string,
): Promise<PaymentAttemptRow | undefined> {
  const rows = await db.select().from(payments).where(eq(payments.id, id)).limit(1)
  return rows[0]
}

/** Look up the single attempt that owns a provider transaction reference. */
export async function getAttemptByProviderReference(
  db: DbClient,
  provider: string,
  providerPaymentId: string,
): Promise<PaymentAttemptRow | undefined> {
  const rows = await db
    .select()
    .from(payments)
    .where(and(eq(payments.provider, provider), eq(payments.providerPaymentId, providerPaymentId)))
    .limit(1)
  return rows[0]
}

/** Every attempt ever made for an order, oldest first. */
export async function getAttemptsForOrder(
  db: DbClient,
  orderId: string,
): Promise<PaymentAttemptRow[]> {
  return db
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .orderBy(asc(payments.createdAt))
}

/**
 * The at-most-one attempt occupying the order's open-or-succeeded slot
 * (guaranteed unique by `payments_one_open_per_order_uq`).
 */
export async function getChargeableOrSucceededAttemptForOrder(
  db: DbClient,
  orderId: string,
): Promise<PaymentAttemptRow | undefined> {
  const rows = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.orderId, orderId),
        inArray(payments.status, [...OPEN_OR_SUCCEEDED_ATTEMPT_STATUSES]),
      ),
    )
    .limit(1)
  return rows[0]
}

export async function getSucceededAttemptForOrder(
  db: DbClient,
  orderId: string,
): Promise<PaymentAttemptRow | undefined> {
  const rows = await db
    .select()
    .from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.status, 'succeeded')))
    .limit(1)
  return rows[0]
}

/**
 * Guarded status move. Updates only while the row is still in one of
 * `expectedStatuses`; returns the new row, or `undefined` when a concurrent
 * writer already moved it (or the move is illegal and the DB guard rejected a
 * matched row — that surfaces as a thrown integrity error instead).
 */
export async function transitionAttempt(
  db: DbClient,
  id: string,
  expectedStatuses: readonly PaymentAttemptRow['status'][],
  nextStatus: PaymentAttemptRow['status'],
): Promise<PaymentAttemptRow | undefined> {
  const rows = await db
    .update(payments)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(and(eq(payments.id, id), inArray(payments.status, [...expectedStatuses])))
    .returning()
  return rows[0]
}

/**
 * Attach ONLY the provider transaction id, write-once (NULL → value). Used by
 * the Gate B4 Stage 4 canonical success path when no hosted-page redirect
 * exists for this recovery (e.g. a webhook/reconciliation success that never
 * went through provider init locally). Returns `undefined` if already set.
 */
export async function setProviderPaymentId(
  db: DbClient,
  id: string,
  providerPaymentId: string,
): Promise<PaymentAttemptRow | undefined> {
  const rows = await db
    .update(payments)
    .set({ providerPaymentId, updatedAt: new Date() })
    .where(and(eq(payments.id, id), isNull(payments.providerPaymentId)))
    .returning()
  return rows[0]
}

/**
 * Attach the provider transaction id + hosted-page URL exactly once
 * (NULL → value). Returns `undefined` if the identity was already set (write
 * lost the race) so the caller reloads instead of erroring.
 */
export async function setProviderIdentityAndRedirect(
  db: DbClient,
  id: string,
  providerPaymentId: string,
  redirectUrl: string,
): Promise<PaymentAttemptRow | undefined> {
  const rows = await db
    .update(payments)
    .set({ providerPaymentId, redirectUrl, updatedAt: new Date() })
    .where(and(eq(payments.id, id), isNull(payments.providerPaymentId)))
    .returning()
  return rows[0]
}

/** Touch `updated_at` without changing state (kept for parity / heartbeats). */
export async function touchAttempt(db: DbClient, id: string): Promise<void> {
  await db
    .update(payments)
    .set({ updatedAt: sql`now()` })
    .where(eq(payments.id, id))
}
