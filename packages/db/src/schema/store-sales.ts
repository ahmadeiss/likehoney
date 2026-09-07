/**
 * Physical-store sales recorded in-app (Cash on Delivery applies at the
 * register too). A store sale is instant and quantity-first: unit prices are
 * snapshot best-effort from the live catalog and are analytics/margin
 * material only — accuracy depends on manual entry (no POS terminal
 * integration in V1), see DATA_MODEL.md.
 *
 * `number` is the human-facing store-sale number (LH-POS-000001), computed by
 * PostgreSQL as a stored generated column from the identity-backed
 * `sequence` — non-null and unique by construction, mirroring the orders rule.
 */
import { sql } from 'drizzle-orm'
import { check, index, pgTable, unique } from 'drizzle-orm/pg-core'

import { categories, products } from './catalog'
import { customers } from './customers'
import { orders } from './orders'
import { productVariants } from './product-options'
import { staffUsers } from './staff'
import { suppliers } from './suppliers'

export const storeSales = pgTable(
  'store_sales',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    sequence: t.bigint('sequence', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
    number: t
      .text('number')
      .notNull()
      .unique()
      .generatedAlwaysAs(() => sql`('LH-POS-'::text || lpad(sequence::text, 6, '0'))`),
    staffId: t
      .uuid('staff_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'restrict' }),
    customerId: t.uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    /** Gate C — sale-time customer snapshot (§18), immutable once written.
     *  Raw phone is what the employee actually typed; normalized is the
     *  identity-matching key. Null when the sale was rung up anonymously
     *  ("بيع بدون بيانات عميل") — never a fabricated "Walk-in" identity. */
    customerPhoneRawSnapshot: t.text('customer_phone_raw_snapshot'),
    customerPhoneNormalized: t.text('customer_phone_normalized'),
    customerNameEnSnapshot: t.text('customer_name_en_snapshot'),
    customerNameArSnapshot: t.text('customer_name_ar_snapshot'),
    customerCityEnSnapshot: t.text('customer_city_en_snapshot'),
    customerCityArSnapshot: t.text('customer_city_ar_snapshot'),
    customerAddressEnSnapshot: t.text('customer_address_en_snapshot'),
    customerAddressArSnapshot: t.text('customer_address_ar_snapshot'),
    /** Set when the store sale fulfills an online order (e.g. store pickup). */
    orderId: t.uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    subtotalMinor: t.integer('subtotal_minor').notNull().default(0),
    totalMinor: t.integer('total_minor').notNull(),
    currency: t.varchar('currency', { length: 3 }).notNull().default('ILS'),
    note: t.text('note'),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    index('store_sales_staff_idx').on(t.staffId),
    index('store_sales_created_idx').on(t.createdAt),
    index('store_sales_order_idx').on(t.orderId),
    check('store_sales_subtotal_nonnegative', sql`${t.subtotalMinor} >= 0`),
    check('store_sales_total_nonnegative', sql`${t.totalMinor} >= 0`),
  ],
)

export const storeSaleItems = pgTable(
  'store_sale_items',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    storeSaleId: t
      .uuid('store_sale_id')
      .notNull()
      .references(() => storeSales.id, { onDelete: 'cascade' }),
    productId: t
      .uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    variantId: t
      .uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    skuSnapshot: t.varchar('sku_snapshot', { length: 32 }).notNull(),
    productNameEnSnapshot: t.text('product_name_en_snapshot').notNull(),
    productNameArSnapshot: t.text('product_name_ar_snapshot').notNull(),
    variantLabelArSnapshot: t.text('variant_label_ar_snapshot'),
    variantLabelEnSnapshot: t.text('variant_label_en_snapshot'),
    unitPriceMinor: t.integer('unit_price_minor').notNull(),
    quantity: t.integer('quantity').notNull(),
    /**
     * Acquisition cost at sale time (COGS). NULL = "unknown / not captured",
     * never 0. Gate C: populated from `product_variants.acquisition_cost_minor`
     * at insert time when configured; never backfilled for pre-existing rows.
     */
    unitCostSnapshot: t.integer('unit_cost_snapshot'),
    /** Gate C (§33/§34) — same sale-time snapshot rule as `order_items`. */
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
    index('store_sale_items_sale_idx').on(t.storeSaleId),
    index('store_sale_items_variant_idx').on(t.variantId),
    index('store_sale_items_supplier_snapshot_idx').on(t.supplierIdSnapshot),
    index('store_sale_items_category_snapshot_idx').on(t.categoryIdSnapshot),
    unique('store_sale_items_sale_variant_uq').on(t.storeSaleId, t.variantId),
    check('store_sale_items_quantity_positive', sql`${t.quantity} > 0`),
    check('store_sale_items_unit_price_nonnegative', sql`${t.unitPriceMinor} >= 0`),
    check(
      'store_sale_items_unit_cost_nonnegative',
      sql`${t.unitCostSnapshot} is null or ${t.unitCostSnapshot} >= 0`,
    ),
  ],
)
