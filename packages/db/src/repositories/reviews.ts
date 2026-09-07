/**
 * Store / shopping-experience review data access (Reviews Gate V1).
 *
 * Thin query layer only — the "is this verified?" DECISION and all input
 * validation live in the API service. Every public submission is inserted
 * `pending`; the public read path filters to `approved` exclusively. The
 * moderation writes are status-guarded conditional UPDATEs (§22): a repeated
 * approve or a stale-tab reject matches zero rows instead of corrupting state.
 */
import { and, avg, count, desc, eq, inArray } from 'drizzle-orm'

import type { DbClient } from '../client'
import { orders, storeReviews, storeSales } from '../schema'

export type StoreReviewRow = typeof storeReviews.$inferSelect
export type StoreReviewNew = typeof storeReviews.$inferInsert

export type ReviewStatus = 'pending' | 'approved' | 'rejected'
export type ReviewVerifiedSource = 'online_order' | 'store_sale'

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

/**
 * Inserts one review. Callers MUST pass `status: 'pending'` — there is no
 * code path anywhere that inserts another status (§9). `verifiedPurchase` /
 * `verifiedSource` are whatever the server derived; the client never supplies
 * them.
 */
export async function insertStoreReview(
  db: DbClient,
  values: Omit<StoreReviewNew, 'status'> & { status: 'pending' },
): Promise<StoreReviewRow> {
  const rows = await db.insert(storeReviews).values(values).returning()
  return rows[0] as StoreReviewRow
}

// ---------------------------------------------------------------------------
// Public read (approved only)
// ---------------------------------------------------------------------------

/** Approved reviews only, newest-approved first (§23). `limit` is bounded by the service. */
export async function listApprovedReviews(db: DbClient, limit: number): Promise<StoreReviewRow[]> {
  return db
    .select()
    .from(storeReviews)
    .where(eq(storeReviews.status, 'approved'))
    .orderBy(desc(storeReviews.approvedAt), desc(storeReviews.createdAt))
    .limit(limit)
}

/** Count + average rating over APPROVED reviews only (§24). Zero → `{ count: 0, average: null }`. */
export async function getApprovedReviewSummary(
  db: DbClient,
): Promise<{ count: number; average: number | null }> {
  const rows = await db
    .select({ n: count(), avg: avg(storeReviews.rating) })
    .from(storeReviews)
    .where(eq(storeReviews.status, 'approved'))
  const n = Number(rows[0]?.n ?? 0)
  const avgRaw = rows[0]?.avg
  return { count: n, average: n > 0 && avgRaw != null ? Number(avgRaw) : null }
}

// ---------------------------------------------------------------------------
// Admin read
// ---------------------------------------------------------------------------

export async function getStoreReviewById(
  db: DbClient,
  id: string,
): Promise<StoreReviewRow | undefined> {
  const rows = await db.select().from(storeReviews).where(eq(storeReviews.id, id)).limit(1)
  return rows[0]
}

/** Admin moderation queue — optional status filter, newest first, offset paged. */
export async function listStoreReviewsForAdmin(
  db: DbClient,
  opts: { status?: ReviewStatus; page: number; pageSize: number },
): Promise<{ rows: StoreReviewRow[]; total: number }> {
  const where = opts.status ? eq(storeReviews.status, opts.status) : undefined

  const totalRows = await db.select({ n: count() }).from(storeReviews).where(where)
  const total = Number(totalRows[0]?.n ?? 0)

  const rows = await db
    .select()
    .from(storeReviews)
    .where(where)
    .orderBy(desc(storeReviews.createdAt), desc(storeReviews.id))
    .limit(opts.pageSize)
    .offset((opts.page - 1) * opts.pageSize)

  return { rows, total }
}

/** Per-status counts for the Admin filter chips / optional nav badge (§18/§40). */
export async function getReviewStatusCounts(db: DbClient): Promise<Record<ReviewStatus, number>> {
  const rows = await db
    .select({ status: storeReviews.status, n: count() })
    .from(storeReviews)
    .groupBy(storeReviews.status)
  const out: Record<ReviewStatus, number> = { pending: 0, approved: 0, rejected: 0 }
  for (const r of rows) out[r.status as ReviewStatus] = Number(r.n)
  return out
}

// ---------------------------------------------------------------------------
// Moderation — status-guarded conditional updates (§15, §22)
// ---------------------------------------------------------------------------

/**
 * Moves a review to `approved` ONLY if it is currently in one of
 * `allowedFrom`. Returns the updated row, or `undefined` when the guard
 * matched nothing (already approved, already rejected without the correction
 * being allowed, or the row vanished). Stamps the moderator, `moderatedAt`
 * and `approvedAt`; clears `rejectedAt` when correcting a rejection.
 */
export async function approveReviewGuarded(
  db: DbClient,
  id: string,
  moderatorStaffId: string,
  note: string | null,
  allowedFrom: ReviewStatus[],
): Promise<StoreReviewRow | undefined> {
  const now = new Date()
  const rows = await db
    .update(storeReviews)
    .set({
      status: 'approved',
      moderatedByStaffId: moderatorStaffId,
      moderatedAt: now,
      approvedAt: now,
      rejectedAt: null,
      ...(note !== null ? { moderationNote: note } : {}),
      updatedAt: now,
    })
    .where(and(eq(storeReviews.id, id), inArray(storeReviews.status, allowedFrom)))
    .returning()
  return rows[0]
}

/**
 * Moves a review to `rejected` ONLY if it is currently in one of
 * `allowedFrom`. Returns the updated row or `undefined` (guard matched
 * nothing). Stamps the moderator, `moderatedAt` and `rejectedAt`; clears
 * `approvedAt` when correcting an approval so a rejected review can never
 * remain publicly visible via stale state.
 */
export async function rejectReviewGuarded(
  db: DbClient,
  id: string,
  moderatorStaffId: string,
  note: string | null,
  allowedFrom: ReviewStatus[],
): Promise<StoreReviewRow | undefined> {
  const now = new Date()
  const rows = await db
    .update(storeReviews)
    .set({
      status: 'rejected',
      moderatedByStaffId: moderatorStaffId,
      moderatedAt: now,
      rejectedAt: now,
      approvedAt: null,
      ...(note !== null ? { moderationNote: note } : {}),
      updatedAt: now,
    })
    .where(and(eq(storeReviews.id, id), inArray(storeReviews.status, allowedFrom)))
    .returning()
  return rows[0]
}

// ---------------------------------------------------------------------------
// Verified-purchase evidence queries (server-side only — §10, §13)
// ---------------------------------------------------------------------------
//
// These read ONLY the immutable order/sale phone SNAPSHOT columns, never the
// mutable `customers` profile — verification is submission-time commercial
// evidence (§14) and must not shift if a profile is later edited. None of
// these ever surface order detail to a caller (§12/§13): the service turns
// them into a single boolean + a stable source marker.

/** True when a `completed` online order snapshots this normalized phone. */
export async function hasCompletedOnlineOrderForPhone(
  db: DbClient,
  phoneNormalized: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.customerPhoneNormalized, phoneNormalized), eq(orders.status, 'completed')))
    .limit(1)
  return rows.length > 0
}

/** True when any store sale snapshots this normalized phone (a store sale is always completed). */
export async function hasStoreSaleForPhone(
  db: DbClient,
  phoneNormalized: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: storeSales.id })
    .from(storeSales)
    .where(eq(storeSales.customerPhoneNormalized, phoneNormalized))
    .limit(1)
  return rows.length > 0
}

/**
 * Resolves a customer-supplied transaction reference (`LH-000123` online
 * order, or `LH-POS-000123` store sale) to its kind + snapshot phone +
 * completed flag — WITHOUT ever returning it to the caller. The service
 * only proceeds to `verified` when the resolved snapshot phone matches the
 * separately-supplied, separately-normalized phone (§12 — no bare-reference
 * verification, no enumeration oracle).
 */
export async function resolveTransactionReference(
  db: DbClient,
  reference: string,
): Promise<
  | { kind: 'online_order'; phoneNormalized: string; completed: boolean }
  | { kind: 'store_sale'; phoneNormalized: string | null; completed: boolean }
  | undefined
> {
  const orderRow = await db
    .select({ phone: orders.customerPhoneNormalized, status: orders.status })
    .from(orders)
    .where(eq(orders.number, reference))
    .limit(1)
  if (orderRow[0]) {
    return {
      kind: 'online_order',
      phoneNormalized: orderRow[0].phone,
      completed: orderRow[0].status === 'completed',
    }
  }

  const saleRow = await db
    .select({ phone: storeSales.customerPhoneNormalized })
    .from(storeSales)
    .where(eq(storeSales.number, reference))
    .limit(1)
  if (saleRow[0]) {
    return { kind: 'store_sale', phoneNormalized: saleRow[0].phone, completed: true }
  }

  return undefined
}
