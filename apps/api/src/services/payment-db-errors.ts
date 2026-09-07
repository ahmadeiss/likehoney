/**
 * Gate B4 — translate raw PostgreSQL failures from the payment / reservation
 * writes into the stable, machine-coded `ServiceError`s the API edge already
 * knows how to render.
 *
 * Layering (Gate B4 Stage 3 audit): PostgreSQL SQLSTATE inspection and
 * constraint-name mapping are DB/API infrastructure concerns, not portable
 * domain contracts — `packages/shared` stays limited to stable domain errors,
 * service codes and provider-agnostic types. `packages/db` must not depend on
 * `@likehoney/shared` (it stays a thin, dependency-light data layer), so this
 * lives in `apps/api`, which already depends on both. Zero behavioural change
 * from the Stage-2 version — moved, not rewritten.
 *
 * The DB is the last line of defence: the `payments_one_open_per_order_uq`
 * partial unique index and the `lh_*_guard` triggers (custom SQLSTATEs
 * `LH001` / `LH002` / `LH003`) reject illegal writes even if a service race
 * slipped past the pre-checks. Those raw codes and their `RAISE` messages are
 * NEVER surfaced — only the mapped code + a safe `{ constraint }` hint.
 *
 * Usage: wrap the payment / reservation `db.transaction(...)` call and, in the
 * catch, `throw mapPaymentDbError(err, ctx) ?? err` — unknown errors bubble
 * unchanged.
 */
import {
  PaymentAlreadySucceededError,
  PaymentAttemptActiveError,
  PaymentIntegrityConflictError,
  ReservationConflictError,
} from '@likehoney/shared'

interface PgError {
  code: string
  constraint?: string
  table?: string
}

/**
 * Extract the PostgreSQL error shape. Drizzle wraps driver errors in a
 * `DrizzleQueryError` whose own `code` is undefined and whose real PG error is
 * on `.cause` (HTTP driver) — so walk the `cause` chain up to a small depth.
 */
function asPgError(err: unknown): PgError | null {
  let node: unknown = err
  for (let depth = 0; depth < 5 && node != null; depth += 1) {
    if (typeof node === 'object' && 'code' in node) {
      const code = (node as { code?: unknown }).code
      if (typeof code === 'string' && code.length > 0) {
        const constraint = (node as { constraint?: unknown }).constraint
        const table = (node as { table?: unknown }).table
        return {
          code,
          constraint: typeof constraint === 'string' ? constraint : undefined,
          table: typeof table === 'string' ? table : undefined,
        }
      }
    }
    node = typeof node === 'object' && node !== null ? (node as { cause?: unknown }).cause : null
  }
  return null
}

/** Custom SQLSTATEs raised by the Gate B3/B4 trigger guards. */
const LH_INTEGRITY_SQLSTATES = new Set(['LH001', 'LH002', 'LH003'])

const UNIQUE_VIOLATION = '23505'
const CHECK_VIOLATION = '23514'

export interface PaymentDbErrorContext {
  /**
   * For a `payments_one_open_per_order_uq` collision: whether authoritative
   * current truth (re-read AFTER the conflicting transaction settled) shows
   * the order already has a `succeeded` attempt. `true` →
   * `payment_already_succeeded`; `false` / absent → `payment_attempt_active`.
   * Never inferred from the attempted operation alone.
   */
  orderHasSucceededAttempt?: boolean
}

/**
 * Map a known payment / reservation DB failure to a stable `ServiceError`.
 * Returns `null` when the error is not a recognised integrity failure — the
 * caller should rethrow the original.
 */
export function mapPaymentDbError(err: unknown, ctx: PaymentDbErrorContext = {}): Error | null {
  const pg = asPgError(err)
  if (pg === null) return null

  if (LH_INTEGRITY_SQLSTATES.has(pg.code)) {
    // `lh_payments_insert_guard` raises LH003 (not the unique index) when the
    // order already has a succeeded attempt. When the caller has re-read
    // authoritative truth and confirmed that, it is "already paid", not a raw
    // integrity fault.
    if (pg.code === 'LH003' && ctx.orderHasSucceededAttempt === true) {
      return new PaymentAlreadySucceededError({ guard: pg.code })
    }
    return new PaymentIntegrityConflictError({ guard: pg.code })
  }

  if (pg.code === UNIQUE_VIOLATION) {
    switch (pg.constraint) {
      case 'payments_one_open_per_order_uq':
        return ctx.orderHasSucceededAttempt === true
          ? new PaymentAlreadySucceededError({ constraint: pg.constraint })
          : new PaymentAttemptActiveError({ constraint: pg.constraint })
      case 'payments_idempotency_key_uq':
      case 'payments_provider_ref_uq':
      case 'payment_events_provider_event_uq':
      case 'inventory_movements_online_order_uq':
        return new PaymentIntegrityConflictError({ constraint: pg.constraint })
      case 'stock_reservations_order_variant_uq':
        return new ReservationConflictError({ constraint: pg.constraint })
      default:
        return null
    }
  }

  if (pg.code === CHECK_VIOLATION) {
    const c = pg.constraint ?? ''
    if (c.startsWith('stock_reservations_') || c.startsWith('inventory_balances_reserved_')) {
      return new ReservationConflictError({ constraint: c })
    }
    if (
      c.startsWith('payments_') ||
      c.startsWith('payment_events_') ||
      c === 'orders_cancellation_source_valid'
    ) {
      return new PaymentIntegrityConflictError({ constraint: c })
    }
    return null
  }

  return null
}

/** True when the error is the one-open-attempt-per-order unique collision. */
export function isOpenAttemptUniqueViolation(err: unknown): boolean {
  const pg = asPgError(err)
  return pg?.code === UNIQUE_VIOLATION && pg.constraint === 'payments_one_open_per_order_uq'
}

/** True when the error is the duplicate-reservation-per-order-line collision. */
export function isDuplicateReservationViolation(err: unknown): boolean {
  const pg = asPgError(err)
  return pg?.code === UNIQUE_VIOLATION && pg.constraint === 'stock_reservations_order_variant_uq'
}
