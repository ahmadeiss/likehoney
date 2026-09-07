/**
 * Gate B4 — canonical payment / reservation vocabulary.
 *
 * ONE source of truth for every string union the payment + reservation domain
 * uses. The database enums (`packages/db/src/schema/enums.ts`), the repository
 * layer, the API services and (later) the Admin UI all import these — no
 * hand-retyped `'held' | 'reconciling' | ...` anywhere else.
 *
 * These mirror the DB enums exactly; the transition graphs mirror the DB
 * trigger guards (`0008_b4_payment_integrity.sql`). The DB is still the
 * authority — these let callers fail fast and stay in sync by construction.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Order-level facts
// ---------------------------------------------------------------------------

/** How an order is (or will be) paid. `electronic` is provider-agnostic. */
export const PAYMENT_METHODS = ['cod', 'electronic'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export const paymentMethodSchema = z.enum(PAYMENT_METHODS)

/**
 * The order's own payment state (`orders.payment_status`).
 * - `unpaid`  COD order, nothing collected yet (collected on delivery).
 * - `pending` electronic order awaiting a conclusive provider result.
 * - `paid`    a succeeded payment is on file (COD: collected; electronic: captured).
 * - `expired` electronic order whose payment window closed with no success.
 */
export const ORDER_PAYMENT_STATUSES = ['unpaid', 'paid', 'pending', 'expired'] as const
export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUSES)[number]
export const orderPaymentStatusSchema = z.enum(ORDER_PAYMENT_STATUSES)

/**
 * Why an order was cancelled (`orders.cancellation_source`, write-once).
 * - `staff`                  a staff member cancelled it (COD flow, Gate B2).
 * - `system_payment_expiry`  the electronic payment window closed unpaid and
 *                            the reconciliation worker cancelled it.
 */
export const CANCELLATION_SOURCES = ['staff', 'system_payment_expiry'] as const
export type CancellationSource = (typeof CANCELLATION_SOURCES)[number]
export const cancellationSourceSchema = z.enum(CANCELLATION_SOURCES)

// ---------------------------------------------------------------------------
// Payment attempt (`payments.status`)
// ---------------------------------------------------------------------------

/**
 * One logical charge attempt against a provider.
 * - `created`   row inserted, provider not yet initialised.
 * - `pending`   provider initialised (redirect issued), awaiting outcome.
 * - `succeeded` provider confirmed capture. TERMINAL. Stays in the
 *               "chargeable-or-succeeded" set forever (no later attempt).
 * - `failed`    provider declined / abandoned. TERMINAL. Leaves the set → a
 *               fresh retry attempt may be created.
 * - `expired`   attempt window closed with no outcome. TERMINAL. Leaves the set.
 */
export const PAYMENT_ATTEMPT_STATUSES = [
  'created',
  'pending',
  'succeeded',
  'failed',
  'expired',
] as const
export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number]
export const paymentAttemptStatusSchema = z.enum(PAYMENT_ATTEMPT_STATUSES)

/** Attempt states that occupy the one-open-per-order partial unique index. */
export const CHARGEABLE_OR_SUCCEEDED_ATTEMPT_STATUSES = [
  'created',
  'pending',
  'succeeded',
] as const satisfies readonly PaymentAttemptStatus[]

export const TERMINAL_PAYMENT_ATTEMPT_STATUSES = [
  'succeeded',
  'failed',
  'expired',
] as const satisfies readonly PaymentAttemptStatus[]

export function isTerminalAttemptStatus(status: PaymentAttemptStatus): boolean {
  return (TERMINAL_PAYMENT_ATTEMPT_STATUSES as readonly string[]).includes(status)
}

/** Mirrors `lh_payments_transition_guard`: legal `status` moves. */
const PAYMENT_ATTEMPT_TRANSITIONS: Record<PaymentAttemptStatus, readonly PaymentAttemptStatus[]> = {
  created: ['pending', 'succeeded', 'failed', 'expired'],
  pending: ['succeeded', 'failed', 'expired'],
  succeeded: [],
  failed: [],
  expired: [],
}

export function canTransitionAttempt(
  from: PaymentAttemptStatus,
  to: PaymentAttemptStatus,
): boolean {
  return PAYMENT_ATTEMPT_TRANSITIONS[from].includes(to)
}

// ---------------------------------------------------------------------------
// Stock reservation (`stock_reservations.state`)
// ---------------------------------------------------------------------------

/**
 * An order-level physical hold on a variant for a pending electronic order.
 * - `held`        active hold; counts against `available_to_sell`.
 * - `reconciling` the sweep is checking the provider for this hold's order.
 * - `committed`   payment succeeded → the hold became a real deduction. TERMINAL.
 * - `released`    payment expired / order cancelled → the hold was returned. TERMINAL.
 */
export const STOCK_RESERVATION_STATES = ['held', 'reconciling', 'committed', 'released'] as const
export type StockReservationState = (typeof STOCK_RESERVATION_STATES)[number]
export const stockReservationStateSchema = z.enum(STOCK_RESERVATION_STATES)

export const ACTIVE_STOCK_RESERVATION_STATES = [
  'held',
  'reconciling',
] as const satisfies readonly StockReservationState[]

export const TERMINAL_STOCK_RESERVATION_STATES = [
  'committed',
  'released',
] as const satisfies readonly StockReservationState[]

export function isTerminalReservationState(state: StockReservationState): boolean {
  return (TERMINAL_STOCK_RESERVATION_STATES as readonly string[]).includes(state)
}

/** Mirrors `lh_reservations_transition_guard`: legal `state` moves. */
const STOCK_RESERVATION_TRANSITIONS: Record<
  StockReservationState,
  readonly StockReservationState[]
> = {
  held: ['reconciling', 'committed', 'released'],
  reconciling: ['committed', 'released'],
  committed: [],
  released: [],
}

export function canTransitionReservation(
  from: StockReservationState,
  to: StockReservationState,
): boolean {
  return STOCK_RESERVATION_TRANSITIONS[from].includes(to)
}

// ---------------------------------------------------------------------------
// Payment event processing outcome (`payment_events.outcome`, write-once)
// ---------------------------------------------------------------------------

/**
 * The conclusive result of handling a provider event. Set together with
 * `processed_at`; never rewritten by a duplicate delivery. `mismatch` is a
 * FINAL outcome (B1 ruling) — the event was linked to its payment by identity
 * but the amount/currency disagreed, so no business mutation was applied.
 */
/**
 * Gate B4 Stage 4 (§39 audit): a truthful, specific vocabulary — never
 * collapse a real state change into `noop`, and `unmatched` is never a final
 * outcome (an unmatched event stays `processed_at IS NULL`, eligible for
 * later scheduled re-matching once provider-init recovery links it).
 */
export const PAYMENT_EVENT_OUTCOMES = [
  /** created|pending → pending (no-op state, but explicitly recorded as applied). */
  'applied_pending',
  /** Routed through the canonical success service. */
  'applied_success',
  /** created|pending → failed for the linked attempt (not the order). */
  'applied_attempt_failed',
  /** created|pending → expired for the linked attempt (not the order). */
  'applied_attempt_expired',
  /** Triggered the authoritative order-level expiry transaction. */
  'applied_order_expiry',
  /** Verified event arrived but is stale relative to already-terminal local state. */
  'ignored_out_of_order',
  /** Verified event's status is `unknown` — provider truth still inconclusive. */
  'ignored_unknown_status',
  /** Linked to the correct payment by identity, but amount/currency disagreed. */
  'mismatch',
  /** Verified, processed, and conclusively required no state change. */
  'noop',
] as const
export type PaymentEventOutcome = (typeof PAYMENT_EVENT_OUTCOMES)[number]
export const paymentEventOutcomeSchema = z.enum(PAYMENT_EVENT_OUTCOMES)
