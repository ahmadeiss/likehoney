/**
 * Admin (staff) online-order wire contracts — Gate B2 backend.
 *
 * Reads return HISTORICAL snapshots only (never joined to current catalog).
 * Writes are explicit business commands — there is NO arbitrary status PATCH:
 *   POST /orders/:orderId/start-delivery   (orders:write)  processing → delivering
 *   POST /orders/:orderId/complete         (orders:write)  delivering → completed (+ COD paid)
 *   POST /orders/:orderId/cancel           (orders:cancel)  processing|delivering → cancelled
 */
import { z } from 'zod'

import { orderPaymentStatusSchema, paymentMethodSchema } from '../domain/payments'
import { orderStatusSchema } from './common'
import type { StoreSaleCustomerCard } from './store-sales'

// ---------------------------------------------------------------------------
// List query (keyset pagination)
// ---------------------------------------------------------------------------

export const adminOrderListQuerySchema = z.object({
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: orderStatusSchema.optional(),
  paymentMethod: paymentMethodSchema.optional(),
  paymentStatus: orderPaymentStatusSchema.optional(),
  /** ISO date/datetime; filters on order creation time (inclusive). */
  dateFrom: z.string().trim().min(1).max(40).optional(),
  dateTo: z.string().trim().min(1).max(40).optional(),
  /** Order number (LH-000123), customer name, or phone. */
  search: z.string().trim().max(120).optional(),
})

export type AdminOrderListQuery = z.infer<typeof adminOrderListQuerySchema>

export const adminOrderIdParamSchema = z.object({
  orderId: z.uuid('expected a valid UUID'),
})

// ---------------------------------------------------------------------------
// Command bodies
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Delayed physical stock-return receipt (final pre-provider correction)
// ---------------------------------------------------------------------------

export const orderStockReturnLineSchema = z.object({
  orderItemId: z.uuid('expected a valid UUID'),
  /** Quantity physically received now for this line. Never exceeds remaining. */
  quantity: z.number().int().positive().max(100000),
})

export const orderStockReturnRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  lines: z.array(orderStockReturnLineSchema).min(1).max(200),
  note: z.string().trim().max(500).optional(),
})

export type OrderStockReturnRequest = z.infer<typeof orderStockReturnRequestSchema>

export const orderCancelSchema = z.object({
  /** Required human reason; shown in Order Detail. */
  reason: z.string().trim().min(3).max(500),
  /**
   * REQUIRED when the order is `delivering` (the server never infers whether
   * merchandise physically returned). Ignored for a `processing` cancel, which
   * always restores stock.
   */
  restockReturnedItems: z.boolean().optional(),
})

export type OrderCancelInput = z.infer<typeof orderCancelSchema>

// ---------------------------------------------------------------------------
// Response documents
// ---------------------------------------------------------------------------

export interface AdminOrderListItem {
  id: string
  number: string
  customerName: string
  customerPhone: string
  city: string | null
  itemCount: number
  subtotalMinor: number
  deliveryFeeMinor: number
  totalMinor: number
  currency: string
  status: string
  paymentMethod: string
  paymentStatus: string
  createdAt: string
  deliveringAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  inventoryRestoredOnCancel: boolean | null
}

export interface AdminOrderListResponse {
  items: AdminOrderListItem[]
  nextCursor: string | null
}

export interface AdminOrderDetailItem {
  orderItemId: string
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
  /**
   * Physical-return state for this line — present only for a `cancelled`
   * order. `originalDeductedQuantity` is `quantity` above unless
   * `inventoryRestoredOnCancel` restored it at cancellation, in which case it
   * is already fully accounted for (`remaining` is 0).
   */
  stockReturn: {
    originalDeductedQuantity: number
    alreadyReturnedQuantity: number
    remainingReturnableQuantity: number
  } | null
}

export interface AdminOrderStockReturnReceipt {
  id: string
  createdAt: string
  receivedBy: { id: string; nameAr: string; nameEn: string | null } | null
  note: string | null
  lines: Array<{
    orderItemId: string
    variantId: string
    sku: string
    productNameAr: string
    productNameEn: string
    quantity: number
  }>
}

export interface AdminOrderDetail {
  id: string
  number: string
  customer: {
    name: string
    phone: string
    city: string | null
    addressLine1: string | null
    addressLine2: string | null
    note: string | null
  }
  /** Gate C — the linked internal CRM identity + new/returning classification
   *  (§54), `null` when the order's phone didn't resolve to one. */
  customerAccount: StoreSaleCustomerCard | null
  delivery: {
    zoneCode: string | null
    zoneNameAr: string | null
    zoneNameEn: string | null
    feeMinor: number
  }
  items: AdminOrderDetailItem[]
  totals: {
    subtotalMinor: number
    deliveryFeeMinor: number
    taxMinor: number
    totalMinor: number
    currency: string
  }
  payment: {
    method: string
    status: string
  }
  fulfillment: {
    status: string
    createdAt: string
    deliveringAt: string | null
    completedAt: string | null
    cancelledAt: string | null
    cancelledReason: string | null
    inventoryRestoredOnCancel: boolean | null
  }
  vendorNote: string | null
  /**
   * Chronological record of physical merchandise received back at the store
   * after this cancellation — always `[]` for a non-cancelled order.
   */
  stockReturns: AdminOrderStockReturnReceipt[]
}

/** One entry of the order activity timeline. */
export interface AdminOrderTimelineEntry {
  type: 'created' | 'delivery_started' | 'completed' | 'cancelled' | 'stock_returned'
  at: string
  actor: { id: string; nameAr: string; nameEn: string | null } | null
  meta?: {
    fromStatus?: string
    toStatus?: string
    restocked?: boolean
    /** stock_returned only — total pieces recorded in that one receipt. */
    quantity?: number
  }
}

export interface AdminOrderCommandResult {
  id: string
  number: string
  status: string
  paymentStatus: string
  deliveringAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  inventoryRestoredOnCancel: boolean | null
}
