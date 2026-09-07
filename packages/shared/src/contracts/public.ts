/**
 * Public storefront wire contracts.
 *
 * These are the read-only, customer-facing endpoints under `/api/v1/public`.
 * They are intentionally NOT staff-protected (no `X-Staff-Id`) and expose only
 * customer-safe projections: active products, active categories, active
 * delivery zones, published content pages and whitelisted store settings.
 *
 * Security contract:
 * - Only `active` products and `active` variants are ever returned.
 * - Supplier internals, cost data, audit fields and staff data are never
 *   projected.
 * - Money values are integer minor units; the server is authoritative.
 */
import { z } from 'zod'

import { paginationQuerySchema } from './common'

// ---------------------------------------------------------------------------
// Public catalog list / detail
// ---------------------------------------------------------------------------

export const publicProductListQuerySchema = paginationQuerySchema.extend({
  categorySlug: z.string().trim().min(1).max(200).optional(),
  categoryId: z.uuid().optional(),
  search: z.string().trim().max(300).optional(),
  /** Filter to products that have at least one in-stock active variant. */
  inStock: z
    .literal('true')
    .transform(() => true)
    .optional(),
})

export const publicProductSlugParamSchema = z.object({
  slug: z.string().trim().min(1).max(200),
})

export const contentSlugParamSchema = z.object({
  slug: z.string().trim().min(1).max(200),
})

export type PublicProductListQuery = z.infer<typeof publicProductListQuerySchema>

// ---------------------------------------------------------------------------
// Public cart verification
// ---------------------------------------------------------------------------

export const publicCartLineSchema = z.object({
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(10_000),
})

/**
 * Authoritative quote request. `deliveryZoneId` is required so the server can
 * resolve the current fee and return an authoritative total + `quoteFingerprint`.
 */
export const publicCartVerifySchema = z.object({
  deliveryZoneId: z.uuid(),
  lines: z.array(publicCartLineSchema).min(1).max(100),
})

export type PublicCartLineInput = z.infer<typeof publicCartLineSchema>
export type PublicCartVerifyInput = z.infer<typeof publicCartVerifySchema>

// ---------------------------------------------------------------------------
// Authoritative quote response (server → client)
// ---------------------------------------------------------------------------

export interface QuoteLine {
  variantId: string
  productId: string
  sku: string
  productNameAr: string
  productNameEn: string
  variantLabelAr: string | null
  variantLabelEn: string | null
  unitPriceMinor: number
  quantity: number
  lineTotalMinor: number
  /** Current physical availability for this line (informational). */
  availableQuantity: number
  inStock: boolean
}

export interface QuoteResponse {
  lines: QuoteLine[]
  subtotalMinor: number
  deliveryFeeMinor: number
  totalMinor: number
  currency: string
  deliveryZone: {
    id: string
    code: string
    nameAr: string
    nameEn: string
    feeMinor: number
  }
  /**
   * Currently offerable customer payment methods — ACTUAL availability for a
   * new checkout right now, not merely a saved Admin preference. `electronic`
   * stays `false` until the Stage-4 checkout/webhook/reconciliation
   * infrastructure exists (Gate B4 Stage 3).
   */
  paymentMethods: { cod: boolean; electronic: boolean }
  /** SHA-256 of the canonical commercial truth; echoed back at checkout. */
  quoteFingerprint: string
  quotedAt: string
}
