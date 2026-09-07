/**
 * Customer data — an internal CRM/business-history identity, NOT a customer
 * account. There are no logins, passwords, sessions or customer-facing
 * dashboards; guest checkout is unchanged. Gate C: a row is created/updated
 * for every transaction that carries a validly-normalizable phone (online
 * checkout or POS), independent of `consentToStoreData` — that flag governs
 * whether we may CONTACT the customer (marketing), not whether the business
 * may keep an internal record that a transaction happened (the order/sale
 * row already necessarily records the phone regardless). Orders/store-sales
 * snapshot everything they need at transaction time, so a later profile
 * change — or even the profile going `inactive` — never breaks historical
 * data.
 */
import { index, pgTable } from 'drizzle-orm/pg-core'

import { entityStatus } from './enums'

export const customers = pgTable(
  'customers',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    phoneNormalized: t.text('phone_normalized').notNull().unique(),
    firstNameEn: t.text('first_name_en'),
    firstNameAr: t.text('first_name_ar'),
    lastNameEn: t.text('last_name_en'),
    lastNameAr: t.text('last_name_ar'),
    birthDate: t.date('birth_date'),
    /**
     * Gate C — CURRENT known contact info only (§8). Updated to the latest
     * non-empty value from each new transaction; a historical order/store-sale
     * snapshot is NEVER read from these columns — see the immutable snapshot
     * columns on `orders`/`store_sales` instead.
     */
    cityEn: t.text('city_en'),
    cityAr: t.text('city_ar'),
    addressEn: t.text('address_en'),
    addressAr: t.text('address_ar'),
    /** First/last time this identity was seen across ANY channel (online or POS). */
    firstSeenAt: t.timestamp('first_seen_at', { withTimezone: true }),
    lastSeenAt: t.timestamp('last_seen_at', { withTimezone: true }),
    /** `inactive` = archived (§9 — never hard-deleted once referenced commercially). */
    status: entityStatus('status').notNull().default('active'),
    consentToStoreData: t.boolean('consent_to_store_data').notNull().default(false),
    consentToContact: t.boolean('consent_to_contact').notNull().default(false),
    consentGivenAt: t.timestamp('consent_given_at', { withTimezone: true }),
    note: t.text('note'),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    index('customers_consent_idx').on(t.consentToStoreData),
    index('customers_status_idx').on(t.status),
    index('customers_last_seen_idx').on(t.lastSeenAt),
  ],
)
