/**
 * Checkout idempotency claims — the authoritative "has this exact logical
 * checkout already been submitted?" record.
 *
 * The claim row is inserted with `ON CONFLICT DO NOTHING RETURNING` as the FIRST
 * statement of the checkout transaction and updated to `completed` (with the new
 * order id + a safe replay payload) inside the SAME transaction. A committed
 * claim is therefore always `completed`; `in_progress` is only ever observed by
 * its own uncommitted transaction. A concurrent duplicate `INSERT` blocks on the
 * unique `claim_key` until this transaction commits (→ replay) or rolls back
 * (→ the duplicate becomes the owner). The guarantee lives in PostgreSQL, so it
 * holds across Cloudflare Worker isolates.
 *
 * `orders.idempotency_key` (partial UNIQUE) is the permanent commercial backstop:
 * even if this table were unavailable, the same key can never create order #2.
 * Completed claims linked to a real order are retained durably — never pruned.
 */
import { sql } from 'drizzle-orm'
import { check, index, pgTable } from 'drizzle-orm/pg-core'

import { orders } from './orders'

export const checkoutClaims = pgTable(
  'checkout_claims',
  (t) => ({
    /** Client-generated random idempotency key for one logical checkout submit. */
    claimKey: t.text('claim_key').primaryKey(),
    /** SHA-256 of the canonical logical checkout intent (see services/orders). */
    requestFingerprint: t.text('request_fingerprint').notNull(),
    status: t.text('status').notNull().default('in_progress'),
    orderId: t.uuid('order_id').references(() => orders.id, { onDelete: 'restrict' }),
    /** Safe committed replay payload (JSON). COD stores the full response. */
    resultJson: t.text('result_json'),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    index('checkout_claims_order_idx').on(t.orderId),
    check('checkout_claims_status_valid', sql`${t.status} in ('in_progress', 'completed')`),
  ],
)
