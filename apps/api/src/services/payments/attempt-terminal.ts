/**
 * Gate B4 Stage 4 — apply a DEFINITIVE terminal non-success result
 * (`failed` | `expired`) to ONE payment attempt (§20/§44/§50).
 *
 * A single failed/expired attempt is NEVER order failure (§44) — the order
 * stays processing/pending and the reservation stays held/reconciling. Only
 * the authoritative order-expiry service (§52/§53), reading these same
 * terminal rows as its proof, may close the order.
 */
import { PaymentIntegrityConflictError, ValidationError } from '@likehoney/shared'
import {
  finalizeEvent,
  getAttemptById,
  getOrderForUpdate,
  setProviderPaymentId,
  transitionAttempt,
  withDeadlockRetry,
  type DbClient,
} from '@likehoney/db'

import { auditMeta, recordAudit, type AuditActor } from '../audit'

export interface ApplyAttemptTerminalInput {
  orderId: string
  paymentAttemptId: string
  provider: string
  status: 'failed' | 'expired'
  providerPaymentId?: string
  actor: AuditActor
  finalizeAsEvent?: { eventId: string }
}

export type ApplyAttemptTerminalResult = { outcome: 'applied' } | { outcome: 'already_terminal' }

export async function applyAttemptTerminalService(
  db: DbClient,
  input: ApplyAttemptTerminalInput,
): Promise<ApplyAttemptTerminalResult> {
  return withDeadlockRetry(() =>
    db.transaction(async (tx) => {
      const order = await getOrderForUpdate(tx, input.orderId)
      if (order === undefined) {
        throw new ValidationError('order not found', { orderId: input.orderId })
      }

      const attempt = await getAttemptById(tx, input.paymentAttemptId)
      if (attempt === undefined || attempt.orderId !== input.orderId) {
        throw new PaymentIntegrityConflictError({ reason: 'attempt does not belong to this order' })
      }
      if (attempt.provider !== input.provider) {
        throw new PaymentIntegrityConflictError({ reason: 'provider mismatch' })
      }

      if (attempt.status === input.status) {
        if (input.finalizeAsEvent) {
          const outcome =
            input.status === 'failed' ? 'applied_attempt_failed' : 'applied_attempt_expired'
          await finalizeEvent(tx, input.finalizeAsEvent.eventId, outcome)
        }
        return { outcome: 'already_terminal' as const }
      }
      if (
        attempt.status === 'succeeded' ||
        attempt.status === 'failed' ||
        attempt.status === 'expired'
      ) {
        // Already a DIFFERENT terminal state — never regress a succeeded
        // attempt, and never rewrite one terminal-non-success into another.
        throw new PaymentIntegrityConflictError({
          reason: 'attempt already terminal in a different state',
          current: attempt.status,
        })
      }

      if (input.providerPaymentId !== undefined && attempt.providerPaymentId === null) {
        await setProviderPaymentId(tx, attempt.id, input.providerPaymentId)
      }

      const updated = await transitionAttempt(tx, attempt.id, [attempt.status], input.status)
      if (updated === undefined) {
        throw new PaymentIntegrityConflictError({ reason: 'attempt transition lost a race' })
      }

      await recordAudit(
        tx,
        input.actor,
        input.status === 'failed' ? 'payment.attempt_failed' : 'payment.attempt_expired',
        'order',
        order.id,
        auditMeta({ number: order.number, paymentAttemptId: attempt.id, provider: input.provider }),
      )

      if (input.finalizeAsEvent) {
        const outcome =
          input.status === 'failed' ? 'applied_attempt_failed' : 'applied_attempt_expired'
        await finalizeEvent(tx, input.finalizeAsEvent.eventId, outcome)
      }

      return { outcome: 'applied' as const }
    }),
  )
}
