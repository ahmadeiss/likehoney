/**
 * Gate B4 Stage 4 — crash-safe webhook business processing (§32-§41).
 *
 * RECEIVED != PROCESSED. Phase A (event receipt: `INSERT ... ON CONFLICT DO
 * NOTHING`) already committed by the time this runs (see `routes/payments.ts`)
 * — `received_at` exists, `processed_at`/`outcome` are still NULL. This module
 * is Phase B: business processing, in its own transaction(s), holding no lock
 * across the HTTP boundary and safely re-enterable by the scheduled sweep.
 *
 * Lock order (non-negotiable, §33): ORDER → PAYMENT ATTEMPT → RESERVATIONS →
 * INVENTORY → PAYMENT EVENT LAST. `applyPaymentSuccessService` /
 * `applyAttemptTerminalService` already implement exactly this order and
 * accept `finalizeAsEvent` to finalize the event as their last write, inside
 * the SAME transaction — this module never re-implements that transaction,
 * it only decides WHICH one (if any) to call.
 */
import {
  finalizeEvent,
  findPaymentByProviderIdentity,
  getAttemptById,
  getEventById,
  getOrderForUpdate,
  linkEventToPayment,
  transitionAttempt,
  withDeadlockRetry,
  type DbClient,
  type PaymentEventRow,
} from '@likehoney/db'

import { auditActor, auditMeta, recordAudit } from '../audit'
import { applyAttemptTerminalService } from './attempt-terminal'
import { applyPaymentSuccessService } from './success'

const SYSTEM_ACTOR = auditActor(undefined)

export type ProcessEventOutcome =
  | 'applied_pending'
  | 'applied_success'
  | 'applied_attempt_failed'
  | 'applied_attempt_expired'
  | 'ignored_out_of_order'
  | 'ignored_unknown_status'
  | 'mismatch'
  | 'noop'
  | 'unmatched' // not a final DB outcome — event stays unprocessed

/**
 * Process ONE claimed-but-unprocessed event. Idempotent: safe to call again
 * for an event that a concurrent processor already finished (§34) — re-reads
 * `processed_at` under order lock inside the delegate services before
 * mutating anything.
 */
export async function processPaymentEventService(
  db: DbClient,
  event: PaymentEventRow,
): Promise<ProcessEventOutcome> {
  // Re-read in case a concurrent processor already finished it (cheap plain
  // read before doing any work — the authoritative re-check still happens
  // inside whichever locked transaction below actually mutates anything).
  const fresh = (await getEventById(db, event.id)) ?? event
  if (fresh.processedAt !== null) {
    return (fresh.outcome as ProcessEventOutcome | null) ?? 'noop'
  }

  // §37 — identity match by (provider, providerPaymentId) ONLY.
  let paymentId = fresh.paymentId
  if (paymentId === null && fresh.providerPaymentId !== null) {
    const found = await findPaymentByProviderIdentity(db, fresh.provider, fresh.providerPaymentId)
    if (found !== undefined) {
      const linked = await linkEventToPayment(db, fresh.id, found.id)
      paymentId = linked?.paymentId ?? (await getEventById(db, fresh.id))?.paymentId ?? null
    }
  }
  if (paymentId === null) {
    // §37: leave payment_id/processed_at/outcome NULL — a later scheduled
    // sweep re-matches once provider-init recovery persists provider_payment_id.
    await recordAudit(
      db,
      SYSTEM_ACTOR,
      'payment.webhook_unmatched',
      'payment_event',
      fresh.id,
      auditMeta({ provider: fresh.provider, providerPaymentId: fresh.providerPaymentId }),
    )
    return 'unmatched'
  }

  const attempt = await getAttemptById(db, paymentId)
  if (attempt === undefined) {
    // Payment row vanished under us — cannot happen (payments are never
    // deleted), but stay defensive and leave the event unprocessed.
    return 'unmatched'
  }

  // §38 financial mismatch — identity is correct, financials are not.
  if (
    fresh.amountMinor !== null &&
    fresh.currency !== null &&
    (fresh.amountMinor !== attempt.amountMinor || fresh.currency !== attempt.currency)
  ) {
    await finalizeEvent(db, fresh.id, 'mismatch')
    await recordAudit(
      db,
      SYSTEM_ACTOR,
      'payment.webhook_mismatch',
      'payment_event',
      fresh.id,
      auditMeta({
        paymentId: attempt.id,
        eventAmount: fresh.amountMinor,
        attemptAmount: attempt.amountMinor,
      }),
    )
    return 'mismatch'
  }

  switch (fresh.paymentStatus) {
    case 'succeeded': {
      if (fresh.amountMinor === null || fresh.currency === null) {
        // §71: no provider-confirmed financials in the event itself — do NOT
        // mark paid from this alone. This module never calls the provider
        // (that stays outside any transaction, in reconciliation); mark
        // ignored_unknown_status here — reconciliation's authoritative lookup
        // (outside a DB tx) remains the path to a real success application.
        await finalizeEvent(db, fresh.id, 'ignored_unknown_status')
        return 'ignored_unknown_status'
      }
      const providerPaymentId = fresh.providerPaymentId ?? attempt.providerPaymentId
      if (providerPaymentId === null) {
        // Should be unreachable (identity linking requires providerPaymentId),
        // but never fabricate one — leave unresolved rather than guess.
        await finalizeEvent(db, fresh.id, 'ignored_unknown_status')
        return 'ignored_unknown_status'
      }
      const result = await applyPaymentSuccessService(db, {
        orderId: attempt.orderId,
        paymentAttemptId: attempt.id,
        provider: fresh.provider,
        confirmed: {
          providerPaymentId,
          amountMinor: fresh.amountMinor,
          currency: fresh.currency,
        },
        authoritativeAt: fresh.receivedAt,
        actor: SYSTEM_ACTOR,
        finalizeAsEvent: { eventId: fresh.id },
      })
      return result.outcome === 'applied' ? 'applied_success' : 'noop'
    }

    case 'failed':
    case 'expired': {
      if (attempt.status === 'succeeded') {
        // Out-of-order: a late failed/expired arriving after success is
        // never allowed to regress it (§72).
        await finalizeEvent(db, fresh.id, 'ignored_out_of_order')
        return 'ignored_out_of_order'
      }
      const result = await applyAttemptTerminalService(db, {
        orderId: attempt.orderId,
        paymentAttemptId: attempt.id,
        provider: fresh.provider,
        status: fresh.paymentStatus,
        providerPaymentId: fresh.providerPaymentId ?? undefined,
        actor: SYSTEM_ACTOR,
        finalizeAsEvent: { eventId: fresh.id },
      })
      return result.outcome === 'applied'
        ? fresh.paymentStatus === 'failed'
          ? 'applied_attempt_failed'
          : 'applied_attempt_expired'
        : 'ignored_out_of_order'
    }

    case 'pending': {
      if (
        attempt.status === 'succeeded' ||
        attempt.status === 'failed' ||
        attempt.status === 'expired'
      ) {
        await finalizeEvent(db, fresh.id, 'ignored_out_of_order')
        return 'ignored_out_of_order'
      }
      if (attempt.status === 'pending') {
        await finalizeEvent(db, fresh.id, 'noop')
        return 'noop'
      }
      // created -> pending, under order lock (small self-contained transaction).
      await withDeadlockRetry(() =>
        db.transaction(async (tx) => {
          await getOrderForUpdate(tx, attempt.orderId)
          const current = await getAttemptById(tx, attempt.id)
          if (current === undefined || current.status !== 'created') return
          await transitionAttempt(tx, current.id, ['created'], 'pending')
          await recordAudit(
            tx,
            SYSTEM_ACTOR,
            'payment.provider_initialized',
            'order',
            attempt.orderId,
            auditMeta({ paymentAttemptId: attempt.id, via: 'webhook' }),
          )
          await finalizeEvent(tx, fresh.id, 'applied_pending')
        }),
      )
      return 'applied_pending'
    }

    case 'unknown':
    default: {
      // §41: unknown NEVER fails payment, expires order, releases, or commits
      // stock. Reconciliation remains responsible for eventual payment truth.
      await finalizeEvent(db, fresh.id, 'ignored_unknown_status')
      return 'ignored_unknown_status'
    }
  }
}
