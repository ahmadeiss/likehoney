/**
 * Product options (e.g. Size, Color) and the sellable variants they combine
 * into.
 *
 * - A product with no options gets exactly one default variant (suffix `DEF`).
 * - Every variant carries a unique SKU; a variant is only sellable when its
 *   status is `active` AND a SKU exists (sku is mandatory for every variant).
 */
import { sql } from 'drizzle-orm'
import { check, index, pgTable, primaryKey, unique } from 'drizzle-orm/pg-core'

import { products } from './catalog'
import { variantStatus } from './enums'

export const productOptions = pgTable(
  'product_options',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    productId: t
      .uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    nameEn: t.text('name_en').notNull(),
    nameAr: t.text('name_ar').notNull(),
    displayOrder: t.integer('display_order').notNull().default(0),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    index('product_options_product_order_idx').on(t.productId, t.displayOrder),
    check('product_options_display_order_nonnegative', sql`${t.displayOrder} >= 0`),
  ],
)

export const productOptionValues = pgTable(
  'product_option_values',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    optionId: t
      .uuid('option_id')
      .notNull()
      .references(() => productOptions.id, { onDelete: 'cascade' }),
    valueEn: t.text('value_en').notNull(),
    valueAr: t.text('value_ar').notNull(),
    /** Uppercase ASCII segment used to build the variant suffix, e.g. `PNK`. */
    code: t.varchar('code', { length: 8 }).notNull(),
    displayOrder: t.integer('display_order').notNull().default(0),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    unique('product_option_values_option_code_uq').on(t.optionId, t.code),
    index('product_option_values_option_order_idx').on(t.optionId, t.displayOrder),
    check('product_option_values_code_format', sql`${t.code} ~ '^[A-Z0-9]{1,8}$'`),
  ],
)

export const productVariants = pgTable(
  'product_variants',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    productId: t
      .uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /**
     * Unique per SKU standard: LH-{CATEGORY_CODE}-{PRODUCT_SEQUENCE}-{SUFFIX}.
     * Immutable once referenced by transactional records (order/store-sale
     * items and inventory movements snapshot it).
     */
    sku: t.varchar('sku', { length: 32 }).notNull().unique(),
    status: variantStatus('status').notNull().default('draft'),
    priceMinor: t.integer('price_minor').notNull(),
    /**
     * Gate C — CURRENT acquisition cost (COGS), variant-level since different
     * options may eventually cost differently. NULL = not configured, never
     * 0. Sale-time services snapshot this value into `unit_cost_snapshot` on
     * `order_items`/`store_sale_items` at the moment of sale — changing this
     * column later never rewrites an already-snapshotted historical line.
     */
    acquisitionCostMinor: t.integer('acquisition_cost_minor'),
    optionLabelEn: t.text('option_label_en'),
    optionLabelAr: t.text('option_label_ar'),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    index('product_variants_product_status_idx').on(t.productId, t.status),
    check('product_variants_price_nonnegative', sql`${t.priceMinor} >= 0`),
    check(
      'product_variants_acquisition_cost_nonnegative',
      sql`${t.acquisitionCostMinor} is null or ${t.acquisitionCostMinor} >= 0`,
    ),
    check(
      'product_variants_sku_format',
      sql`${t.sku} ~ '^LH-[A-Z0-9]{1,8}-[0-9]{6}-[A-Z0-9]{1,8}(-[A-Z0-9]{1,8})*$'`,
    ),
  ],
)

/**
 * Join table between a variant and its option values, e.g. variant Pink/30
 * → [Color: Pink, Size: 30]. Composite primary key — no surrogate id.
 */
export const productVariantOptions = pgTable(
  'product_variant_options',
  (t) => ({
    variantId: t
      .uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    optionValueId: t
      .uuid('option_value_id')
      .notNull()
      .references(() => productOptionValues.id, { onDelete: 'restrict' }),
  }),
  (t) => [primaryKey({ columns: [t.variantId, t.optionValueId] })],
)
