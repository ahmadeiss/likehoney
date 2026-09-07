/**
 * Gate B4 Stage 4 — INTERNAL payment-attempt retry service (§26/§27/§28/§29).
 *
 * No public HTTP endpoint exists for this (a guest order id/number is not an
 * authentication capability — public retry design is deferred to B5/storefront
 * with a proper opaque proof). This is service-level only, for verification
 * and future internal/Admin use.
 *
 * Reuses the order's EXISTING reservation (§28) — never creates a second one
 * or bumps `quantity_reserved` again. Reuses the provider LINEAGE of the
 * order's first attempt (§29) — never silently switches to whatever provider
 * happens to be configured today.
 */
import {
  PaymentAlreadySucceededError,
  PaymentAttemptActiveError,
  PaymentReconciliationPendingError,
  ValidationError,
} from '@likehoney/shared'
import {
  createAttempt,
  getAttemptsForOrder,
  getOrderForUpdate,
  listActiveOrderReservations,
  withDeadlockRetry,
  type DbClient,
} from '@likehoney/db'

import type { Env } from '../../env'
import { auditActor, auditMeta, recordAudit, type AuditActor } from '../audit'
import { runPhaseB, type ElectronicCheckoutResponse } from './checkout'
import { buildMerchantReference, deriveProviderIdempotencyKey } from './identifiers'
import { resolveProviderByCode } from './registry'

const OPEN_ATTEMPT_STATUSES = new Set(['created', 'pending'])

export async function retryElectronicPaymentService(
  db: DbClient,
  env: Env,
  orderId: string,
  actorStaffId?: string,
): Promise<ElectronicCheckoutResponse> {
  const actor: AuditActor = auditActor(actorStaffId)

  const prepared = await withDeadlockRetry(() =>
    db.transaction(async (tx) => {
      const order = await getOrderForUpdate(tx, orderId)
      if (order === undefined) throw new ValidationError('order not found', { orderId })

      if (
        order.paymentMethod !== 'electronic' ||
        order.status !== 'processing' ||
        order.paymentStatus !== 'pending'
      ) {
        throw new PaymentReconciliationPendingError({
          reason: 'order is not an open electronic order',
        })
      }
      if (order.idempotencyKey === null) {
        throw new ValidationError('order has no idempotency key to derive a retry identity from')
      }

      const reservations = await listActiveOrderReservations(tx, orderId)
      if (reservations.length === 0) {
        throw new PaymentReconciliationPendingError({
          reason: 'no active reservation for this order',
        })
      }
      // §15: every line's reservation was snapshotted with the same
      // reconcile_after at order creation — any one row is authoritative.
      const reconcileAfter = reservations[0]!.reconcileAfter
      if (Date.now() >= reconcileAfter.getTime()) {
        // §54: the reconciliation window has opened — no new attempt opens
        // concurrently with a possible authoritative expiry closing the order.
        throw new PaymentReconciliationPendingError({
          reason: 'reservation reconciliation window has already opened',
        })
      }

      const attempts = await getAttemptsForOrder(tx, orderId)
      if (attempts.some((a) => OPEN_ATTEMPT_STATUSES.has(a.status))) {
        throw new PaymentAttemptActiveError()
      }
      if (attempts.some((a) => a.status === 'succeeded')) {
        throw new PaymentAlreadySucceededError()
      }
      if (attempts.length === 0) {
        throw new ValidationError('no prior attempt exists to retry')
      }

      const providerLineage = attempts[0]!.provider
      const nextOrdinal = attempts.length + 1
      const providerIdemKey = await deriveProviderIdempotencyKey(order.idempotencyKey, nextOrdinal)

      const attempt = await createAttempt(tx, {
        orderId: order.id,
        provider: providerLineage,
        idempotencyKey: providerIdemKey,
        amountMinor: order.totalMinor,
        currency: order.currency,
      })

      await recordAudit(
        tx,
        actor,
        'payment.attempt_created',
        'order',
        order.id,
        auditMeta({
          number: order.number,
          retry: true,
          ordinal: nextOrdinal,
          provider: providerLineage,
        }),
      )

      return {
        order,
        attempt,
        merchantReference: buildMerchantReference(order.number, nextOrdinal),
        provider: providerLineage,
      }
    }),
  )

  return runPhaseB(
    db,
    env,
    prepared.order,
    prepared.attempt,
    prepared.merchantReference,
    actor,
    (e) => resolveProviderByCode(prepared.provider, e),
  )
}
