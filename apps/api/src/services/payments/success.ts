/**
 * Gate B4 Stage 4 — THE canonical authoritative payment-success transaction
 * (§19/§42). Every success source converges here: synchronous provider-create
 * success, verified webhook success, and reconciliation lookup success. No
 * parallel/weaker success path exists anywhere else in the codebase.
 *
 * Preconditions enforced inside the transaction (never trusted from the
 * caller alone):
 *  - provider identity known
 *  - provider-CONFIRMED amountMinor/currency match payment + order truth
 *  - the attempt belongs to an electronic processing/pending order
 *  - the attempt is still created|pending (never re-applies to a terminal one)
 *
 * Transaction order: order → payment attempt → reservations/inventory
 * (via `commitOrderReservationsTx`) → audit → (if from a webhook) finalize the
 * event LAST. Idempotent: replaying an already-succeeded attempt is a safe
 * no-op (§43) — the unique `inventory_movements_online_order_uq` index is the
 * final defence against a second deduction even if every application-level
 * guard were somehow bypassed.
 */
import { PaymentIntegrityConflictError, ValidationError } from '@likehoney/shared'
import {
  applyElectronicPaymentStatusTransition,
  commitOrderReservationsTx,
  finalizeEvent,
  getAttemptById,
  getOrderForUpdate,
  setProviderPaymentId,
  transitionAttempt,
  withDeadlockRetry,
  type DbClient,
  type PaymentAttemptRow,
} from '@likehoney/db'

import { auditMeta, recordAudit, type AuditActor } from '../audit'

export interface ConfirmedFinancials {
  providerPaymentId: string
  amountMinor: number
  currency: string
}

export interface ApplyPaymentSuccessInput {
  orderId: string
  paymentAttemptId: string
  provider: string
  confirmed: ConfirmedFinancials
  /** Server time to record as the authoritative confirmation instant. */
  authoritativeAt: Date
  actor: AuditActor
  /** Set only when called from webhook Phase B — finalizes that event LAST, in the same transaction. */
  finalizeAsEvent?: { eventId: string }
}

export type ApplyPaymentSuccessResult = { outcome: 'applied' } | { outcome: 'already_succeeded' }

/**
 * Apply an authoritative success. Runs its own `db.transaction` (bounded
 * 40P01/40001 retry only — the whole callback is side-effect-free to replay).
 */
export async function applyPaymentSuccessService(
  db: DbClient,
  input: ApplyPaymentSuccessInput,
): Promise<ApplyPaymentSuccessResult> {
  return withDeadlockRetry(() =>
    db.transaction(async (tx) => {
      const order = await getOrderForUpdate(tx, input.orderId)
      if (order === undefined) {
        throw new ValidationError('order not found for payment success', { orderId: input.orderId })
      }

      const attempt = await getAttemptById(tx, input.paymentAttemptId)
      if (attempt === undefined || attempt.orderId !== input.orderId) {
        throw new PaymentIntegrityConflictError({ reason: 'attempt does not belong to this order' })
      }
      if (attempt.provider !== input.provider) {
        throw new PaymentIntegrityConflictError({
          reason: 'provider mismatch on success application',
        })
      }

      // §43 idempotent replay: already fully applied — safe no-op.
      if (attempt.status === 'succeeded' && order.paymentStatus === 'paid') {
        if (input.finalizeAsEvent) {
          await finalizeEvent(tx, input.finalizeAsEvent.eventId, 'applied_success')
        }
        return { outcome: 'already_succeeded' as const }
      }

      if (attempt.status !== 'created' && attempt.status !== 'pending') {
        // A terminal non-success attempt cannot retroactively succeed — this
        // is the out-of-order-anomaly case (§56 documented assumption): once
        // an attempt is failed/expired it stays failed/expired forever, and a
        // later "success" for the SAME attempt id is rejected outright.
        throw new PaymentIntegrityConflictError({
          reason: 'attempt is already terminal and cannot become succeeded',
          attemptStatus: attempt.status,
        })
      }

      // §2 financial confirmation: must match BOTH the attempt's own snapshot
      // (set at insert from the order total — DB-guarded) and the order.
      if (
        input.confirmed.amountMinor !== attempt.amountMinor ||
        input.confirmed.currency !== attempt.currency ||
        input.confirmed.amountMinor !== order.totalMinor ||
        input.confirmed.currency !== order.currency
      ) {
        throw new PaymentIntegrityConflictError({
          reason: 'confirmed financials do not match order/attempt',
        })
      }

      if (attempt.providerPaymentId === null) {
        await setProviderPaymentId(tx, attempt.id, input.confirmed.providerPaymentId)
      } else if (attempt.providerPaymentId !== input.confirmed.providerPaymentId) {
        throw new PaymentIntegrityConflictError({ reason: 'provider payment id mismatch' })
      }

      const succeeded: PaymentAttemptRow | undefined = await transitionAttempt(
        tx,
        attempt.id,
        [attempt.status],
        'succeeded',
      )
      if (succeeded === undefined) {
        // Lost a race to another success applier — re-check below via replay.
        throw new PaymentIntegrityConflictError({ reason: 'attempt transition lost a race' })
      }

      const paidOrder = await applyElectronicPaymentStatusTransition(
        tx,
        order.id,
        'processing',
        'pending',
        { paymentStatus: 'paid' },
      )
      if (paidOrder === undefined) {
        throw new PaymentIntegrityConflictError({
          reason: 'order payment_status transition lost a race',
        })
      }

      const committed = await commitOrderReservationsTx(tx, order.id, input.authoritativeAt)
      if (committed === undefined) {
        throw new PaymentIntegrityConflictError({
          reason: 'reservation commit failed integrity guard',
        })
      }

      await recordAudit(
        tx,
        input.actor,
        'payment.succeeded',
        'order',
        order.id,
        auditMeta({
          number: order.number,
          paymentAttemptId: attempt.id,
          provider: input.provider,
          amountMinor: input.confirmed.amountMinor,
          currency: input.confirmed.currency,
        }),
      )

      if (input.finalizeAsEvent) {
        await finalizeEvent(tx, input.finalizeAsEvent.eventId, 'applied_success')
      }

      return { outcome: 'applied' as const }
    }),
  )
}
