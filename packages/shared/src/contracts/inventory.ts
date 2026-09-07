/**
 * Inventory wire contracts.
 *
 * Only staff-directed movement types are exposed over this admin endpoint:
 * ONLINE_ORDER and STORE_SALE are reserved for the future checkout/register
 * flows that must deduct stock atomically inside their own transactions
 * (INVENTORY_RULES.md §3). `quantityChange` is signed: >0 adds stock, <0
 * consumes. The acting staff member is taken from the request identity, never
 * from the payload. All mutations go through the atomic movement service.
 */
import { z } from 'zod'

import type { ProductReadiness } from '../domain/sellability'
import { inventoryMovementTypeSchema, paginationQuerySchema } from './common'

export const MANUAL_MOVEMENT_TYPES = [
  'INITIAL_STOCK',
  'RESTOCK',
  'MANUAL_ADJUSTMENT',
  'DAMAGE',
  'RETURN',
] as const

export const manualMovementTypeSchema = z.enum(MANUAL_MOVEMENT_TYPES)

export const inventoryMovementCreateSchema = z.object({
  variantId: z.uuid(),
  movementType: manualMovementTypeSchema,
  quantityChange: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((n) => n !== 0, {
      message: 'quantityChange must be non-zero',
    }),
  reason: z.string().trim().max(500).optional(),
})

export const inventoryMovementListQuerySchema = paginationQuerySchema.extend({
  variantId: z.uuid().optional(),
  movementType: inventoryMovementTypeSchema.optional(),
})

export type InventoryMovementCreateInput = z.infer<typeof inventoryMovementCreateSchema>
export type InventoryMovementListQuery = z.infer<typeof inventoryMovementListQuerySchema>

/** Server-side filtered/paginated variant-balance listing for the Admin inventory register. */
export const inventoryBalanceListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(300).optional(),
  level: z.enum(['available', 'low', 'out']).optional(),
})

export type InventoryBalanceListQuery = z.infer<typeof inventoryBalanceListQuerySchema>

// ---------------------------------------------------------------------------
// Stock levels & admin stock summary
// ---------------------------------------------------------------------------
//
// Stock health is a read-only admin classification derived from the real
// inventory balance of each variant (`quantity_on_hand`). It is a UI/dashboard
// heuristic only — it never mutates inventory and never participates in the
// concurrency-safe stock mutation rules (INVENTORY_RULES.md). There is no
// per-product threshold in the schema yet, so a single conservative shared
// constant is used for now; it can later move into settings if a per-store
// threshold becomes a real requirement.

/**
 * A variant is considered "low" when its on-hand quantity is above zero but at
 * or below this threshold. Zero is always "out". Kept deliberately small so the
 * store never misses an imminent stock-out.
 */
export const LOW_STOCK_THRESHOLD = 5

export const stockLevelSchema = z.enum(['out', 'low', 'available'])

export type StockLevel = z.infer<typeof stockLevelSchema>

/** Classify a single variant by its on-hand quantity. Pure helper, no I/O. */
export function stockLevelFor(quantityOnHand: number): StockLevel {
  if (quantityOnHand <= 0) return 'out'
  if (quantityOnHand <= LOW_STOCK_THRESHOLD) return 'low'
  return 'available'
}

/**
 * Product-level physical stock: the sum of every one of the product's owned
 * inventory balances, classified with the exact same thresholds as a single
 * variant. Lifecycle (draft / inactive) is deliberately NOT considered here —
 * this is physical truth only. A product with zero total units is always
 * `out`, whatever its publish state. Selling readiness is a separate axis.
 */
export function productStockLevelFor(quantitiesOnHand: readonly number[]): StockLevel {
  let total = 0
  for (const q of quantitiesOnHand) total += q
  return stockLevelFor(total)
}

export interface InventoryAttentionItem {
  productId: string
  productNameAr: string
  productNameEn: string
  categoryId: string | null
  supplierId: string | null
  supplierNameAr: string | null
  supplierNameEn: string | null
  variantId: string
  sku: string
  variantStatus: 'draft' | 'active' | 'inactive'
  productStatus: 'draft' | 'active' | 'inactive' | 'archived'
  quantityOnHand: number
  level: Exclude<StockLevel, 'available'>
}

/** One row of the paginated Admin inventory register (`GET /inventory/balances`). */
export interface InventoryBalanceListItem {
  variantId: string
  sku: string
  productId: string
  productNameAr: string
  productNameEn: string
  productStatus: 'draft' | 'active' | 'inactive' | 'archived'
  variantStatus: 'draft' | 'active' | 'inactive'
  quantityOnHand: number
  quantityReserved: number
  level: StockLevel
}

export interface SupplierShortageDoc {
  supplierId: string
  supplierNameAr: string
  supplierNameEn: string | null
  productCount: number
  lowVariants: number
  outVariants: number
}

/**
 * Read-only admin stock/dashboard summary derived from real catalog +
 * inventory data. Powers the dashboard "needs attention" module and the
 * inventory health strip. Aggregate counts only — never raw balance mutations.
 */
export interface InventorySummaryDoc {
  products: { total: number; active: number }
  variants: { total: number; active: number }
  stock: { totalUnits: number }
  stockHealth: { available: number; low: number; out: number }
  attention: InventoryAttentionItem[]
  suppliers: { total: number }
  categories: { total: number }
  supplierShortages: SupplierShortageDoc[]
  /** Derived selling-readiness per product id — physical stock is separate. */
  readiness: Record<string, ProductReadiness>
  /**
   * Physical stock level per product id — the real total of every owned
   * balance, classified by the shared threshold. Independent of lifecycle:
   * 0 units is always `out`, even for a draft product.
   */
  productStock: Record<string, StockLevel>
}
