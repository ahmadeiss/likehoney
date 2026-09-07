/**
 * Gate B4 Stage 4 — reconciliation service (§46-§51).
 *
 * Two bounded work queues per pass (§47):
 *   A. verified `payment_events` with `processed_at IS NULL`
 *   B. orders/reservations whose `reconcile_after <= now` and state is
 *      `held|reconciling`
 *
 * No provider network call ever happens inside a DB transaction (§48): load →
 * call the provider OUTSIDE any transaction → apply the result through the
 * same canonical services (`applyPaymentSuccessService`,
 * `applyAttemptTerminalService`, `applyOrderExpiryService`) every other
 * source uses, each of which locks the order first internally.
 *
 * `reconcile_after` never means "release" — only "start checking." Stock is
 * only ever released by `applyOrderExpiryService`, and only when EVERY
 * attempt is authoritative terminal non-success (§45/§52).
 */
import {
  getAttemptsForOrder,
  getChargeableOrSucceededAttemptForOrder,
  getOrderById,
  getReconciliationCandidates,
  listUnprocessedEvents,
  markOrderReservationsReconciling,
  type DbClient,
} from '@likehoney/db'

import type { Env } from '../../env'
import { auditActor, auditMeta, recordAudit } from '../audit'
import { applyAttemptTerminalService } from './attempt-terminal'
import { applyOrderExpiryService } from './expiry'
import { buildMerchantReference } from './identifiers'
import { resolveProviderByCode } from './registry'
import { applyPaymentSuccessService } from './success'
import { processPaymentEventService } from './webhook'

const SYSTEM_ACTOR = auditActor(undefined)
const DEFAULT_EVENT_BATCH = 50
const DEFAULT_ORDER_BATCH = 25

export interface ReconciliationSummary {
  eventsProcessed: number
  ordersReconciled: number
  errors: number
}

/** Queue A — bounded sweep of unprocessed webhook events. */
export async function reconcileUnprocessedEventsService(
  db: DbClient,
  limit = DEFAULT_EVENT_BATCH,
): Promise<number> {
  const events = await listUnprocessedEvents(db, limit)
  let processed = 0
  for (const event of events) {
    try {
      await processPaymentEventService(db, event)
      processed += 1
    } catch (err) {
      console.error('reconciliation: event processing failed', event.id, err)
    }
  }
  return processed
}

/** Queue B — bounded sweep of reservation candidates past their window. */
export async function reconcileReservationCandidatesService(
  db: DbClient,
  env: Env,
  limit = DEFAULT_ORDER_BATCH,
): Promise<number> {
  const candidates = await getReconciliationCandidates(db, new Date(), limit)
  const orderIds = [...new Set(candidates.map((r) => r.orderId))]
  let reconciled = 0
  for (const orderId of orderIds) {
    try {
      await reconcileOneOrder(db, env, orderId)
      reconciled += 1
    } catch (err) {
      console.error('reconciliation: order reconciliation failed', orderId, err)
    }
  }
  return reconciled
}

export async function runReconciliationPass(
  db: DbClient,
  env: Env,
): Promise<ReconciliationSummary> {
  const [eventsProcessed, ordersReconciled] = await Promise.all([
    reconcileUnprocessedEventsService(db, DEFAULT_EVENT_BATCH),
    reconcileReservationCandidatesService(db, env, DEFAULT_ORDER_BATCH),
  ])
  return { eventsProcessed, ordersReconciled, errors: 0 }
}

async function reconcileOneOrder(db: DbClient, env: Env, orderId: string): Promise<void> {
  const order = await getOrderById(db, orderId)
  if (order === undefined) return
  if (order.status !== 'processing' || order.paymentStatus !== 'pending') return // already resolved elsewhere

  // Bookkeeping bump — safe to no-op if already reconciling; monotonic counters.
  await markOrderReservationsReconciling(db, orderId)

  const attempts = await getAttemptsForOrder(db, orderId)
  const openOrSucceeded = await getChargeableOrSucceededAttemptForOrder(db, orderId)

  if (openOrSucceeded === undefined) {
    // No open/succeeded attempt — if every attempt is terminal non-success,
    // this is exactly the authoritative-expiry precondition.
    await applyOrderExpiryService(db, { orderId, actor: SYSTEM_ACTOR })
    return
  }

  if (openOrSucceeded.status === 'succeeded') {
    // A commit should already have followed a success; nothing to do here.
    return
  }

  const { provider, readiness } = resolveProviderByCode(openOrSucceeded.provider, env)
  if (provider === null) {
    // §51 — never route to another provider, never fail/expire/release on
    // adapter unavailability. Safer to keep waiting than invent truth.
    await recordAudit(
      db,
      SYSTEM_ACTOR,
      'payment.reconciliation_provider_unavailable',
      'order',
      orderId,
      auditMeta({ provider: openOrSucceeded.provider, blockers: readiness.blockers }),
    )
    return
  }

  const ordinal = attempts.findIndex((a) => a.id === openOrSucceeded.id) + 1
  const merchantReference = buildMerchantReference(order.number, ordinal > 0 ? ordinal : 1)

  let lookup: Awaited<ReturnType<typeof provider.getPaymentStatus>>
  try {
    lookup = await provider.getPaymentStatus({
      providerPaymentId: openOrSucceeded.providerPaymentId ?? undefined,
      idempotencyKey: openOrSucceeded.idempotencyKey,
      merchantReference,
      expectedAmountMinor: order.totalMinor,
      expectedCurrency: order.currency,
    })
  } catch (err) {
    console.error('reconciliation: provider lookup failed', orderId, err)
    return
  }

  switch (lookup.status) {
    case 'succeeded': {
      if (lookup.amountMinor === undefined || lookup.currency === undefined) {
        // §50/§71 — cannot apply success without confirmed financials.
        return
      }
      const providerPaymentId = lookup.providerPaymentId ?? openOrSucceeded.providerPaymentId
      if (providerPaymentId === null) return
      await applyPaymentSuccessService(db, {
        orderId,
        paymentAttemptId: openOrSucceeded.id,
        provider: openOrSucceeded.provider,
        confirmed: {
          providerPaymentId,
          amountMinor: lookup.amountMinor,
          currency: lookup.currency,
        },
        authoritativeAt: new Date(),
        actor: SYSTEM_ACTOR,
      })
      return
    }
    case 'failed':
    case 'expired': {
      await applyAttemptTerminalService(db, {
        orderId,
        paymentAttemptId: openOrSucceeded.id,
        provider: openOrSucceeded.provider,
        status: lookup.status,
        providerPaymentId: lookup.providerPaymentId,
        actor: SYSTEM_ACTOR,
      })
      // This attempt just became terminal non-success — try closing the
      // order now (safe no-op if any other attempt is still open).
      await applyOrderExpiryService(db, { orderId, actor: SYSTEM_ACTOR })
      return
    }
    case 'pending':
    case 'unknown':
    default:
      // Never release from pending/unknown (§45/§50). Just keep waiting.
      return
  }
}
