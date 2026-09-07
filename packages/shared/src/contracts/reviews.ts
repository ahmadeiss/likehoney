/**
 * Store / shopping-experience reviews — wire contracts (Reviews Gate V1).
 *
 * Public submit + public approved-list are unauthenticated (`/api/v1/public`).
 * Admin list / detail / approve / reject sit under `/api/v1/reviews` and
 * require `reviews:moderate`.
 *
 * Hard rules encoded here:
 *  - rating is an INTEGER 1–5 — `0`, `6`, negatives, decimals and non-numbers
 *    are rejected, never coerced (§6).
 *  - display name 2–80, review text 10–1000, both trimmed; whitespace-only
 *    fails `min` rather than being silently accepted or truncated (§7).
 *  - `.strict()` on the submit body: any attempt to also send `status`,
 *    `approved`, `verifiedPurchase`, `customerId`, `moderatedBy`, `approvedAt`
 *    (or any other unknown key) is a validation error — the client can never
 *    influence moderation or verification state (§8).
 */
import { z } from 'zod'

import { paginationQuerySchema } from './common'

// ---------------------------------------------------------------------------
// Shared value enum (mirrors packages/db/src/schema/enums.ts)
// ---------------------------------------------------------------------------

export const REVIEW_STATUS_VALUES = ['pending', 'approved', 'rejected'] as const
export type ReviewStatusValue = (typeof REVIEW_STATUS_VALUES)[number]
export const reviewStatusSchema = z.enum(REVIEW_STATUS_VALUES)

export const REVIEW_VERIFIED_SOURCE_VALUES = ['online_order', 'store_sale'] as const
export type ReviewVerifiedSourceValue = (typeof REVIEW_VERIFIED_SOURCE_VALUES)[number]

export const REVIEW_TEXT_MIN = 10
export const REVIEW_TEXT_MAX = 1000
export const REVIEW_NAME_MIN = 2
export const REVIEW_NAME_MAX = 80

// ---------------------------------------------------------------------------
// Public — submit
// ---------------------------------------------------------------------------

export const publicReviewSubmitSchema = z
  .object({
    displayName: z.string().trim().min(REVIEW_NAME_MIN).max(REVIEW_NAME_MAX),
    rating: z.number().int().min(1).max(5),
    reviewText: z.string().trim().min(REVIEW_TEXT_MIN).max(REVIEW_TEXT_MAX),
    /**
     * OPTIONAL verification helpers. Raw as the visitor typed them; the
     * server canonicalizes the phone with the one shared `normalizePhone`
     * and never echoes either value back (§13/§30/§31).
     */
    phone: z.string().trim().min(6).max(32).optional(),
    orderReference: z.string().trim().min(3).max(40).optional(),
  })
  .strict()

export type PublicReviewSubmitInput = z.infer<typeof publicReviewSubmitSchema>

// ---------------------------------------------------------------------------
// Public — approved list
// ---------------------------------------------------------------------------

export const publicReviewListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(12),
})

export type PublicReviewListQuery = z.infer<typeof publicReviewListQuerySchema>

/** The ONLY shape the public approved-reviews endpoint returns — nothing private. */
export interface PublicReviewDoc {
  id: string
  displayName: string
  rating: number
  reviewText: string
  verifiedPurchase: boolean
  /** ISO — `approvedAt` when present, else `createdAt` (never a private field). */
  createdAt: string
}

export interface PublicReviewListResponse {
  data: PublicReviewDoc[]
  summary: { count: number; average: number | null }
}

// ---------------------------------------------------------------------------
// Admin — list / detail / moderation
// ---------------------------------------------------------------------------

export const reviewIdParamSchema = z.object({
  reviewId: z.uuid('expected a valid UUID'),
})

/** `status` omitted or `all` = every status. */
export const adminReviewListQuerySchema = paginationQuerySchema.extend({
  status: z.enum([...REVIEW_STATUS_VALUES, 'all']).optional(),
})

export type AdminReviewListQuery = z.infer<typeof adminReviewListQuerySchema>

export const adminReviewModerateSchema = z
  .object({
    /** Internal-only note (§21) — never surfaced publicly. */
    note: z.string().trim().max(500).optional(),
  })
  .strict()

export type AdminReviewModerateInput = z.infer<typeof adminReviewModerateSchema>

/** Admin list row — moderation-relevant fields only, no raw phone here. */
export interface AdminReviewListItem {
  id: string
  displayName: string
  rating: number
  excerpt: string
  status: ReviewStatusValue
  verifiedPurchase: boolean
  verifiedSource: ReviewVerifiedSourceValue | null
  hasLinkedCustomer: boolean
  createdAt: string
  moderatedAt: string | null
}

/** Admin detail — enough to decide safely (§19). Phone is Admin-only, still never public. */
export interface AdminReviewDetail {
  id: string
  displayName: string
  rating: number
  reviewText: string
  status: ReviewStatusValue
  verifiedPurchase: boolean
  verifiedSource: ReviewVerifiedSourceValue | null
  /** Admin-only. `null` when the visitor supplied none. */
  submittedPhone: string | null
  submittedReference: string | null
  linkedCustomerId: string | null
  moderationNote: string | null
  moderatedByStaffId: string | null
  moderatedAt: string | null
  approvedAt: string | null
  rejectedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminReviewListResponse {
  data: AdminReviewListItem[]
  meta: { page: number; pageSize: number; total: number }
  counts: Record<ReviewStatusValue, number>
}
