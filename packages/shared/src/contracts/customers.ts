/**
 * Internal CRM customer identity — wire contracts (Gate C).
 *
 * NOT customer accounts: there is no login/session for a customer, and the
 * public storefront never exposes any of this. Everything here is an
 * Admin-only surface, gated by `customers:read` (full directory/360) or the
 * narrower POS lookup under `store-sales:write` (see `store-sales.ts`, which
 * defines the minimal `StoreSaleCustomerCard` used at the register and on
 * Order/Store-Sale detail — this file is the fuller Directory/360 shape).
 */
import { z } from 'zod'

import { entityStatusSchema, paginationQuerySchema, searchQuerySchema } from './common'

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/**
 * Directory operational filters (Gate C final). All SERVER-SIDE — derived
 * from the customer's linked COMPLETED transaction history (online orders
 * with `status = 'completed'` + every store sale; cancelled/pending/
 * processing/delivering/failed never count):
 *  - `channel`  — `online`/`store`/`both`, from completed activity per channel.
 *  - `type`     — a PURCHASE-behaviour classification:
 *      `no_purchase` = 0 completed transactions (a contact, not a buyer yet)
 *      `new`         = exactly 1 completed transaction
 *      `returning`   = 2 or more completed transactions
 *    Zero and one are NEVER merged.
 *  - `inactiveDays` — has a completed transaction, but the LAST one is older
 *    than N days. Never-buyers are excluded here — they belong to
 *    `type=no_purchase`, not to every inactivity threshold.
 */
export const customerChannelFilterSchema = z.enum(['online', 'store', 'both'])
export const customerTypeFilterSchema = z.enum(['new', 'returning', 'no_purchase'])

export const customerListQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  status: entityStatusSchema.optional(),
  channel: customerChannelFilterSchema.optional(),
  type: customerTypeFilterSchema.optional(),
  inactiveDays: z.coerce.number().int().min(1).max(3650).optional(),
})

export const customerUuidParamSchema = z.object({
  customerId: z.uuid('expected a valid UUID'),
})

export const customerStatusUpdateSchema = z.object({
  status: entityStatusSchema,
})

export type CustomerListQuery = z.infer<typeof customerListQuerySchema>
export type CustomerStatusUpdateInput = z.infer<typeof customerStatusUpdateSchema>

// ---------------------------------------------------------------------------
// Response documents
// ---------------------------------------------------------------------------

/** One row in the Customer Directory list. */
export interface CustomerListItem {
  id: string
  phoneNormalized: string
  nameEn: string | null
  nameAr: string | null
  cityEn: string | null
  cityAr: string | null
  status: 'active' | 'inactive'
  firstSeenAt: string | null
  lastSeenAt: string | null
}

export interface CustomerListResponse {
  data: CustomerListItem[]
  meta: { page: number; pageSize: number; total: number }
}

/** One line in the Customer 360 cross-channel purchase timeline. */
export interface CustomerTimelineEntry {
  channel: 'online' | 'store'
  id: string
  number: string
  createdAt: string
  totalMinor: number
  currency: string
  /** Online orders only — a store sale has no delivery/cancel lifecycle. */
  status: 'processing' | 'delivering' | 'completed' | 'cancelled' | null
}

/**
 * Commercial summary — derived from transactions, never a cached counter on
 * the customer row (§Gate C: "lifetime metrics should be derived from
 * transactions"). `completedOrdersCount`/`completedSalesCount` follow the
 * strict "completed sales" definition (cancelled/pending/failed excluded).
 */
export interface CustomerCommercialSummary {
  completedOrdersCount: number
  completedSalesCount: number
  lifetimeSpendMinor: number
  currency: string
  firstTransactionAt: string | null
  lastTransactionAt: string | null
}

export interface Customer360Detail {
  id: string
  phoneNormalized: string
  nameEn: string | null
  nameAr: string | null
  cityEn: string | null
  cityAr: string | null
  addressEn: string | null
  addressAr: string | null
  status: 'active' | 'inactive'
  consentToContact: boolean
  firstSeenAt: string | null
  lastSeenAt: string | null
  note: string | null
  commercial: CustomerCommercialSummary
  timeline: CustomerTimelineEntry[]
}
