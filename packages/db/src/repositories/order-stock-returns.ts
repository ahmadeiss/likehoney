/**
 * Delayed physical stock-return receipts — data access only. Business rules
 * (eligibility, remaining-quantity math, idempotency replay-vs-conflict,
 * locking) live in the service layer (apps/api); this file exposes the
 * primitive reads/writes it composes inside one transaction.
 */
import { asc, eq, inArray, sql } from 'drizzle-orm'

import type { DbClient, DbTx } from '../client'
import { orderStockReturnItems, orderStockReturns } from '../schema'

export type OrderStockReturnRow = typeof orderStockReturns.$inferSelect
export type OrderStockReturnItemRow = typeof orderStockReturnItems.$inferSelect

export interface NewOrderStockReturnLine {
  orderItemId: string
  variantId: string
  quantity: number
}

/** Look up a previously recorded receipt by its idempotency key (replay check). */
export async function getReturnByIdempotencyKey(
  db: DbClient,
  idempotencyKey: string,
): Promise<OrderStockReturnRow | undefined> {
  const rows = await db
    .select()
    .from(orderStockReturns)
    .where(eq(orderStockReturns.idempotencyKey, idempotencyKey))
    .limit(1)
  return rows[0]
}

/** Every receipt for an order, oldest first (chronological timeline display). */
export async function listReturnsForOrder(
  db: DbClient,
  orderId: string,
): Promise<OrderStockReturnRow[]> {
  return db
    .select()
    .from(orderStockReturns)
    .where(eq(orderStockReturns.orderId, orderId))
    .orderBy(asc(orderStockReturns.createdAt))
}

/** All line items across every receipt for an order — used to compute per-line "already returned". */
export async function listReturnItemsForOrder(
  db: DbClient,
  orderId: string,
): Promise<OrderStockReturnItemRow[]> {
  const returns = await db
    .select({ id: orderStockReturns.id })
    .from(orderStockReturns)
    .where(eq(orderStockReturns.orderId, orderId))
  if (returns.length === 0) return []
  return db
    .select()
    .from(orderStockReturnItems)
    .where(
      inArray(
        orderStockReturnItems.returnId,
        returns.map((r) => r.id),
      ),
    )
}

/** Line items for one specific receipt (used to render/replay a single receipt). */
export async function listItemsForReturn(
  db: DbClient,
  returnId: string,
): Promise<OrderStockReturnItemRow[]> {
  return db.select().from(orderStockReturnItems).where(eq(orderStockReturnItems.returnId, returnId))
}

/**
 * Insert the receipt header + its lines in one call. MUST run inside the
 * caller's transaction (`tx`), after the caller has locked whatever balances
 * it needs and validated remaining-quantity for every line — this function
 * performs no validation itself.
 */
export async function insertOrderStockReturn(
  tx: DbTx,
  values: {
    orderId: string
    idempotencyKey: string
    receivedByStaffId: string | null
    note: string | null
    lines: NewOrderStockReturnLine[]
  },
): Promise<{ receipt: OrderStockReturnRow; items: OrderStockReturnItemRow[] }> {
  const [receipt] = await tx
    .insert(orderStockReturns)
    .values({
      orderId: values.orderId,
      idempotencyKey: values.idempotencyKey,
      receivedByStaffId: values.receivedByStaffId,
      note: values.note,
    })
    .returning()
  if (receipt === undefined) throw new Error('order_stock_returns insert returned no row')

  const items = await tx
    .insert(orderStockReturnItems)
    .values(
      values.lines.map((line) => ({
        returnId: receipt.id,
        orderItemId: line.orderItemId,
        variantId: line.variantId,
        quantity: line.quantity,
      })),
    )
    .returning()

  return { receipt, items }
}

/**
 * Sum of everything already returned per `order_item_id`, for one order.
 * Used with `order_items.quantity` (and `inventory_restored_on_cancel`) to
 * compute each line's `remainingReturnableQuantity`.
 */
export async function sumReturnedQuantityByOrderItem(
  db: DbClient,
  orderId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      orderItemId: orderStockReturnItems.orderItemId,
      total: sql<number>`sum(${orderStockReturnItems.quantity})::int`,
    })
    .from(orderStockReturnItems)
    .innerJoin(orderStockReturns, eq(orderStockReturnItems.returnId, orderStockReturns.id))
    .where(eq(orderStockReturns.orderId, orderId))
    .groupBy(orderStockReturnItems.orderItemId)

  return new Map(rows.map((r) => [r.orderItemId, r.total]))
}
