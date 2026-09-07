/**
 * Provider webhook / lookup event ledger data access (Gate B4).
 *
 * `payment_events` is append-only and crash-safe: `claimEvent` is an
 * `INSERT ... ON CONFLICT DO NOTHING` on `(provider, provider_event_id)`, so a
 * redelivered webhook never creates a second row and the caller learns whether
 * IT won the claim. `payment_id`, `processed_at` and `outcome` are write-once
 * (DB trigger `lh_payment_events_immutability_guard`); the guarded UPDATEs here
 * return `undefined` when the field was already set.
 *
 * The raw payload is never persisted — only a SHA-256 hex hash for conflict
 * detection plus normalized safe fields.
 */
import { and, asc, eq, isNull } from 'drizzle-orm'

import type { DbClient } from '../client'
import { paymentEvents, payments } from '../schema'
import type { PaymentAttemptRow } from './payments'

export type PaymentEventRow = typeof paymentEvents.$inferSelect

export interface ClaimEventInput {
  provider: string
  providerEventId: string
  providerPaymentId: string | null
  type: string
  payloadHash: string
  amountMinor: number | null
  currency: string | null
  /** Normalized `pending|succeeded|failed|expired|unknown` from `parseWebhook`. */
  paymentStatus: string
}

/**
 * Attempt to record a freshly received event. Returns the inserted row when
 * THIS caller won the claim, or `undefined` when `(provider, provider_event_id)`
 * already exists (a duplicate delivery) — the caller then loads the existing
 * row with `getEvent` and compares `payload_hash` / `processed_at`.
 */
export async function claimEvent(
  db: DbClient,
  input: ClaimEventInput,
): Promise<PaymentEventRow | undefined> {
  const rows = await db
    .insert(paymentEvents)
    .values({
      provider: input.provider,
      providerEventId: input.providerEventId,
      providerPaymentId: input.providerPaymentId,
      type: input.type,
      payloadHash: input.payloadHash,
      amountMinor: input.amountMinor,
      currency: input.currency,
      paymentStatus: input.paymentStatus,
    })
    .onConflictDoNothing({
      target: [paymentEvents.provider, paymentEvents.providerEventId],
    })
    .returning()
  return rows[0]
}

export async function getEvent(
  db: DbClient,
  provider: string,
  providerEventId: string,
): Promise<PaymentEventRow | undefined> {
  const rows = await db
    .select()
    .from(paymentEvents)
    .where(
      and(eq(paymentEvents.provider, provider), eq(paymentEvents.providerEventId, providerEventId)),
    )
    .limit(1)
  return rows[0]
}

export async function getEventById(db: DbClient, id: string): Promise<PaymentEventRow | undefined> {
  const rows = await db.select().from(paymentEvents).where(eq(paymentEvents.id, id)).limit(1)
  return rows[0]
}

/** Same as `getEvent` but only returns the row while it is still unprocessed. */
export async function getUnprocessedEvent(
  db: DbClient,
  provider: string,
  providerEventId: string,
): Promise<PaymentEventRow | undefined> {
  const rows = await db
    .select()
    .from(paymentEvents)
    .where(
      and(
        eq(paymentEvents.provider, provider),
        eq(paymentEvents.providerEventId, providerEventId),
        isNull(paymentEvents.processedAt),
      ),
    )
    .limit(1)
  return rows[0]
}

/** Oldest unprocessed events first — the recovery / sweep worker feed. */
export async function listUnprocessedEvents(
  db: DbClient,
  limit: number,
): Promise<PaymentEventRow[]> {
  return db
    .select()
    .from(paymentEvents)
    .where(isNull(paymentEvents.processedAt))
    .orderBy(asc(paymentEvents.receivedAt))
    .limit(limit)
}

/**
 * Resolve a provider payment reference to its attempt row (identity match:
 * same provider + non-null equal `provider_payment_id`). Used to link an
 * unmatched event to its payment.
 */
export async function findPaymentByProviderIdentity(
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

/**
 * Attach the payment link exactly once (NULL → value). The DB guard validates
 * relational identity (provider + provider_payment_id equality) on this first
 * link; it deliberately does NOT require amount/currency equality (B1 ruling —
 * a mismatch is finalized with `outcome = 'mismatch'`, not rejected here).
 * Returns `undefined` if the event was already linked.
 */
export async function linkEventToPayment(
  db: DbClient,
  eventId: string,
  paymentId: string,
): Promise<PaymentEventRow | undefined> {
  const rows = await db
    .update(paymentEvents)
    .set({ paymentId })
    .where(and(eq(paymentEvents.id, eventId), isNull(paymentEvents.paymentId)))
    .returning()
  return rows[0]
}

/**
 * Mark an event conclusively handled exactly once: sets `processed_at = now()`
 * and the write-once `outcome` together. Returns `undefined` if it was already
 * processed (a duplicate delivery must not rewrite the outcome).
 */
export async function finalizeEvent(
  db: DbClient,
  eventId: string,
  outcome: PaymentEventRow['outcome'],
): Promise<PaymentEventRow | undefined> {
  const rows = await db
    .update(paymentEvents)
    .set({ processedAt: new Date(), outcome })
    .where(and(eq(paymentEvents.id, eventId), isNull(paymentEvents.processedAt)))
    .returning()
  return rows[0]
}
