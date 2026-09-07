/**
 * Online guest order data access.
 *
 * Order creation is intentionally a service-transaction operation: the caller
 * inserts the order header + its item snapshots inside ONE `db.transaction`,
 * against the same `DbClient` that performs the atomic stock deductions. The
 * human order `number` is a stored generated column (`LH-000001`) computed by
 * PostgreSQL from the identity sequence — the service never populates it.
 */
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm'

import type { DbClient } from '../client'
import { orderItems, orders } from '../schema'

export type OrderRow = typeof orders.$inferSelect
export type OrderNew = typeof orders.$inferInsert
export type OrderItemRow = typeof orderItems.$inferSelect
export type OrderItemNew = typeof orderItems.$inferInsert

export interface NewOrderItemSnapshot {
  productId: string
  variantId: string
  skuSnapshot: string
  productNameEnSnapshot: string
  productNameArSnapshot: string
  variantLabelArSnapshot?: string | null
  variantLabelEnSnapshot?: string | null
  unitPriceMinor: number
  quantity: number
  lineTotalMinor: number
  /** Gate C sale-time snapshot fields — see `order_items` schema doc. */
  unitCostSnapshot?: number | null
  supplierIdSnapshot?: string | null
  supplierNameEnSnapshot?: string | null
  supplierNameArSnapshot?: string | null
  categoryIdSnapshot?: string | null
  categoryNameEnSnapshot?: string | null
  categoryNameArSnapshot?: string | null
}

export async function insertOrder(db: DbClient, values: OrderNew): Promise<OrderRow> {
  const rows = await db.insert(orders).values(values).returning()
  return rows[0] as OrderRow
}

export async function getOrderById(db: DbClient, id: string): Promise<OrderRow | undefined> {
  const rows = await db.select().from(orders).where(eq(orders.id, id)).limit(1)
  return rows[0]
}

export async function insertOrderItems(
  db: DbClient,
  orderId: string,
  items: NewOrderItemSnapshot[],
): Promise<OrderItemRow[]> {
  if (items.length === 0) return []
  const rows = await db
    .insert(orderItems)
    .values(
      items.map((item) => ({
        orderId,
        productId: item.productId,
        variantId: item.variantId,
        skuSnapshot: item.skuSnapshot,
        productNameEnSnapshot: item.productNameEnSnapshot,
        productNameArSnapshot: item.productNameArSnapshot,
        variantLabelArSnapshot: item.variantLabelArSnapshot ?? null,
        variantLabelEnSnapshot: item.variantLabelEnSnapshot ?? null,
        unitPriceMinor: item.unitPriceMinor,
        quantity: item.quantity,
        lineTotalMinor: item.lineTotalMinor,
        unitCostSnapshot: item.unitCostSnapshot ?? null,
        supplierIdSnapshot: item.supplierIdSnapshot ?? null,
        supplierNameEnSnapshot: item.supplierNameEnSnapshot ?? null,
        supplierNameArSnapshot: item.supplierNameArSnapshot ?? null,
        categoryIdSnapshot: item.categoryIdSnapshot ?? null,
        categoryNameEnSnapshot: item.categoryNameEnSnapshot ?? null,
        categoryNameArSnapshot: item.categoryNameArSnapshot ?? null,
      })),
    )
    .returning()
  return rows
}

export async function getOrderByNumber(
  db: DbClient,
  number: string,
): Promise<OrderRow | undefined> {
  const rows = await db.select().from(orders).where(eq(orders.number, number)).limit(1)
  return rows[0]
}

export async function listOrderItems(db: DbClient, orderId: string): Promise<OrderItemRow[]> {
  return db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.createdAt))
}

export async function listOrdersByIds(db: DbClient, orderIds: string[]): Promise<OrderRow[]> {
  if (orderIds.length === 0) return []
  return db.select().from(orders).where(inArray(orders.id, orderIds))
}

// ---------------------------------------------------------------------------
// Admin orders — lifecycle + keyset list (Gate B2)
// ---------------------------------------------------------------------------

/** Row-lock the order for a lifecycle transition (SELECT ... FOR UPDATE). */
export async function getOrderForUpdate(db: DbClient, id: string): Promise<OrderRow | undefined> {
  const rows = await db.select().from(orders).where(eq(orders.id, id)).limit(1).for('update')
  return rows[0]
}

/**
 * Atomic guarded status transition: updates only when the order is still in
 * `expectedStatus`. Returns the updated row, or `undefined` when no row matched
 * (a concurrent command already moved it — the caller maps that to
 * `invalid_order_transition`).
 */
export async function applyOrderTransition(
  db: DbClient,
  id: string,
  expectedStatus: OrderRow['status'],
  fields: Partial<OrderNew>,
): Promise<OrderRow | undefined> {
  const rows = await db
    .update(orders)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(orders.id, id), eq(orders.status, expectedStatus)))
    .returning()
  return rows[0]
}

/**
 * Gate B4 Stage 4 — guarded electronic PAYMENT-STATUS transition. Unlike
 * `applyOrderTransition` (which guards on `status` alone — enough for COD,
 * where a payment_status change always accompanies a status change), an
 * electronic success guards on `payment_status` while `status` stays
 * `processing`. Also requires `payment_method = 'electronic'` so this can
 * never be pointed at a COD order by mistake.
 */
export async function applyElectronicPaymentStatusTransition(
  db: DbClient,
  id: string,
  expectedStatus: OrderRow['status'],
  expectedPaymentStatus: OrderRow['paymentStatus'],
  fields: Partial<OrderNew>,
): Promise<OrderRow | undefined> {
  const rows = await db
    .update(orders)
    .set({ ...fields, updatedAt: new Date() })
    .where(
      and(
        eq(orders.id, id),
        eq(orders.paymentMethod, 'electronic'),
        eq(orders.status, expectedStatus),
        eq(orders.paymentStatus, expectedPaymentStatus),
      ),
    )
    .returning()
  return rows[0]
}

export interface AdminOrderListOptions {
  limit: number
  cursor?: { createdAt: Date; id: string }
  status?: OrderRow['status']
  paymentMethod?: OrderRow['paymentMethod']
  paymentStatus?: OrderRow['paymentStatus']
  createdFrom?: Date
  createdTo?: Date
  /** Exact order number (LH-000123). */
  number?: string
  /** Exact normalized phone. */
  phoneNormalized?: string
  /** Case-insensitive substring of the customer name snapshot. */
  nameContains?: string
}

/**
 * Keyset page over `(created_at DESC, id DESC)`. Fetches `limit + 1` to detect a
 * further page. Deterministic and stable across inserts.
 */
export async function listOrdersPage(
  db: DbClient,
  opts: AdminOrderListOptions,
): Promise<OrderRow[]> {
  const conds: SQL[] = []
  if (opts.status !== undefined) conds.push(eq(orders.status, opts.status))
  if (opts.paymentMethod !== undefined) conds.push(eq(orders.paymentMethod, opts.paymentMethod))
  if (opts.paymentStatus !== undefined) conds.push(eq(orders.paymentStatus, opts.paymentStatus))
  if (opts.createdFrom !== undefined) conds.push(gte(orders.createdAt, opts.createdFrom))
  if (opts.createdTo !== undefined) conds.push(lte(orders.createdAt, opts.createdTo))
  if (opts.number !== undefined) conds.push(eq(orders.number, opts.number))
  if (opts.phoneNormalized !== undefined) {
    conds.push(eq(orders.customerPhoneNormalized, opts.phoneNormalized))
  }
  if (opts.nameContains !== undefined && opts.nameContains.length > 0) {
    const like = `%${opts.nameContains}%`
    conds.push(or(ilike(orders.customerNameAr, like), ilike(orders.customerNameEn, like)) as SQL)
  }
  if (opts.cursor !== undefined) {
    conds.push(
      sql`(${orders.createdAt}, ${orders.id}) < (${opts.cursor.createdAt.toISOString()}::timestamptz, ${opts.cursor.id}::uuid)`,
    )
  }

  return db
    .select()
    .from(orders)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(opts.limit + 1)
}

/** Item + unit counts per order id (for the list `itemCount`). */
export async function getOrderItemCounts(
  db: DbClient,
  orderIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (orderIds.length === 0) return out
  const rows = await db
    .select({ orderId: orderItems.orderId, lines: count() })
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds))
    .groupBy(orderItems.orderId)
  for (const r of rows) out.set(r.orderId, Number(r.lines))
  return out
}

export async function listOrderItemsForOrders(
  db: DbClient,
  orderIds: string[],
): Promise<OrderItemRow[]> {
  if (orderIds.length === 0) return []
  return db
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds))
    .orderBy(asc(orderItems.createdAt))
}
