/**
 * Supplier companies Like Honey purchases stock from. The supplier is the
 * entity we buy goods from (not necessarily the manufacturer or the
 * consumer-facing brand) — see AGENTS.md business rules.
 *
 * Suppliers are soft-disabled (status), never deleted once referenced.
 */
import { sql } from 'drizzle-orm'
import { check, index, pgTable } from 'drizzle-orm/pg-core'

import { entityStatus } from './enums'
import { staffUsers } from './staff'

export const suppliers = pgTable(
  'suppliers',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    /** Display name: Arabic required (staff-facing), English optional. */
    nameAr: t.text('name_ar').notNull(),
    nameEn: t.text('name_en'),
    contactName: t.text('contact_name'),
    contactPhone: t.text('contact_phone'),
    address: t.text('address'),
    notes: t.text('notes'),
    status: entityStatus('status').notNull().default('active'),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [index('suppliers_status_idx').on(t.status)],
)

/**
 * One row per monthly payment made to a supplier. This is a minimal purchase
 * settlement record and is NOT an accounting system: no ledgers, journals,
 * charts of accounts or tax posting lives here (V1 boundary).
 */
export const supplierPaymentEntries = pgTable(
  'supplier_payment_entries',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    supplierId: t
      .uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    periodLabel: t.text('period_label').notNull(),
    amountPaidMinor: t.integer('amount_paid_minor').notNull(),
    currency: t.varchar('currency', { length: 3 }).notNull().default('ILS'),
    paidAt: t.timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
    notes: t.text('notes'),
    recordedByStaffId: t
      .uuid('recorded_by_staff_id')
      .references(() => staffUsers.id, { onDelete: 'set null' }),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    index('supplier_payments_supplier_idx').on(t.supplierId),
    check('supplier_payments_amount_nonnegative', sql`${t.amountPaidMinor} >= 0`),
  ],
)
