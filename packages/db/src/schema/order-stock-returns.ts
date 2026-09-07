/**
 * Delayed physical stock-return receipts (final pre-provider correction,
 * Part B).
 *
 * A cancelled order and a physical return of merchandise to the store are
 * two distinct events — cancellation can happen while goods are still with a
 * courier. `orders.inventory_restored_on_cancel` already records the
 * all-or-nothing decision made AT cancellation time; it is never rewritten.
 * These two tables are the append-only record of merchandise that arrives
 * back at the store LATER, possibly across several partial deliveries.
 *
 * No money/payment/refund fields — this is a physical-inventory fact only.
 * `order_items` snapshots (name/SKU/variant/price) are never touched; a
 * receipt only ever restocks the exact variant originally deducted.
 */
import { sql } from 'drizzle-orm'
import { check, index, pgTable, unique, uniqueIndex } from 'drizzle-orm/pg-core'

import { orderItems, orders } from './orders'
import { productVariants } from './product-options'
import { staffUsers } from './staff'

export const orderStockReturns = pgTable(
  'order_stock_returns',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    orderId: t
      .uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    /** Client-generated key for ONE logical receipt submission. */
    idempotencyKey: t.text('idempotency_key').notNull(),
    receivedByStaffId: t
      .uuid('received_by_staff_id')
      .references(() => staffUsers.id, { onDelete: 'set null' }),
    note: t.text('note'),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    uniqueIndex('order_stock_returns_idempotency_key_uq').on(t.idempotencyKey),
    index('order_stock_returns_order_idx').on(t.orderId, t.createdAt),
  ],
)

export const orderStockReturnItems = pgTable(
  'order_stock_return_items',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    returnId: t
      .uuid('return_id')
      .notNull()
      .references(() => orderStockReturns.id, { onDelete: 'cascade' }),
    orderItemId: t
      .uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'restrict' }),
    variantId: t
      .uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    quantity: t.integer('quantity').notNull(),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    index('order_stock_return_items_return_idx').on(t.returnId),
    index('order_stock_return_items_order_item_idx').on(t.orderItemId),
    /** At most one line per (receipt, order line) — a receipt states each line once. */
    unique('order_stock_return_items_return_order_item_uq').on(t.returnId, t.orderItemId),
    check('order_stock_return_items_quantity_positive', sql`${t.quantity} > 0`),
  ],
)
