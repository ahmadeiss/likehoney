/**
 * Online guest orders (Cash on Delivery only in V1).
 *
 * Each order snapshots its customer, items, prices and delivery destination
 * at checkout time so later catalog changes never corrupt history. `number`
 * is the human-facing order number (LH-000001), computed by PostgreSQL as a
 * stored generated column from the identity-backed `sequence` — the database
 * guarantees it is non-null and unique, so no service layer has to remember
 * to populate it. Internal UUID (`id`) and human order sequence remain
 * separate concerns.
 */
import { sql } from 'drizzle-orm'
import { check, index, pgTable, unique, uniqueIndex } from 'drizzle-orm/pg-core'

import { categories, products } from './catalog'
import { customers } from './customers'
import { orderStatus, paymentMethod, paymentStatus } from './enums'
import { productVariants } from './product-options'
import { deliveryZones } from './settings'
import { staffUsers } from './staff'
import { suppliers } from './suppliers'

export const orders = pgTable(
  'orders',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    sequence: t.bigint('sequence', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
    number: t
      .text('number')
      .notNull()
      .unique()
      .generatedAlwaysAs(() => sql`('LH-'::text || lpad(sequence::text, 6, '0'))`),
    customerId: t.uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    customerPhoneNormalized: t.text('customer_phone_normalized').notNull(),
    customerNameEn: t.text('customer_name_en'),
    customerNameAr: t.text('customer_name_ar'),
    deliveryZoneId: t
      .uuid('delivery_zone_id')
      .references(() => deliveryZones.id, { onDelete: 'set null' }),
    /**
     * Immutable order-time delivery-zone snapshots. The FK above may be nulled
     * if the zone is later deleted; historical order detail must never depend on
     * today's zone name, so the code + bilingual name are captured at checkout.
     * `deliveryFeeMinor` below is likewise the immutable fee value.
     */
    deliveryZoneCodeSnapshot: t.text('delivery_zone_code_snapshot'),
    deliveryZoneNameArSnapshot: t.text('delivery_zone_name_ar_snapshot'),
    deliveryZoneNameEnSnapshot: t.text('delivery_zone_name_en_snapshot'),
    cityEn: t.text('city_en'),
    cityAr: t.text('city_ar'),
    addressLine1En: t.text('address_line1_en'),
    addressLine1Ar: t.text('address_line1_ar'),
    addressLine2En: t.text('address_line2_en'),
    addressLine2Ar: t.text('address_line2_ar'),
    deliveryFeeMinor: t.integer('delivery_fee_minor').notNull().default(0),
    subtotalMinor: t.integer('subtotal_minor').notNull().default(0),
    taxMinor: t.integer('tax_minor').notNull().default(0),
    totalMinor: t.integer('total_minor').notNull(),
    currency: t.varchar('currency', { length: 3 }).notNull().default('ILS'),
    status: orderStatus('status').notNull().default('processing'),
    paymentMethod: paymentMethod('payment_method').notNull().default('cod'),
    paymentStatus: paymentStatus('payment_status').notNull().default('unpaid'),
    vendorNote: t.text('vendor_note'),
    /** Historical customer intent — immutable after creation (DB trigger). */
    customerNote: t.text('customer_note'),
    /**
     * Fulfillment transition facts. Each is write-once (NULL → value; a later
     * DB trigger blocks value → different-value). `created_at` below is the
     * order-creation time; these are the exact server times of each business
     * transition, required for accurate period reporting later (Gate C).
     */
    deliveringAt: t.timestamp('delivering_at', { withTimezone: true }),
    completedAt: t.timestamp('completed_at', { withTimezone: true }),
    cancelledReason: t.text('cancelled_reason'),
    cancelledAt: t.timestamp('cancelled_at', { withTimezone: true }),
    /** Who cancelled — durable operational truth, not only audit metadata. */
    cancelledByStaffId: t
      .uuid('cancelled_by_staff_id')
      .references(() => staffUsers.id, { onDelete: 'set null' }),
    /**
     * NULL = not cancelled / not applicable. true = committed stock was restored
     * as part of cancellation. false = order cancelled but merchandise was NOT
     * restored at cancellation time (a later physical return is a separate
     * RESTOCK/RETURN movement — this decision is never rewritten).
     */
    inventoryRestoredOnCancel: t.boolean('inventory_restored_on_cancel'),
    /**
     * Discriminates *how* a cancelled order was closed (Gate B4). NULL for a
     * non-cancelled order. `'staff'` = COD manual cancellation (carries actor +
     * reason + restock decision). `'system_payment_expiry'` = electronic
     * pre-capture authoritative expiry (no staff actor, no reason, no physical
     * stock change — only the reservation was released). Write-once (DB guard).
     */
    cancellationSource: t.text('cancellation_source'),
    /**
     * Client-generated random key for ONE logical checkout submission. Partial
     * UNIQUE below is the permanent commercial backstop against duplicate order
     * creation (see checkout_claims). Nullable: historical rows have none.
     */
    idempotencyKey: t.text('idempotency_key'),
    /** SHA-256 of the canonical logical checkout intent used for that key. */
    requestFingerprint: t.text('request_fingerprint'),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    index('orders_status_created_idx').on(t.status, t.createdAt),
    index('orders_customer_phone_idx').on(t.customerPhoneNormalized),
    index('orders_customer_idx').on(t.customerId),
    /** Gate C reporting (§67/§70) — completed-sales date-range queries bucket
     *  by the actual completion instant, not creation time. */
    index('orders_completed_idx')
      .on(t.completedAt)
      .where(sql`${t.completedAt} is not null`),
    /** Keyset pagination for the Admin orders list (created_at DESC, id DESC). */
    index('orders_created_id_idx').on(t.createdAt, t.id),
    uniqueIndex('orders_idempotency_key_uq')
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    check('orders_delivery_fee_nonnegative', sql`${t.deliveryFeeMinor} >= 0`),
    check('orders_subtotal_nonnegative', sql`${t.subtotalMinor} >= 0`),
    check('orders_tax_nonnegative', sql`${t.taxMinor} >= 0`),
    check('orders_total_nonnegative', sql`${t.totalMinor} >= 0`),
    check(
      'orders_cancellation_source_valid',
      sql`${t.cancellationSource} is null or ${t.cancellationSource} in ('staff', 'system_payment_expiry')`,
    ),
  ],
)

export const orderItems = pgTable(
  'order_items',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    orderId: t
      .uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: t
      .uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    variantId: t
      .uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    /** Immutable SKU snapshot — survives later catalog changes. */
    skuSnapshot: t.varchar('sku_snapshot', { length: 32 }).notNull(),
    productNameEnSnapshot: t.text('product_name_en_snapshot').notNull(),
    productNameArSnapshot: t.text('product_name_ar_snapshot').notNull(),
    variantLabelArSnapshot: t.text('variant_label_ar_snapshot'),
    variantLabelEnSnapshot: t.text('variant_label_en_snapshot'),
    unitPriceMinor: t.integer('unit_price_minor').notNull(),
    quantity: t.integer('quantity').notNull(),
    lineTotalMinor: t.integer('line_total_minor').notNull(),
    /**
     * Acquisition cost at sale time (COGS). NULL means "unknown / not captured"
     * — NEVER interpret as 0. Gate C: populated from `product_variants.
     * acquisition_cost_minor` at insert time when configured; never backfilled
     * for pre-existing rows.
     */
    unitCostSnapshot: t.integer('unit_cost_snapshot'),
    /**
     * Gate C (§33/§34) — supplier/category SALE-TIME snapshot. The FK is
     * `set null` only so a later supplier/category deletion never blocks
     * (historical rows keep their bilingual name snapshot regardless); a
     * later reassignment of the product's CURRENT supplier/category must
     * never move this already-sold line into a different historical bucket.
     */
    supplierIdSnapshot: t
      .uuid('supplier_id_snapshot')
      .references(() => suppliers.id, { onDelete: 'set null' }),
    supplierNameEnSnapshot: t.text('supplier_name_en_snapshot'),
    supplierNameArSnapshot: t.text('supplier_name_ar_snapshot'),
    categoryIdSnapshot: t
      .uuid('category_id_snapshot')
      .references(() => categories.id, { onDelete: 'set null' }),
    categoryNameEnSnapshot: t.text('category_name_en_snapshot'),
    categoryNameArSnapshot: t.text('category_name_ar_snapshot'),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    index('order_items_order_idx').on(t.orderId),
    index('order_items_product_idx').on(t.productId),
    index('order_items_variant_idx').on(t.variantId),
    index('order_items_sku_snapshot_idx').on(t.skuSnapshot),
    index('order_items_supplier_snapshot_idx').on(t.supplierIdSnapshot),
    index('order_items_category_snapshot_idx').on(t.categoryIdSnapshot),
    unique('order_items_order_variant_uq').on(t.orderId, t.variantId),
    check('order_items_quantity_positive', sql`${t.quantity} > 0`),
    check('order_items_unit_price_nonnegative', sql`${t.unitPriceMinor} >= 0`),
    check('order_items_line_total_nonnegative', sql`${t.lineTotalMinor} >= 0`),
    check(
      'order_items_unit_cost_nonnegative',
      sql`${t.unitCostSnapshot} is null or ${t.unitCostSnapshot} >= 0`,
    ),
  ],
)
