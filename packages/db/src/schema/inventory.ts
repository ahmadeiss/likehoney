/**
 * Inventory: a single shared stock pool per sellable variant.
 *
 * Online orders and physical-store sales both draw from the same
 * `inventory_balances.quantity_on_hand`. The inventory safety rules in
 * docs/architecture/INVENTORY_RULES.md are the authoritative contract:
 * - `inventory_balances` is the AUTHORITATIVE current operational stock
 *   state (a projection is never stored).
 * - `inventory_movements` is the immutable audit ledger explaining every
 *   change to a balance.
 * - Balancing services MUST write both tables in ONE PostgreSQL transaction;
 *   they are not independent sources of truth.
 * - All mutations are atomic; no read → subtract → write in memory; no
 *   overselling, no negative stock, no double deduction.
 *
 * V1 has NO stock reservation: cart does not touch stock; successful order
 * submission atomically deducts stock + writes a movement; cancellation
 * atomically restores stock + writes a movement. Reservation/expiration is
 * not modeled (deferred unless electronic payment is approved).
 */
import { sql } from 'drizzle-orm'
import { check, index, pgTable, unique, uniqueIndex } from 'drizzle-orm/pg-core'

import { inventoryMovementType } from './enums'
import { orders } from './orders'
import { productVariants } from './product-options'
import { staffUsers } from './staff'
import { storeSales } from './store-sales'

export const inventoryBalances = pgTable(
  'inventory_balances',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    variantId: t
      .uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    quantityOnHand: t.integer('quantity_on_hand').notNull().default(0),
    /**
     * Physical units held for pending electronic orders (Gate B4). NOT a
     * projection: `available_to_sell = quantity_on_hand - quantity_reserved` is
     * always derived, never stored. `quantity_on_hand` keeps its Gate-A meaning
     * (real physical stock).
     */
    quantityReserved: t.integer('quantity_reserved').notNull().default(0),
    updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    unique('inventory_balances_variant_uq').on(t.variantId),
    check('inventory_balances_on_hand_nonnegative', sql`${t.quantityOnHand} >= 0`),
    check('inventory_balances_reserved_nonnegative', sql`${t.quantityReserved} >= 0`),
    check(
      'inventory_balances_reserved_le_on_hand',
      sql`${t.quantityReserved} <= ${t.quantityOnHand}`,
    ),
  ],
)

/**
 * Append-only immutable audit ledger. Every change to a balance MUST be
 * recorded here in the same transaction that updates `inventory_balances`
 * (which remains the authoritative operational state). quantity_change > 0
 * adds stock, < 0 consumes stock.
 */
export const inventoryMovements = pgTable(
  'inventory_movements',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    variantId: t
      .uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    movementType: inventoryMovementType('movement_type').notNull(),
    quantityChange: t.integer('quantity_change').notNull(),
    /** Resulting quantity_on_hand after this movement — audit snapshot. */
    quantityAfter: t.integer('quantity_after'),
    reason: t.text('reason'),
    orderId: t.uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    storeSaleId: t.uuid('store_sale_id').references(() => storeSales.id, { onDelete: 'set null' }),
    staffId: t.uuid('staff_id').references(() => staffUsers.id, { onDelete: 'set null' }),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    index('inventory_movements_variant_created_idx').on(t.variantId, t.createdAt),
    index('inventory_movements_order_idx').on(t.orderId),
    index('inventory_movements_store_sale_idx').on(t.storeSaleId),
    index('inventory_movements_staff_idx').on(t.staffId),
    index('inventory_movements_type_idx').on(t.movementType),
    /**
     * Defence-in-depth for order cancellation (implemented in B2): a cancelled
     * order line may be restored to stock at most once. A later physical return
     * of the same merchandise is a separate RESTOCK / RETURN movement, not
     * another ORDER_CANCELLATION_RESTORE.
     */
    uniqueIndex('inventory_movements_order_cancel_restore_uq')
      .on(t.orderId, t.variantId)
      .where(sql`${t.movementType} = 'ORDER_CANCELLATION_RESTORE'`),
    /**
     * Gate B4 defence-in-depth: a checkout capture deduction (`ONLINE_ORDER`)
     * is written exactly once per order line — protects both COD checkout and
     * the electronic reservation-commit path against a duplicate deduction.
     */
    uniqueIndex('inventory_movements_online_order_uq')
      .on(t.orderId, t.variantId)
      .where(sql`${t.movementType} = 'ONLINE_ORDER'`),
    check('inventory_movements_change_nonzero', sql`${t.quantityChange} <> 0`),
    check('inventory_movements_after_nonnegative', sql`${t.quantityAfter} >= 0`),
  ],
)
