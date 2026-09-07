/**
 * Shared wire contracts for the Like Honey API. These are the Zod schemas
 * that validate every request input shape (params, query, body) at the API
 * edge, and the constants that keep the API and the future admin UI aligned
 * (paging, setting registry, permission codes).
 *
 * Value enums mirror the stable machine values defined in
 * `packages/db/src/schema/enums.ts`; human labels are resolved at the UI via
 * `packages/shared/src/domain/localization.ts` (bilingual policy, Type D).
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Identifier params
// ---------------------------------------------------------------------------

export const uuidParamSchema = z.object({
  id: z.uuid('expected a valid UUID'),
})

export const productUuidParamSchema = z.object({
  productId: z.uuid('expected a valid UUID'),
})

export const variantUuidParamSchema = z.object({
  variantId: z.uuid('expected a valid UUID'),
})

export const mediaUuidParamSchema = z.object({
  mediaId: z.uuid('expected a valid UUID'),
})

export const zoneUuidParamSchema = z.object({
  zoneId: z.uuid('expected a valid UUID'),
})

export const roleUuidParamSchema = z.object({
  roleId: z.uuid('expected a valid UUID'),
})

export const permissionUuidParamSchema = z.object({
  permissionId: z.uuid('expected a valid UUID'),
})

export const optionUuidParamSchema = z.object({
  optionId: z.uuid('expected a valid UUID'),
})

export const optionValueUuidParamSchema = z.object({
  optionValueId: z.uuid('expected a valid UUID'),
})

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

export interface PageMeta {
  page: number
  pageSize: number
  total: number
}

export interface Paged<T> {
  data: T[]
  meta: PageMeta
}

// ---------------------------------------------------------------------------
// Status value enums (mirror packages/db/src/schema/enums.ts)
// ---------------------------------------------------------------------------

export const entityStatusSchema = z.enum(['active', 'inactive'])
export const productStatusSchema = z.enum(['draft', 'active', 'inactive', 'archived'])
export const variantStatusSchema = z.enum(['draft', 'active', 'inactive'])
export const inventoryMovementTypeSchema = z.enum([
  'INITIAL_STOCK',
  'RESTOCK',
  'ONLINE_ORDER',
  'ORDER_CANCELLATION_RESTORE',
  'RETURN',
  'DAMAGE',
  'MANUAL_ADJUSTMENT',
  'STORE_SALE',
])
export const orderStatusSchema = z.enum(['processing', 'delivering', 'completed', 'cancelled'])
// `paymentMethodSchema` / `orderPaymentStatusSchema` are the canonical payment
// vocabulary — defined once in `../domain/payments`. Import them from there.
export const mediaTypeSchema = z.enum(['image', 'video'])
export const contentStatusSchema = z.enum(['draft', 'published', 'archived'])

export type EntityStatusValue = z.infer<typeof entityStatusSchema>
export type ProductStatusValue = z.infer<typeof productStatusSchema>
export type VariantStatusValue = z.infer<typeof variantStatusSchema>

/** String search used across admin list endpoints. */
export const searchQuerySchema = z.string().trim().max(200).optional()

// ---------------------------------------------------------------------------
// Permission codes (RBAC foundation)
// ---------------------------------------------------------------------------

export const PERMISSION_CODES = [
  'catalog:read',
  'catalog:write',
  'inventory:read',
  'inventory:write',
  'suppliers:write',
  'settings:write',
  'staff:write',
  'reports:read',
  'store-sales:read',
  'store-sales:write',
  'orders:read',
  'orders:write',
  'orders:cancel',
  /** Gate C — full Customer Directory / Customer 360 (lifetime spend, cross-
   *  channel history). Distinct from the minimal phone lookup POS already
   *  performs under `store-sales:write` — this is the full CRM surface. */
  'customers:read',
  /**
   * Reviews Gate — moderate store / shopping-experience reviews (approve /
   * reject a pending submission). Owner/Admin authority; never in the default
   * employee set. The ONLY status the public storefront reads is `approved`.
   */
  'reviews:moderate',
  /**
   * Gate C completion — acquisition (purchase) cost of a sellable variant.
   * Commercially sensitive: split from `catalog:write` so a plain catalog
   * editor can manage price/label/stock without ever seeing or setting cost.
   * Owner/financial authority only (never in the employee default set).
   */
  'catalog-cost:read',
  'catalog-cost:write',
] as const

export type PermissionCode = (typeof PERMISSION_CODES)[number]

export const permissionCodeSchema = z.enum(PERMISSION_CODES) as z.ZodType<PermissionCode>

export function isPermissionCode(value: string): value is PermissionCode {
  return (PERMISSION_CODES as readonly string[]).includes(value)
}
