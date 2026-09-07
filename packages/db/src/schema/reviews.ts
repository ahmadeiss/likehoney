/**
 * Store / shopping-experience reviews (Reviews Gate V1).
 *
 * Feedback about the Like Honey shopping experience as a whole — NOT
 * per-product ratings, threads, replies, likes or media, and NOT a customer
 * account (there are none in V1). A visitor submits `display_name` +
 * `rating` + `review_text` and the row is ALWAYS created `pending`. Only an
 * Admin holding `reviews:moderate` can move it to `approved` (the single
 * status the public endpoint ever reads) or `rejected`. The Admin never
 * rewrites the customer's text — moderation is approve / reject only.
 *
 * `verified_purchase` is SERVER-DERIVED at submission time from immutable
 * commercial snapshots: a `completed` online order, or any store sale, whose
 * `customer_phone_normalized` matches the (canonically normalized) phone the
 * visitor optionally supplied — optionally pinned to one `submitted_reference`
 * (an `LH-…` order number or `LH-POS-…` sale number). It records
 * submission-time evidence and is never recomputed from mutable catalog data
 * afterwards. The private linkage columns below are NEVER exposed by the
 * public API.
 */
import { sql } from 'drizzle-orm'
import { check, index, pgTable } from 'drizzle-orm/pg-core'

import { customers } from './customers'
import { reviewStatus, reviewVerifiedSource } from './enums'
import { staffUsers } from './staff'

export const storeReviews = pgTable(
  'store_reviews',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),

    /** Customer-chosen public display name (shown verbatim on an approved card). */
    displayName: t.text('display_name').notNull(),
    /** Integer 1–5 (DB CHECK below); never 0, >5, negative or fractional. */
    rating: t.integer('rating').notNull(),
    /** Plain text only — rendered React-escaped, never as HTML. */
    reviewText: t.text('review_text').notNull(),

    status: reviewStatus('status').notNull().default('pending'),

    /**
     * Server-derived at submit time; the client can never set these. A
     * `true` value always carries a non-null `verified_source` (DB CHECK).
     */
    verifiedPurchase: t.boolean('verified_purchase').notNull().default(false),
    verifiedSource: reviewVerifiedSource('verified_source'),

    /**
     * PRIVATE — verification evidence. Never returned by the public API.
     * `customer_id` is a best-effort link to the internal CRM identity;
     * `submitted_phone_normalized` is the canonical form of the phone the
     * visitor typed; `submitted_reference` is the order/sale number they gave.
     */
    customerId: t.uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    submittedPhoneNormalized: t.text('submitted_phone_normalized'),
    submittedReference: t.text('submitted_reference'),

    /** PRIVATE — moderation trail (§53). Never returned by the public API. */
    moderatedByStaffId: t
      .uuid('moderated_by_staff_id')
      .references(() => staffUsers.id, { onDelete: 'set null' }),
    moderatedAt: t.timestamp('moderated_at', { withTimezone: true }),
    moderationNote: t.text('moderation_note'),
    approvedAt: t.timestamp('approved_at', { withTimezone: true }),
    rejectedAt: t.timestamp('rejected_at', { withTimezone: true }),

    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    /**
     * Public list (§23): `status = 'approved'` ORDER BY `approved_at` DESC,
     * `created_at` DESC. A plain composite covers it (Postgres reverse-scans);
     * also serves the approved count / average aggregates (§24).
     */
    index('store_reviews_status_approved_idx').on(t.status, t.approvedAt, t.createdAt),
    /** Admin moderation queue (§18) — filter by status, newest first. */
    index('store_reviews_status_created_idx').on(t.status, t.createdAt),
    check('store_reviews_rating_range', sql`${t.rating} between 1 and 5`),
    check(
      'store_reviews_verified_source_consistent',
      sql`(${t.verifiedPurchase} = false and ${t.verifiedSource} is null) or (${t.verifiedPurchase} = true and ${t.verifiedSource} is not null)`,
    ),
  ],
)
