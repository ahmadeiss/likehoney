/**
 * Gate B4 Stage 4 — authoritative order-level expiry (§52/§53).
 *
 * `reconcile_after` NEVER means "release at this timestamp" — it only means
 * "the reconciliation sweep may start checking authoritative provider truth
 * now." This service is the ONLY path that closes an electronic order, and it
 * only proceeds when ALL of §52's conditions hold under the order lock:
 *
 *   1. now >= reservation.reconcile_after           (checked by the CALLER —
 *      reconciliation only selects candidates past their window; this
 *      service itself re-derives closure purely from persisted attempt rows)
 *   2. at least one payment attempt exists
 *   3. every attempt is terminal non-success (failed | expired)
 *   4. no attempt is created | pending | succeeded
 *   5. every terminal attempt state was written by an authoritative result
 *      (true by construction — `payments` rows only ever reach failed/expired
 *      through the DB-guarded attempt-transition path, never a local guess)
 *
 * The persisted attempt rows ARE the durable proof — a local timer alone is
 * never proof and this service never consults `reconcile_after` for the
 * decision itself.
 */
import { PaymentIntegrityConflictError, ValidationError } from '@likehoney/shared'
import {
  applyElectronicPaymentStatusTransition,
  finalizeEvent,
  getAttemptsForOrder,
  getOrderForUpdate,
  releaseOrderReservationsTx,
  withDeadlockRetry,
  type DbClient,
} from '@likehoney/db'

import { auditMeta, recordAudit, type AuditActor } from '../audit'

const OPEN_OR_SUCCEEDED = new Set(['created', 'pending', 'succeeded'])

export interface ApplyOrderExpiryInput {
  orderId: string
  actor: AuditActor
  finalizeAsEvent?: { eventId: string }
}

export type ApplyOrderExpiryResult =
  | { outcome: 'expired' }
  | { outcome: 'already_expired' }
  | { outcome: 'not_eligible'; reason: string }

export async function applyOrderExpiryService(
  db: DbClient,
  input: ApplyOrderExpiryInput,
): Promise<ApplyOrderExpiryResult> {
  return withDeadlockRetry(() =>
    db.transaction(async (tx) => {
      const order = await getOrderForUpdate(tx, input.orderId)
      if (order === undefined) {
        throw new ValidationError('order not found for expiry', { orderId: input.orderId })
      }
      if (order.paymentMethod !== 'electronic') {
        throw new PaymentIntegrityConflictError({ reason: 'order is not electronic' })
      }

      if (
        order.status === 'cancelled' &&
        order.paymentStatus === 'expired' &&
        order.cancellationSource === 'system_payment_expiry'
      ) {
        if (input.finalizeAsEvent) {
          await finalizeEvent(tx, input.finalizeAsEvent.eventId, 'applied_order_expiry')
        }
        return { outcome: 'already_expired' as const }
      }

      if (order.status !== 'processing' || order.paymentStatus !== 'pending') {
        // Any other current shape (paid, delivering, completed, already
        // cancelled some other way) is not this service's business — no
        // mutation, no fabricated closure.
        return { outcome: 'not_eligible' as const, reason: 'order is not processing/pending' }
      }

      const attempts = await getAttemptsForOrder(tx, order.id)
      if (attempts.length === 0) {
        return { outcome: 'not_eligible' as const, reason: 'no payment attempt ever existed' }
      }
      if (attempts.some((a) => OPEN_OR_SUCCEEDED.has(a.status))) {
        return {
          outcome: 'not_eligible' as const,
          reason: 'an open or succeeded payment attempt still exists',
        }
      }

      const updated = await applyElectronicPaymentStatusTransition(
        tx,
        order.id,
        'processing',
        'pending',
        {
          status: 'cancelled',
          paymentStatus: 'expired',
          cancellationSource: 'system_payment_expiry',
          cancelledAt: new Date(),
          cancelledByStaffId: null,
          cancelledReason: null,
          inventoryRestoredOnCancel: null,
        },
      )
      if (updated === undefined) {
        throw new PaymentIntegrityConflictError({ reason: 'order expiry transition lost a race' })
      }

      await releaseOrderReservationsTx(tx, order.id, new Date())

      await recordAudit(
        tx,
        input.actor,
        'payment.order_expired',
        'order',
        order.id,
        auditMeta({ number: order.number, attemptCount: attempts.length }),
      )

      if (input.finalizeAsEvent) {
        await finalizeEvent(tx, input.finalizeAsEvent.eventId, 'applied_order_expiry')
      }

      return { outcome: 'expired' as const }
    }),
  )
}
