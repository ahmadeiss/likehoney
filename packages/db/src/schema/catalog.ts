/**
 * The product catalog: categories → products → media.
 *
 * Bilingual (Arabic-first / English) content lives inside a single row —
 * Never split language variants into separate rows.
 */
import { sql } from 'drizzle-orm'
import { check, index, pgTable, uniqueIndex } from 'drizzle-orm/pg-core'

import { entityStatus, mediaType, productStatus } from './enums'
import { suppliers } from './suppliers'

export const categories = pgTable(
  'categories',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    nameEn: t.text('name_en').notNull(),
    nameAr: t.text('name_ar').notNull(),
    slug: t.text('slug').notNull().unique(),
    /**
     * Stable uppercase ASCII code (2–4 letters ideal) embedded in SKUs, e.g.
     * `SHO`. It never changes once SKUs reference it. Falls back to `GEN`.
     */
    code: t.varchar('code', { length: 8 }).notNull().unique(),
    descriptionEn: t.text('description_en'),
    descriptionAr: t.text('description_ar'),
    status: entityStatus('status').notNull().default('active'),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    check('categories_code_format', sql`${t.code} ~ '^[A-Z0-9]{1,8}$'`),
    index('categories_status_idx').on(t.status),
  ],
)

export const products = pgTable(
  'products',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    /** Identity sequence used by the SKU standard: LH-{CODE}-{sequence}-{suffix}. */
    sequence: t.bigint('sequence', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
    categoryId: t.uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    supplierId: t.uuid('supplier_id').references(() => suppliers.id, { onDelete: 'restrict' }),
    nameEn: t.text('name_en').notNull(),
    nameAr: t.text('name_ar').notNull(),
    descriptionEn: t.text('description_en'),
    descriptionAr: t.text('description_ar'),
    shortBlurbEn: t.text('short_blurb_en'),
    shortBlurbAr: t.text('short_blurb_ar'),
    status: productStatus('status').notNull().default('draft'),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    index('products_category_idx').on(t.categoryId),
    index('products_supplier_idx').on(t.supplierId),
    index('products_status_idx').on(t.status),
  ],
)

export const productMedia = pgTable(
  'product_media',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    productId: t
      .uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    mediaType: mediaType('media_type').notNull().default('image'),
    /**
     * R2 object key only (with extension). Never a full signed URL — URLs are
     * minted by the backend at request time.
     */
    objectKey: t.text('object_key').notNull(),
    altEn: t.text('alt_en'),
    altAr: t.text('alt_ar'),
    sortOrder: t.integer('sort_order').notNull().default(0),
    isPrimary: t.boolean('is_primary').notNull().default(false),
    widthPx: t.integer('width_px'),
    heightPx: t.integer('height_px'),
    sizeBytes: t.bigint('size_bytes', { mode: 'number' }),
    mimeType: t.varchar('mime_type', { length: 100 }),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    index('product_media_product_order_idx').on(t.productId, t.sortOrder),
    /** Exactly one primary image per product. */
    uniqueIndex('product_media_primary_single_idx')
      .on(t.productId)
      .where(sql`${t.isPrimary} = true`),
    check('product_media_sort_nonnegative', sql`${t.sortOrder} >= 0`),
  ],
)
