/**
 * Operational settings: delivery zones (affects COD fee display) and a typed
 * key/value store for store-wide flags (e.g. whether COD checkout is enabled).
 */
import { sql } from 'drizzle-orm'
import { check, index, pgTable } from 'drizzle-orm/pg-core'

export const deliveryZones = pgTable(
  'delivery_zones',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    /** Stable machine code, e.g. `RAMALLAH`. */
    code: t.varchar('code', { length: 32 }).notNull().unique(),
    nameEn: t.text('name_en').notNull(),
    nameAr: t.text('name_ar').notNull(),
    feeMinor: t.integer('fee_minor').notNull().default(0),
    isActive: t.boolean('is_active').notNull().default(true),
    displayOrder: t.integer('display_order').notNull().default(0),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    index('delivery_zones_active_idx').on(t.isActive),
    check('delivery_zones_fee_nonnegative', sql`${t.feeMinor} >= 0`),
  ],
)

/**
 * Typed settings, one row per key. `value_json` holds validated JSON (Zod at
 * the service layer enforces the shape per key, e.g.
 * `checkout:cod.enabled` → `{"enabled":true}`).
 */
export const storeSettings = pgTable('store_settings', (t) => ({
  id: t.uuid('id').defaultRandom().primaryKey(),
  key: t.text('key').notNull().unique(),
  valueJson: t.text('value_json').notNull(),
  updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}))
