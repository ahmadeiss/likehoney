/**
 * In-store sales (physical register) wire contracts.
 *
 * A store sale is authoritative-by-construction, exactly like public checkout:
 * the client submits only variant ids and quantities; the server independently
 * resolves each active variant's real unit price, snapshots product data, and
 * deducts stock atomically inside ONE transaction with a `STORE_SALE`
 * inventory movement (INVENTORY_RULES.md §3). Totals are never taken from the
 * client. There is no delivery fee and no payment capture in V1 — the register
 * records what was sold and adjusts inventory.
 *
 * `number` is the PostgreSQL-generated human sale number `LH-POS-000001`.
 */
import { z } from 'zod'

import { paginationQuerySchema, searchQuerySchema } from './common'

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const storeSaleLineInputSchema = z.object({
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(1000),
})

export const storeSaleCreateSchema = z.object({
  lines: z.array(storeSaleLineInputSchema).min(1).max(50),
  note: z.string().trim().max(500).optional(),
  /**
   * Gate C — phone-first POS customer capture (§14-§17). Omitted entirely ⇒
   * "بيع بدون بيانات عميل" (an intentional anonymous/walk-in skip, never a
   * fabricated shared "Walk-in Customer" identity). When present, the phone
   * is the only automatic identity-match key; name/city/address are optional
   * "current profile" fields the operator may fill in alongside it.
   */
  customerPhone: z.string().trim().max(40).optional(),
  customerName: z.string().trim().max(200).optional(),
  customerCity: z.string().trim().max(120).optional(),
  customerAddress: z.string().trim().max(300).optional(),
})

/** Register product lookup: matches Arabic/English product name OR variant SKU. */
export const storeSaleSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(20).default(8),
})

export const storeSaleListQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
})

export const storeSaleUuidParamSchema = z.object({
  storeSaleId: z.uuid('expected a valid UUID'),
})

/** POS phone-first lookup — type a phone, get a match/prefill or nothing. */
export const storeSaleCustomerLookupQuerySchema = z.object({
  phone: z.string().trim().min(1).max(40),
})

export type StoreSaleLineInput = z.infer<typeof storeSaleLineInputSchema>
export type StoreSaleCreateInput = z.infer<typeof storeSaleCreateSchema>
export type StoreSaleSearchQuery = z.infer<typeof storeSaleSearchQuerySchema>
export type StoreSaleListQuery = z.infer<typeof storeSaleListQuerySchema>
export type StoreSaleCustomerLookupQuery = z.infer<typeof storeSaleCustomerLookupQuerySchema>

// ---------------------------------------------------------------------------
// Response documents
// ---------------------------------------------------------------------------

export interface StoreSaleOptionValueHit {
  id: string
  valueAr: string
  valueEn: string
}

export interface StoreSaleOptionHit {
  id: string
  nameAr: string
  nameEn: string
  values: StoreSaleOptionValueHit[]
}

export interface StoreSaleVariantHit {
  variantId: string
  sku: string
  optionLabelAr: string | null
  optionLabelEn: string | null
  /** Chosen option-value ids that uniquely identify this variant. */
  optionValueIds: string[]
  priceMinor: number
  quantityOnHand: number
  status: 'draft' | 'active' | 'inactive'
}

/** One product returned by the register search — everything the till needs. */
export interface StoreSaleProductHit {
  productId: string
  nameAr: string
  nameEn: string
  /** Streamed thumbnail URL when a primary image exists, otherwise null. */
  imageUrl: string | null
  /** Lowest active-variant price, for the search row. */
  fromPriceMinor: number
  totalOnHand: number
  hasOptions: boolean
  options: StoreSaleOptionHit[]
  variants: StoreSaleVariantHit[]
}

export interface StoreSaleItemDoc {
  productId: string
  variantId: string
  sku: string
  productNameAr: string
  productNameEn: string
  variantLabelAr: string | null
  variantLabelEn: string | null
  unitPriceMinor: number
  quantity: number
  lineTotalMinor: number
}

/** A row in the store-sales history. */
export interface StoreSaleDoc {
  id: string
  number: string
  createdAt: string
  staffId: string
  staffNameAr: string
  staffNameEn: string | null
  itemCount: number
  totalUnits: number
  subtotalMinor: number
  totalMinor: number
  currency: string
  note: string | null
}

/** Minimal customer card — POS lookup and Order/Store-Sale detail (§54/§58).
 *  Never the full Customer 360 payload: POS staff get only what completes a
 *  sale, not lifetime analytics. */
export interface StoreSaleCustomerCard {
  id: string
  phoneNormalized: string
  nameEn: string | null
  nameAr: string | null
  cityEn: string | null
  cityAr: string | null
  addressEn: string | null
  addressAr: string | null
  /** Server-computed — true when this customer has at least one OTHER
   *  completed transaction before this one (never computed client-side). */
  isReturning: boolean
}

export interface StoreSaleCustomerLookupResult {
  found: boolean
  customer: StoreSaleCustomerCard | null
}

export interface StoreSaleDetailDoc extends StoreSaleDoc {
  customerPhoneNormalized: string | null
  /** Present only when the sale is linked to an internal customer identity. */
  customer: StoreSaleCustomerCard | null
  items: StoreSaleItemDoc[]
}

export interface StoreSaleCreateResult {
  id: string
  number: string
  createdAt: string
  subtotalMinor: number
  totalMinor: number
  currency: string
  items: StoreSaleItemDoc[]
}
