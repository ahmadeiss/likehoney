/**
 * Stock reservation row data access (Gate B4).
 *
 * A `stock_reservations` row is an ORDER-LEVEL physical hold on one variant for
 * a pending electronic order (one row per order line). This layer performs
 * only `stock_reservations` row I/O — the paired `inventory_balances`
 * `quantity_reserved` / `quantity_on_hand` effects live in the transaction-only
 * primitives in `./inventory` (`reserveOrderStockTx`, `releaseOrderReservationsTx`,
 * `commitOrderReservationsTx`), which call into here inside ONE transaction.
 *
 * All state changes are guarded UPDATEs that return the affected rows; the
 * legal state graph, row-shape, monotonic counters and cross-entity checks are
 * enforced by `lh_reservations_*_guard` in `0008_b4_payment_integrity.sql`.
 * Ordering is `variant_id ASC` everywhere to hold the global lock order.
 */
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'

import type { DbClient } from '../client'
import { stockReservations } from '../schema'

export type StockReservationRow = typeof stockReservations.$inferSelect

export const ACTIVE_RESERVATION_STATES = ['held', 'reconciling'] as const

export interface NewReservationLine {
  variantId: string
  quantity: number
}

/**
 * Insert the `held` rows for an order's lines (sorted `variant_id ASC`). The
 * insert trigger validates the parent order is electronic/processing/pending
 * and that each line matches an order item of equal quantity.
 */
export async function insertHeldReservations(
  db: DbClient,
  orderId: string,
  lines: readonly NewReservationLine[],
  reconcileAfter: Date,
): Promise<StockReservationRow[]> {
  const ordered = [...lines].sort((a, b) =>
    a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
  )
  const rows = await db
    .insert(stockReservations)
    .values(
      ordered.map((line) => ({
        orderId,
        variantId: line.variantId,
        quantity: line.quantity,
        state: 'held' as const,
        reconcileAfter,
      })),
    )
    .returning()
  return rows
}

/** Every reservation for an order, `variant_id ASC`. */
export async function listOrderReservations(
  db: DbClient,
  orderId: string,
): Promise<StockReservationRow[]> {
  return db
    .select()
    .from(stockReservations)
    .where(eq(stockReservations.orderId, orderId))
    .orderBy(asc(stockReservations.variantId))
}

/** Active (`held` / `reconciling`) reservations for an order, `variant_id ASC`. */
export async function listActiveOrderReservations(
  db: DbClient,
  orderId: string,
): Promise<StockReservationRow[]> {
  return db
    .select()
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.orderId, orderId),
        inArray(stockReservations.state, [...ACTIVE_RESERVATION_STATES]),
      ),
    )
    .orderBy(asc(stockReservations.variantId))
}

/**
 * Reservation rows whose reconciliation window has opened, oldest first. The
 * sweep worker groups these by `order_id` and reconciles per order.
 */
export async function getReconciliationCandidates(
  db: DbClient,
  cutoff: Date,
  limit: number,
): Promise<StockReservationRow[]> {
  return db
    .select()
    .from(stockReservations)
    .where(
      and(
        inArray(stockReservations.state, [...ACTIVE_RESERVATION_STATES]),
        lte(stockReservations.reconcileAfter, cutoff),
      ),
    )
    .orderBy(asc(stockReservations.reconcileAfter), asc(stockReservations.variantId))
    .limit(limit)
}

/**
 * Move an order's `held` reservations to `reconciling`, bumping the attempt
 * counter and `last_reconciled_at`. Idempotent-ish: rows already `reconciling`
 * are left as-is (only `held` rows match). Returns the rows it advanced.
 */
export async function markOrderReservationsReconciling(
  db: DbClient,
  orderId: string,
): Promise<StockReservationRow[]> {
  const rows = await db
    .update(stockReservations)
    .set({
      state: 'reconciling',
      reconcileAttempts: sql`${stockReservations.reconcileAttempts} + 1`,
      lastReconciledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.state, 'held')))
    .returning()
  return rows
}

/**
 * Guarded terminal transition of every active reservation of an order to
 * `committed` or `released`, stamping the write-once `authoritative_terminal_at`.
 * Returns the affected rows (`variant_id ASC` via the caller's read); an empty
 * result means nothing was active (already terminal, or unknown order).
 *
 * The DB guard additionally requires the parent order to already be in the
 * matching shape (→committed: paid + a matching succeeded payment;
 * →released: expired / cancelled+system_payment_expiry), so the caller MUST
 * transition the order first inside the same transaction.
 */
export async function transitionActiveOrderReservations(
  db: DbClient,
  orderId: string,
  nextState: 'committed' | 'released',
  authoritativeTerminalAt: Date,
): Promise<StockReservationRow[]> {
  const rows = await db
    .update(stockReservations)
    .set({ state: nextState, authoritativeTerminalAt, updatedAt: new Date() })
    .where(
      and(
        eq(stockReservations.orderId, orderId),
        inArray(stockReservations.state, [...ACTIVE_RESERVATION_STATES]),
      ),
    )
    .returning()
  return rows
}
