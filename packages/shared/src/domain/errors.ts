/**
 * Service-layer errors shared by backend services and mapped to HTTP by the
 * API edge. Services never import HTTP types; they throw these portable,
 * machine-coded errors so any transport can translate them. `code` is stable
 * ASCII (Type D) — the UI localizes it for Arabic/English display.
 */
export class ServiceError extends Error {
  readonly status: number
  readonly serviceCode: string
  readonly details?: unknown

  constructor(status: number, serviceCode: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ServiceError'
    this.status = status
    this.serviceCode = serviceCode
    this.details = details
  }
}

export class NotFoundError extends ServiceError {
  constructor(message = 'resource not found', details?: unknown) {
    super(404, 'not_found', message, details)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends ServiceError {
  constructor(message = 'conflict with existing data', details?: unknown) {
    super(409, 'conflict', message, details)
    this.name = 'ConflictError'
  }
}

export class ValidationError extends ServiceError {
  constructor(message = 'validation failed', details?: unknown) {
    super(400, 'validation_error', message, details)
    this.name = 'ValidationError'
  }
}

export class UnprocessableError extends ServiceError {
  constructor(message = 'request cannot be processed', details?: unknown) {
    super(422, 'unprocessable', message, details)
    this.name = 'UnprocessableError'
  }
}

export class InsufficientStockError extends ServiceError {
  constructor(details?: unknown) {
    super(409, 'insufficient_stock', 'not enough stock on hand to fulfil the movement', details)
    this.name = 'InsufficientStockError'
  }
}

/**
 * Same idempotency key was already used for a materially different logical
 * checkout (different cart, quantities, zone, payment method, phone, name,
 * address, or note). The client must generate a new key for a changed submit.
 */
export class IdempotencyConflictError extends ServiceError {
  constructor(
    message = 'this idempotency key was used for a different request',
    details?: unknown,
  ) {
    super(409, 'idempotency_conflict', message, details)
    this.name = 'IdempotencyConflictError'
  }
}

/**
 * A concurrent submission with the same idempotency key is still being
 * processed (the claim INSERT hit the short lock timeout). Safe to retry.
 */
export class CheckoutProcessingError extends ServiceError {
  constructor(message = 'a matching checkout is still being processed; retry shortly') {
    super(409, 'checkout_processing', message)
    this.name = 'CheckoutProcessingError'
  }
}

/**
 * The authoritative server quote differs from the one the customer confirmed
 * (price and/or delivery fee changed). `details` carries the fresh quote; the
 * customer must reconfirm with the new `quoteFingerprint` and a new
 * `idempotencyKey`. No order, item, stock change or movement is created.
 */
export class CheckoutTotalsChangedError extends ServiceError {
  constructor(freshQuote: unknown, message = 'the total has changed since your quote') {
    super(409, 'checkout_totals_changed', message, freshQuote)
    this.name = 'CheckoutTotalsChangedError'
  }
}

/** The requested payment method is not currently enabled for checkout. */
export class PaymentMethodDisabledError extends ServiceError {
  constructor(method: string) {
    super(422, 'payment_method_disabled', `payment method is not available: ${method}`, { method })
    this.name = 'PaymentMethodDisabledError'
  }
}

// ---------------------------------------------------------------------------
// Order lifecycle (Gate B2)
// ---------------------------------------------------------------------------

/**
 * A guarded order status transition matched no row — the order is not in the
 * state the command requires (someone else moved it, or the command is not
 * valid for the current/terminal state).
 */
export class InvalidOrderTransitionError extends ServiceError {
  constructor(details?: unknown) {
    super(409, 'invalid_order_transition', 'the order is not in a state that allows this', details)
    this.name = 'InvalidOrderTransitionError'
  }
}

/** Cancel requested on an already-cancelled order. Never restores stock twice. */
export class OrderAlreadyCancelledError extends ServiceError {
  constructor() {
    super(409, 'order_already_cancelled', 'this order is already cancelled')
    this.name = 'OrderAlreadyCancelledError'
  }
}

/** Cancel requested but the order's state/payment does not allow cancellation. */
export class OrderNotCancellableError extends ServiceError {
  constructor(details?: unknown) {
    super(409, 'order_not_cancellable', 'this order cannot be cancelled', details)
    this.name = 'OrderNotCancellableError'
  }
}

/**
 * A `delivering → cancelled` request omitted the mandatory `restockReturnedItems`
 * decision — the server never infers whether merchandise physically returned.
 */
export class RestockDecisionRequiredError extends ServiceError {
  constructor() {
    super(
      400,
      'restock_decision_required',
      'restockReturnedItems (true|false) is required to cancel a delivering order',
    )
    this.name = 'RestockDecisionRequiredError'
  }
}

/**
 * The order's payment state is logically incompatible with the requested
 * lifecycle command (e.g. a processing COD order already marked paid). The
 * server refuses rather than silently "fixing" corrupt state.
 */
export class PaymentStateConflictError extends ServiceError {
  constructor(details?: unknown) {
    super(409, 'payment_state_conflict', 'the order payment state does not allow this', details)
    this.name = 'PaymentStateConflictError'
  }
}

// ---------------------------------------------------------------------------
// Electronic payment + stock reservation (Gate B4)
// ---------------------------------------------------------------------------
//
// Stable machine codes for the payment / reservation domain. Raw PostgreSQL
// SQLSTATEs (23505, 23514) and the custom LH001 / LH002 / LH003 codes raised by
// the DB trigger guards are NEVER surfaced — `mapPaymentDbError`
// (`apps/api/src/services/payment-db-errors.ts` — DB/API infrastructure, not a
// portable domain contract) translates the known ones into these.

/**
 * A new charge attempt was requested while a non-terminal attempt
 * (`created` / `pending`) already occupies the one-open-per-order slot.
 * The caller should reuse / advance the existing attempt, not create another.
 */
export class PaymentAttemptActiveError extends ServiceError {
  constructor(details?: unknown) {
    super(
      409,
      'payment_attempt_active',
      'this order already has an active payment attempt',
      details,
    )
    this.name = 'PaymentAttemptActiveError'
  }
}

/**
 * A charge attempt (or a second success) was requested on an order that
 * already has a `succeeded` payment. The order is paid; nothing more to do.
 */
export class PaymentAlreadySucceededError extends ServiceError {
  constructor(details?: unknown) {
    super(409, 'payment_already_succeeded', 'this order is already paid', details)
    this.name = 'PaymentAlreadySucceededError'
  }
}

/**
 * A payment / payment-event / reservation write violated a DB integrity guard
 * (illegal state transition, write-once field change, cross-entity mismatch).
 * The operation was rejected with no state change; this is not retryable.
 */
export class PaymentIntegrityConflictError extends ServiceError {
  constructor(details?: unknown) {
    super(
      409,
      'payment_integrity_conflict',
      'the payment record is not in a state that allows this',
      details,
    )
    this.name = 'PaymentIntegrityConflictError'
  }
}

/**
 * A reservation write lost a race or violated a reservation guard — a
 * duplicate hold for the same order line, or a hold that no longer matches
 * the order. Safe to re-read and decide again.
 */
export class ReservationConflictError extends ServiceError {
  constructor(details?: unknown) {
    super(409, 'reservation_conflict', 'the stock reservation could not be recorded', details)
    this.name = 'ReservationConflictError'
  }
}

/** A reservation the command expected to act on does not exist. */
export class ReservationNotFoundError extends ServiceError {
  constructor(details?: unknown) {
    super(404, 'reservation_not_found', 'stock reservation not found', details)
    this.name = 'ReservationNotFoundError'
  }
}

// ---------------------------------------------------------------------------
// Payment settings / provider readiness (Gate B4 Stage 3)
// ---------------------------------------------------------------------------

/** Attempted to enable electronic payment with no provider code configured. */
export class PaymentProviderNotConfiguredError extends ServiceError {
  constructor(details?: unknown) {
    super(422, 'payment_provider_not_configured', 'no payment provider is configured', details)
    this.name = 'PaymentProviderNotConfiguredError'
  }
}

/** A configured provider is not permitted in the current environment (TEST outside development). */
export class PaymentProviderNotAllowedError extends ServiceError {
  constructor(details?: unknown) {
    super(
      422,
      'payment_provider_not_allowed',
      'the configured payment provider is not allowed in this environment',
      details,
    )
    this.name = 'PaymentProviderNotAllowedError'
  }
}

/** A configured provider code is not recognized / implemented. */
export class PaymentProviderUnavailableError extends ServiceError {
  constructor(details?: unknown) {
    super(
      422,
      'payment_provider_unavailable',
      'the configured payment provider is unavailable',
      details,
    )
    this.name = 'PaymentProviderUnavailableError'
  }
}

/** Provider is fine, but the Stage-4 checkout/webhook/reconciliation infrastructure isn't ready. */
export class PaymentInfrastructureNotReadyError extends ServiceError {
  constructor(details?: unknown) {
    super(
      422,
      'payment_infrastructure_not_ready',
      'electronic payment infrastructure is not ready yet',
      details,
    )
    this.name = 'PaymentInfrastructureNotReadyError'
  }
}

/**
 * An internal retry was requested but the order/attempt/reservation state
 * does not allow opening a new attempt right now (active attempt exists,
 * succeeded attempt exists, reservation past its reconciliation window, or
 * the order is not an open electronic order). Safe to re-read and decide
 * again — never a hint to retry blindly.
 */
export class PaymentReconciliationPendingError extends ServiceError {
  constructor(details?: unknown) {
    super(
      409,
      'payment_reconciliation_pending',
      'this order is awaiting authoritative payment confirmation',
      details,
    )
    this.name = 'PaymentReconciliationPendingError'
  }
}

/** A settings write would leave zero payment methods actually available at checkout. */
export class NoPaymentMethodEnabledError extends ServiceError {
  constructor(details?: unknown) {
    super(
      409,
      'no_payment_method_enabled',
      'at least one payment method must remain available at checkout',
      details,
    )
    this.name = 'NoPaymentMethodEnabledError'
  }
}

// ---------------------------------------------------------------------------
// Delayed physical stock return (final pre-provider correction, Part B)
// ---------------------------------------------------------------------------

/** A return receipt was requested for an order that is not `cancelled`. */
export class OrderNotReturnEligibleError extends ServiceError {
  constructor(details?: unknown) {
    super(
      409,
      'order_not_return_eligible',
      'only a cancelled order can have physical stock recorded as returned',
      details,
    )
    this.name = 'OrderNotReturnEligibleError'
  }
}

/**
 * A requested return quantity (for one or more lines) exceeds that line's
 * `remainingReturnableQuantity`. The whole receipt is rejected — no partial
 * commit.
 */
export class ReturnQuantityExceedsRemainingError extends ServiceError {
  constructor(details?: unknown) {
    super(
      422,
      'return_quantity_exceeds_remaining',
      'a requested quantity exceeds what remains outstanding for that line',
      details,
    )
    this.name = 'ReturnQuantityExceedsRemainingError'
  }
}

/**
 * The same idempotency key was already used for a receipt with different
 * lines/quantities/order. The client must generate a new key for a genuinely
 * different submission; a byte-for-byte identical retry is replayed instead
 * of reaching this error.
 */
export class ReturnIdempotencyConflictError extends ServiceError {
  constructor(details?: unknown) {
    super(
      409,
      'return_idempotency_conflict',
      'this idempotency key was already used for a different return receipt',
      details,
    )
    this.name = 'ReturnIdempotencyConflictError'
  }
}

/** A receipt was submitted with no eligible lines (nothing outstanding to record). */
export class NoOutstandingReturnError extends ServiceError {
  constructor(details?: unknown) {
    super(
      422,
      'no_outstanding_return',
      'there is nothing outstanding to record for this order',
      details,
    )
    this.name = 'NoOutstandingReturnError'
  }
}

export class UnauthorizedError extends ServiceError {
  constructor(message = 'authentication required') {
    super(401, 'unauthorized', message)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends ServiceError {
  constructor(message = 'insufficient permissions') {
    super(403, 'forbidden', message)
    this.name = 'ForbiddenError'
  }
}
