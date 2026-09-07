/**
 * Store / shopping-experience reviews — service layer (Reviews Gate V1).
 *
 * Responsibilities:
 *  - PUBLIC submit: canonicalize the optional phone with the ONE shared
 *    `normalizePhone`, derive `verifiedPurchase` SERVER-SIDE from immutable
 *    commercial evidence, and insert the row ALWAYS `pending` (§9). The
 *    response is deliberately generic — it never reveals whether verification
 *    succeeded or anything about an order (§13/§32).
 *  - PUBLIC read: approved reviews only, newest-approved first, plus an
 *    approved-only count/average summary (§23/§24).
 *  - ADMIN: list (status filter + counts), detail (Admin-only phone), and
 *    approve/reject as status-guarded, audited, idempotent-safe transitions
 *    (§15/§20/§21/§22/§53). The Admin never edits review text (§51); there is
 *    no delete (§52).
 */
import {
  normalizePhone,
  isValidNormalizedPhone,
  NotFoundError,
  ConflictError,
  type AdminReviewDetail,
  type AdminReviewListItem,
  type AdminReviewListQuery,
  type AdminReviewListResponse,
  type PublicReviewDoc,
  type PublicReviewListResponse,
  type PublicReviewSubmitInput,
} from '@likehoney/shared'
import {
  approveReviewGuarded,
  getApprovedReviewSummary,
  getCustomerByPhone,
  getReviewStatusCounts,
  getStoreReviewById,
  hasCompletedOnlineOrderForPhone,
  hasStoreSaleForPhone,
  insertStoreReview,
  listApprovedReviews,
  listStoreReviewsForAdmin,
  rejectReviewGuarded,
  resolveTransactionReference,
  type DbClient,
  type ReviewVerifiedSource,
  type StoreReviewRow,
} from '@likehoney/db'

import { auditActor, auditMeta, recordAudit } from './audit'

// ---------------------------------------------------------------------------
// Verified-purchase derivation (server-side only — §10/§11/§12/§13)
// ---------------------------------------------------------------------------

export interface DerivedVerification {
  verifiedPurchase: boolean
  verifiedSource: ReviewVerifiedSource | null
  /** Best-effort CRM link — recorded privately; NOT sufficient for verified (§11). */
  customerId: string | null
  /** Canonical form of whatever the visitor typed; `null` when unusable. */
  phoneNormalized: string | null
}

export interface VerificationEvidence {
  /** `970` + 9 digits, or `null` when the visitor gave no usable phone. */
  usablePhone: string | null
  customerId: string | null
  /** Result of resolving a supplied order/sale reference (undefined = none given / not found). */
  referenceResolved:
    { kind: ReviewVerifiedSource; phoneNormalized: string | null; completed: boolean } | undefined
  hasCompletedOnlineOrder: boolean
  hasStoreSale: boolean
}

/**
 * PURE decision (§10/§11/§12). A review is `verified` ONLY when the server can
 * point at a matching COMPLETED commercial transaction for the SAME normalized
 * phone the visitor supplied:
 *  - an explicit order/sale reference whose OWN snapshot phone equals that
 *    phone AND which is completed (a bare reference alone is never enough —
 *    §12, no enumeration oracle), or
 *  - a `completed` online order snapshotting that phone, or
 *  - any store sale snapshotting that phone (the register has no pending).
 * A linked CRM customer alone is NEVER sufficient (§11). Everything else →
 * `verifiedPurchase: false` (still stored, still `pending`).
 */
export function decideVerification(ev: VerificationEvidence): DerivedVerification {
  const base = { customerId: ev.customerId, phoneNormalized: ev.usablePhone }
  if (ev.usablePhone === null) {
    return { verifiedPurchase: false, verifiedSource: null, ...base }
  }
  if (
    ev.referenceResolved !== undefined &&
    ev.referenceResolved.completed &&
    ev.referenceResolved.phoneNormalized === ev.usablePhone
  ) {
    return { verifiedPurchase: true, verifiedSource: ev.referenceResolved.kind, ...base }
  }
  if (ev.hasCompletedOnlineOrder) {
    return { verifiedPurchase: true, verifiedSource: 'online_order', ...base }
  }
  if (ev.hasStoreSale) {
    return { verifiedPurchase: true, verifiedSource: 'store_sale', ...base }
  }
  return { verifiedPurchase: false, verifiedSource: null, ...base }
}

/** Gathers the commercial evidence (server-side only — §13) and decides. */
async function deriveVerification(
  db: DbClient,
  input: PublicReviewSubmitInput,
): Promise<DerivedVerification> {
  const phoneNormalized = input.phone !== undefined ? normalizePhone(input.phone) : null
  const usablePhone =
    phoneNormalized !== null && isValidNormalizedPhone(phoneNormalized) ? phoneNormalized : null

  if (usablePhone === null) {
    return decideVerification({
      usablePhone: null,
      customerId: null,
      referenceResolved: undefined,
      hasCompletedOnlineOrder: false,
      hasStoreSale: false,
    })
  }

  const customer = await getCustomerByPhone(db, usablePhone)
  const customerId = customer?.id ?? null

  const referenceResolved =
    input.orderReference !== undefined
      ? await resolveTransactionReference(db, input.orderReference.trim().toUpperCase())
      : undefined
  const settledByReference =
    referenceResolved !== undefined &&
    referenceResolved.completed &&
    referenceResolved.phoneNormalized === usablePhone

  const hasCompletedOnlineOrder = settledByReference
    ? false
    : await hasCompletedOnlineOrderForPhone(db, usablePhone)
  const hasStoreSale =
    settledByReference || hasCompletedOnlineOrder
      ? false
      : await hasStoreSaleForPhone(db, usablePhone)

  return decideVerification({
    usablePhone,
    customerId,
    referenceResolved,
    hasCompletedOnlineOrder,
    hasStoreSale,
  })
}

// ---------------------------------------------------------------------------
// PUBLIC — submit
// ---------------------------------------------------------------------------

/**
 * Creates ONE review, ALWAYS `pending`. Returns only `{ id, status }` —
 * generic by design (§13/§32): the caller learns nothing about verification
 * or any order.
 */
export async function submitPublicReviewService(
  db: DbClient,
  input: PublicReviewSubmitInput,
): Promise<{ id: string; status: 'pending' }> {
  const verification = await deriveVerification(db, input)

  const row = await insertStoreReview(db, {
    displayName: input.displayName,
    rating: input.rating,
    reviewText: input.reviewText,
    status: 'pending',
    verifiedPurchase: verification.verifiedPurchase,
    verifiedSource: verification.verifiedSource,
    customerId: verification.customerId,
    submittedPhoneNormalized: verification.phoneNormalized,
    submittedReference:
      input.orderReference !== undefined ? input.orderReference.trim().toUpperCase() : null,
  })

  return { id: row.id, status: 'pending' }
}

// ---------------------------------------------------------------------------
// PUBLIC — approved list + summary
// ---------------------------------------------------------------------------

function toPublicDoc(row: StoreReviewRow): PublicReviewDoc {
  return {
    id: row.id,
    displayName: row.displayName,
    rating: row.rating,
    reviewText: row.reviewText,
    verifiedPurchase: row.verifiedPurchase,
    createdAt: (row.approvedAt ?? row.createdAt).toISOString(),
  }
}

export async function listPublicApprovedReviewsService(
  db: DbClient,
  limit: number,
): Promise<PublicReviewListResponse> {
  const [rows, summary] = await Promise.all([
    listApprovedReviews(db, limit),
    getApprovedReviewSummary(db),
  ])
  return {
    data: rows.map(toPublicDoc),
    summary: {
      count: summary.count,
      average: summary.average === null ? null : Math.round(summary.average * 10) / 10,
    },
  }
}

// ---------------------------------------------------------------------------
// ADMIN — list / detail
// ---------------------------------------------------------------------------

function excerpt(text: string, max = 140): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max).trimEnd()}…`
}

function toAdminListItem(row: StoreReviewRow): AdminReviewListItem {
  return {
    id: row.id,
    displayName: row.displayName,
    rating: row.rating,
    excerpt: excerpt(row.reviewText),
    status: row.status,
    verifiedPurchase: row.verifiedPurchase,
    verifiedSource: row.verifiedSource,
    hasLinkedCustomer: row.customerId !== null,
    createdAt: row.createdAt.toISOString(),
    moderatedAt: row.moderatedAt ? row.moderatedAt.toISOString() : null,
  }
}

function toAdminDetail(row: StoreReviewRow): AdminReviewDetail {
  return {
    id: row.id,
    displayName: row.displayName,
    rating: row.rating,
    reviewText: row.reviewText,
    status: row.status,
    verifiedPurchase: row.verifiedPurchase,
    verifiedSource: row.verifiedSource,
    submittedPhone: row.submittedPhoneNormalized,
    submittedReference: row.submittedReference,
    linkedCustomerId: row.customerId,
    moderationNote: row.moderationNote,
    moderatedByStaffId: row.moderatedByStaffId,
    moderatedAt: row.moderatedAt ? row.moderatedAt.toISOString() : null,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    rejectedAt: row.rejectedAt ? row.rejectedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listAdminReviewsService(
  db: DbClient,
  query: AdminReviewListQuery,
): Promise<AdminReviewListResponse> {
  const status = query.status === undefined || query.status === 'all' ? undefined : query.status
  const [{ rows, total }, counts] = await Promise.all([
    listStoreReviewsForAdmin(db, { status, page: query.page, pageSize: query.pageSize }),
    getReviewStatusCounts(db),
  ])
  return {
    data: rows.map(toAdminListItem),
    meta: { page: query.page, pageSize: query.pageSize, total },
    counts,
  }
}

export async function getAdminReviewDetailService(
  db: DbClient,
  id: string,
): Promise<AdminReviewDetail> {
  const row = await getStoreReviewById(db, id)
  if (row === undefined) throw new NotFoundError('review not found')
  return toAdminDetail(row)
}

// ---------------------------------------------------------------------------
// ADMIN — moderation (approve / reject)
// ---------------------------------------------------------------------------

type ModerationAction = 'approve' | 'reject'

/**
 * Applies `approve` / `reject` as an atomic, status-guarded transition
 * (§20/§21/§22). Legal source states:
 *   approve ← pending | rejected   (rejected → approved is a deliberate correction)
 *   reject  ← pending | approved   (approved → rejected pulls it from the public list)
 * Re-issuing the same action on a review already in that target status is an
 * idempotent no-op (returns the current detail, no write, no audit) so a
 * double-click / stale tab cannot corrupt anything. A concurrent move to a
 * third state makes the guard match nothing → `ConflictError`.
 */
export async function moderateReviewService(
  db: DbClient,
  id: string,
  action: ModerationAction,
  moderatorStaffId: string | undefined,
  note: string | undefined,
): Promise<AdminReviewDetail> {
  const current = await getStoreReviewById(db, id)
  if (current === undefined) throw new NotFoundError('review not found')

  const targetStatus = action === 'approve' ? 'approved' : 'rejected'
  if (current.status === targetStatus) {
    // Idempotent: nothing to change.
    return toAdminDetail(current)
  }

  const allowedFrom: ('pending' | 'approved' | 'rejected')[] =
    action === 'approve' ? ['pending', 'rejected'] : ['pending', 'approved']

  const noteValue = note !== undefined && note.length > 0 ? note : null
  // Moderator identity is required for a real transition; dev/system callers
  // that somehow reach here without one are rejected rather than recording an
  // orphan moderation.
  if (moderatorStaffId === undefined) {
    throw new ConflictError('a moderator identity is required to moderate a review')
  }

  const updated =
    action === 'approve'
      ? await approveReviewGuarded(db, id, moderatorStaffId, noteValue, allowedFrom)
      : await rejectReviewGuarded(db, id, moderatorStaffId, noteValue, allowedFrom)

  if (updated === undefined) {
    throw new ConflictError('the review is not in a state that allows this')
  }

  await recordAudit(
    db,
    auditActor(moderatorStaffId),
    action === 'approve' ? 'review.approved' : 'review.rejected',
    'store_review',
    id,
    auditMeta({
      from: current.status,
      to: targetStatus,
      verifiedPurchase: updated.verifiedPurchase,
      hasNote: noteValue !== null,
    }),
  )

  return toAdminDetail(updated)
}
