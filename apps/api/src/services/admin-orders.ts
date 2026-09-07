/**
 * Admin online-order lifecycle service — Gate B2 (backend only).
 *
 * Reads return HISTORICAL snapshots (never joined to current catalog). Writes
 * are explicit business commands guarded by a conditional status transition:
 *
 *   start-delivery : processing → delivering            (orders:write)
 *   complete       : delivering → completed  + COD paid  (orders:write)
 *   cancel         : processing|delivering → cancelled   (orders:cancel)
 *
 * Each command: `withDeadlockRetry(db.transaction(...))` → `SELECT ... FOR UPDATE`
 * the order → business-state guards (typed errors) → `applyOrderTransition`
 * (atomic `WHERE status = expected`; a losing concurrent command matches no row
 * → `invalid_order_transition`, so it never writes a second audit or restock) →
 * side effects (COD paid on complete; guarded stock restore on cancel, in
 * ascending `variant_id` order) → one audit row. `completed` and `cancelled`
 * are terminal.
 */
import {
  InvalidOrderTransitionError,
  NoOutstandingReturnError,
  NotFoundError,
  OrderAlreadyCancelledError,
  OrderNotCancellableError,
  OrderNotReturnEligibleError,
  PaymentStateConflictError,
  RestockDecisionRequiredError,
  ReturnIdempotencyConflictError,
  ReturnQuantityExceedsRemainingError,
  normalizePhone,
  type AdminOrderCommandResult,
  type AdminOrderDetail,
  type AdminOrderListItem,
  type AdminOrderListQuery,
  type AdminOrderListResponse,
  type AdminOrderStockReturnReceipt,
  type AdminOrderTimelineEntry,
  type OrderCancelInput,
  type OrderStockReturnRequest,
  type StoreSaleCustomerCard,
} from '@likehoney/shared'
import {
  addStock,
  applyOrderTransition,
  customerHasOtherTransactions,
  ensureBalance,
  getBalancesForUpdate,
  getOrderForUpdate,
  getOrderById,
  getOrderItemCounts,
  getCustomerById,
  getReturnByIdempotencyKey,
  getStaffUser,
  insertMovement,
  insertOrderStockReturn,
  listAuditForEntity,
  listItemsForReturn,
  listOrderItems,
  listOrdersPage,
  listReturnsForOrder,
  sumReturnedQuantityByOrderItem,
  withDeadlockRetry,
  type CustomerRow,
  type DbClient,
  type OrderItemRow,
  type OrderRow,
} from '@likehoney/db'

import { auditActor, auditMeta, recordAudit } from './audit'

// ---------------------------------------------------------------------------
// Cursor (keyset over created_at DESC, id DESC)
// ---------------------------------------------------------------------------

function encodeCursor(row: OrderRow): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url')
}

function decodeCursor(raw: string): { createdAt: Date; id: string } | undefined {
  try {
    const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|')
    if (iso === undefined || id === undefined) return undefined
    const createdAt = new Date(iso)
    if (Number.isNaN(createdAt.getTime())) return undefined
    return { createdAt, id }
  } catch {
    return undefined
  }
}

function parseDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d
}

const ORDER_NUMBER_RE = /^LH-\d{6}$/i
const PHONE_LIKE_RE = /^[+]?[\d][\d\s-]{4,}$/

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listAdminOrdersService(
  db: DbClient,
  query: AdminOrderListQuery,
): Promise<AdminOrderListResponse> {
  const search = query.search?.trim()
  const opts = {
    limit: query.limit,
    cursor: query.cursor === undefined ? undefined : decodeCursor(query.cursor),
    status: query.status,
    paymentMethod: query.paymentMethod,
    paymentStatus: query.paymentStatus,
    createdFrom: parseDate(query.dateFrom),
    createdTo: parseDate(query.dateTo),
    number: search && ORDER_NUMBER_RE.test(search) ? search.toUpperCase() : undefined,
    phoneNormalized:
      search && !ORDER_NUMBER_RE.test(search) && PHONE_LIKE_RE.test(search)
        ? normalizePhone(search)
        : undefined,
    nameContains:
      search && !ORDER_NUMBER_RE.test(search) && !PHONE_LIKE_RE.test(search) ? search : undefined,
  }

  const rows = await listOrdersPage(db, opts)
  const hasMore = rows.length > query.limit
  const page = hasMore ? rows.slice(0, query.limit) : rows
  const counts = await getOrderItemCounts(
    db,
    page.map((r) => r.id),
  )

  const items: AdminOrderListItem[] = page.map((r) => ({
    id: r.id,
    number: r.number,
    customerName: r.customerNameAr ?? r.customerNameEn ?? '',
    customerPhone: r.customerPhoneNormalized,
    city: r.cityAr ?? r.cityEn,
    itemCount: counts.get(r.id) ?? 0,
    subtotalMinor: r.subtotalMinor,
    deliveryFeeMinor: r.deliveryFeeMinor,
    totalMinor: r.totalMinor,
    currency: r.currency,
    status: r.status,
    paymentMethod: r.paymentMethod,
    paymentStatus: r.paymentStatus,
    createdAt: r.createdAt.toISOString(),
    deliveringAt: r.deliveringAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    inventoryRestoredOnCancel: r.inventoryRestoredOnCancel,
  }))

  return {
    items,
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null,
  }
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

/**
 * Per-line physical-return state — `null` for a non-cancelled order (the
 * concept doesn't apply). For a cancelled order: if the whole order was
 * restored AT cancellation time (`inventoryRestoredOnCancel === true`),
 * every line is already fully accounted for (remaining 0), matching the
 * existing all-or-nothing cancellation-restock decision, which is never
 * rewritten by a later receipt. Otherwise remaining = ordered quantity minus
 * whatever later receipts have already recorded for that line.
 */
function toDetailItems(
  rows: OrderItemRow[],
  order: OrderRow,
  alreadyReturnedByItem: Map<string, number>,
): AdminOrderDetail['items'] {
  return rows.map((i) => {
    let stockReturn: AdminOrderDetail['items'][number]['stockReturn'] = null
    if (order.status === 'cancelled' && order.paymentMethod === 'cod') {
      const alreadyReturned =
        order.inventoryRestoredOnCancel === true
          ? i.quantity
          : (alreadyReturnedByItem.get(i.id) ?? 0)
      stockReturn = {
        originalDeductedQuantity: i.quantity,
        alreadyReturnedQuantity: alreadyReturned,
        remainingReturnableQuantity: Math.max(0, i.quantity - alreadyReturned),
      }
    }
    return {
      orderItemId: i.id,
      productId: i.productId,
      variantId: i.variantId,
      sku: i.skuSnapshot,
      productNameAr: i.productNameArSnapshot,
      productNameEn: i.productNameEnSnapshot,
      variantLabelAr: i.variantLabelArSnapshot,
      variantLabelEn: i.variantLabelEnSnapshot,
      unitPriceMinor: i.unitPriceMinor,
      quantity: i.quantity,
      lineTotalMinor: i.lineTotalMinor,
      stockReturn,
    }
  })
}

async function buildReceiptDoc(
  db: DbClient,
  receipt: { id: string; createdAt: Date; receivedByStaffId: string | null; note: string | null },
  itemById: Map<string, OrderItemRow>,
): Promise<AdminOrderStockReturnReceipt> {
  const lines = await listItemsForReturn(db, receipt.id)
  const receivedBy =
    receipt.receivedByStaffId === null
      ? undefined
      : await getStaffUser(db, receipt.receivedByStaffId)
  return {
    id: receipt.id,
    createdAt: receipt.createdAt.toISOString(),
    receivedBy:
      receipt.receivedByStaffId === null
        ? null
        : receivedBy === undefined
          ? null
          : { id: receivedBy.id, nameAr: receivedBy.nameAr, nameEn: receivedBy.nameEn },
    note: receipt.note,
    lines: lines.map((l) => {
      const item = itemById.get(l.orderItemId)
      return {
        orderItemId: l.orderItemId,
        variantId: l.variantId,
        sku: item?.skuSnapshot ?? '',
        productNameAr: item?.productNameArSnapshot ?? '',
        productNameEn: item?.productNameEnSnapshot ?? '',
        quantity: l.quantity,
      }
    }),
  }
}

async function toStockReturnReceipts(
  db: DbClient,
  orderId: string,
  items: OrderItemRow[],
): Promise<AdminOrderStockReturnReceipt[]> {
  const receipts = await listReturnsForOrder(db, orderId)
  if (receipts.length === 0) return []
  const itemById = new Map(items.map((i) => [i.id, i]))
  const out: AdminOrderStockReturnReceipt[] = []
  for (const receipt of receipts) {
    out.push(await buildReceiptDoc(db, receipt, itemById))
  }
  return out
}

function toCustomerCard(customer: CustomerRow, isReturning: boolean): StoreSaleCustomerCard {
  return {
    id: customer.id,
    phoneNormalized: customer.phoneNormalized,
    nameEn: customer.firstNameEn,
    nameAr: customer.firstNameAr,
    cityEn: customer.cityEn,
    cityAr: customer.cityAr,
    addressEn: customer.addressEn,
    addressAr: customer.addressAr,
    isReturning,
  }
}

export async function getAdminOrderDetailService(
  db: DbClient,
  orderId: string,
): Promise<AdminOrderDetail> {
  const order = await getOrderById(db, orderId)
  if (order === undefined) throw new NotFoundError('order not found')
  const items = await listOrderItems(db, orderId)
  const alreadyReturnedByItem =
    order.status === 'cancelled' ? await sumReturnedQuantityByOrderItem(db, orderId) : new Map()

  let customerAccount: StoreSaleCustomerCard | null = null
  if (order.customerId !== null) {
    const [customerRow, isReturning] = await Promise.all([
      getCustomerById(db, order.customerId),
      customerHasOtherTransactions(db, order.customerId, { orderId: order.id }),
    ])
    if (customerRow !== undefined) customerAccount = toCustomerCard(customerRow, isReturning)
  }

  return {
    id: order.id,
    number: order.number,
    customer: {
      name: order.customerNameAr ?? order.customerNameEn ?? '',
      phone: order.customerPhoneNormalized,
      city: order.cityAr ?? order.cityEn,
      addressLine1: order.addressLine1Ar ?? order.addressLine1En,
      addressLine2: order.addressLine2Ar ?? order.addressLine2En,
      note: order.customerNote,
    },
    customerAccount,
    delivery: {
      zoneCode: order.deliveryZoneCodeSnapshot,
      zoneNameAr: order.deliveryZoneNameArSnapshot,
      zoneNameEn: order.deliveryZoneNameEnSnapshot,
      feeMinor: order.deliveryFeeMinor,
    },
    items: toDetailItems(items, order, alreadyReturnedByItem),
    totals: {
      subtotalMinor: order.subtotalMinor,
      deliveryFeeMinor: order.deliveryFeeMinor,
      taxMinor: order.taxMinor,
      totalMinor: order.totalMinor,
      currency: order.currency,
    },
    payment: { method: order.paymentMethod, status: order.paymentStatus },
    fulfillment: {
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      deliveringAt: order.deliveringAt?.toISOString() ?? null,
      completedAt: order.completedAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      cancelledReason: order.cancelledReason,
      inventoryRestoredOnCancel: order.inventoryRestoredOnCancel,
    },
    vendorNote: order.vendorNote,
    stockReturns:
      order.status === 'cancelled' ? await toStockReturnReceipts(db, orderId, items) : [],
  }
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

const ACTION_TO_TYPE: Record<string, AdminOrderTimelineEntry['type']> = {
  'order.created': 'created',
  'order.delivery_started': 'delivery_started',
  'order.completed': 'completed',
  'order.cancelled': 'cancelled',
  'order.stock_returned': 'stock_returned',
}

function safeMeta(json: string | null): AdminOrderTimelineEntry['meta'] {
  if (json === null) return undefined
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    const meta: NonNullable<AdminOrderTimelineEntry['meta']> = {}
    if (typeof parsed.fromStatus === 'string') meta.fromStatus = parsed.fromStatus
    if (typeof parsed.toStatus === 'string') meta.toStatus = parsed.toStatus
    if (typeof parsed.restocked === 'boolean') meta.restocked = parsed.restocked
    if (typeof parsed.quantity === 'number') meta.quantity = parsed.quantity
    return Object.keys(meta).length > 0 ? meta : undefined
  } catch {
    return undefined
  }
}

export async function getAdminOrderTimelineService(
  db: DbClient,
  orderId: string,
): Promise<AdminOrderTimelineEntry[]> {
  const order = await getOrderById(db, orderId)
  if (order === undefined) throw new NotFoundError('order not found')

  const rows = await listAuditForEntity(db, 'order', orderId)
  const entries: AdminOrderTimelineEntry[] = []
  for (const row of rows) {
    const type = ACTION_TO_TYPE[row.action]
    if (type === undefined) continue
    entries.push({
      type,
      at: row.createdAt.toISOString(),
      actor:
        row.actorStaffId === null
          ? null
          : { id: row.actorStaffId, nameAr: row.actorNameAr ?? '', nameEn: row.actorNameEn },
      meta: safeMeta(row.metadataJson),
    })
  }
  return entries
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function commandResult(order: OrderRow): AdminOrderCommandResult {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    paymentStatus: order.paymentStatus,
    deliveringAt: order.deliveringAt?.toISOString() ?? null,
    completedAt: order.completedAt?.toISOString() ?? null,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    inventoryRestoredOnCancel: order.inventoryRestoredOnCancel,
  }
}

/**
 * processing → delivering. No inventory or payment mutation.
 *
 * COD: must be unpaid (COD only becomes paid on completion). Electronic:
 * must already be paid — a successful payment is what put it in `processing`
 * eligible-for-fulfillment shape; this transition never touches
 * `payment_status`, never attempts a payment, never mutates inventory (stock
 * was already committed at payment-success time). Matches the 0008 lifecycle
 * guard's electronic `processing -> delivering` row-shape exactly.
 */
export async function startDeliveryService(
  db: DbClient,
  orderId: string,
  actorStaffId: string,
): Promise<AdminOrderCommandResult> {
  const updated = await withDeadlockRetry(() =>
    db.transaction(async (tx) => {
      const order = await getOrderForUpdate(tx, orderId)
      if (order === undefined) throw new NotFoundError('order not found')
      if (order.status === 'delivering') {
        throw new InvalidOrderTransitionError({ current: 'delivering' })
      }
      if (order.status !== 'processing') {
        throw new InvalidOrderTransitionError({ current: order.status, expected: 'processing' })
      }
      if (order.paymentMethod === 'cod') {
        if (order.paymentStatus !== 'unpaid') {
          throw new PaymentStateConflictError({
            expected: 'unpaid',
            current: order.paymentStatus,
            note: 'a processing COD order must be unpaid',
          })
        }
      } else {
        if (order.paymentStatus !== 'paid') {
          throw new PaymentStateConflictError({
            expected: 'paid',
            current: order.paymentStatus,
            note: 'an electronic order can only be advanced once paid',
          })
        }
      }

      const next = await applyOrderTransition(tx, orderId, 'processing', {
        status: 'delivering',
        deliveringAt: new Date(),
      })
      if (next === undefined) throw new InvalidOrderTransitionError({ expected: 'processing' })

      await recordAudit(
        tx,
        auditActor(actorStaffId),
        'order.delivery_started',
        'order',
        orderId,
        auditMeta({ number: next.number, fromStatus: 'processing', toStatus: 'delivering' }),
      )
      return next
    }),
  )
  return commandResult(updated)
}

/**
 * delivering → completed. COD becomes paid ONLY here. Electronic is already
 * paid and stays paid — this transition never attempts a payment, never
 * writes a payment event, and never mutates inventory for an electronic
 * order (stock was already committed at payment-success time).
 */
export async function completeOrderService(
  db: DbClient,
  orderId: string,
  actorStaffId: string,
): Promise<AdminOrderCommandResult> {
  const updated = await withDeadlockRetry(() =>
    db.transaction(async (tx) => {
      const order = await getOrderForUpdate(tx, orderId)
      if (order === undefined) throw new NotFoundError('order not found')
      if (order.status === 'completed') {
        throw new InvalidOrderTransitionError({ current: 'completed' })
      }
      if (order.status !== 'delivering') {
        throw new InvalidOrderTransitionError({ current: order.status, expected: 'delivering' })
      }
      if (order.paymentMethod === 'cod') {
        if (order.paymentStatus !== 'unpaid') {
          throw new PaymentStateConflictError({
            expected: 'unpaid',
            current: order.paymentStatus,
            note: 'a delivering COD order must be unpaid before completion',
          })
        }
      } else {
        if (order.paymentStatus !== 'paid') {
          throw new PaymentStateConflictError({
            expected: 'paid',
            current: order.paymentStatus,
            note: 'an electronic order must already be paid',
          })
        }
      }

      // COD flips unpaid -> paid on completion (0008 guard requires it in the
      // same row-shape UPDATE); electronic is already 'paid' and must stay
      // byte-for-byte unchanged, or the guard's electronic row-shape check
      // rejects the UPDATE.
      const next = await applyOrderTransition(tx, orderId, 'delivering', {
        status: 'completed',
        completedAt: new Date(),
        paymentStatus: order.paymentMethod === 'cod' ? 'paid' : order.paymentStatus,
      })
      if (next === undefined) throw new InvalidOrderTransitionError({ expected: 'delivering' })

      await recordAudit(
        tx,
        auditActor(actorStaffId),
        'order.completed',
        'order',
        orderId,
        auditMeta({ number: next.number, fromStatus: 'delivering', toStatus: 'completed' }),
      )
      return next
    }),
  )
  return commandResult(updated)
}

/**
 * processing|delivering → cancelled (COD only).
 *  - processing  → always restores committed stock (goods never left the store).
 *  - delivering  → caller MUST supply `restockReturnedItems`; the decision is
 *    persisted on `inventory_restored_on_cancel` and never rewritten.
 */
export async function cancelOrderService(
  db: DbClient,
  orderId: string,
  input: OrderCancelInput,
  actorStaffId: string,
): Promise<AdminOrderCommandResult> {
  const updated = await withDeadlockRetry(() =>
    db.transaction(async (tx) => {
      const order = await getOrderForUpdate(tx, orderId)
      if (order === undefined) throw new NotFoundError('order not found')
      if (order.status === 'cancelled') throw new OrderAlreadyCancelledError()
      if (order.status === 'completed') {
        throw new OrderNotCancellableError({ current: 'completed', reason: 'terminal' })
      }
      if (order.status !== 'processing' && order.status !== 'delivering') {
        throw new OrderNotCancellableError({ current: order.status })
      }
      if (order.paymentMethod !== 'cod') {
        throw new OrderNotCancellableError({ paymentMethod: order.paymentMethod })
      }
      if (order.paymentStatus !== 'unpaid') {
        throw new PaymentStateConflictError({
          expected: 'unpaid',
          current: order.paymentStatus,
          note: 'a paid order is not cancellable in B2',
        })
      }

      let restock: boolean
      if (order.status === 'processing') {
        restock = true
      } else {
        if (input.restockReturnedItems === undefined) throw new RestockDecisionRequiredError()
        restock = input.restockReturnedItems
      }
      const fromStatus = order.status

      const next = await applyOrderTransition(tx, orderId, fromStatus, {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledByStaffId: actorStaffId,
        cancelledReason: input.reason,
        inventoryRestoredOnCancel: restock,
        // Gate B4: the 0008 lifecycle guard requires a COD cancellation to
        // record its source in the SAME transition UPDATE. Staff-initiated
        // cancellation is always 'staff'; 'system_payment_expiry' is reserved
        // for the electronic reconciliation worker.
        cancellationSource: 'staff',
      })
      if (next === undefined) throw new InvalidOrderTransitionError({ expected: fromStatus })

      if (restock) {
        const items = await listOrderItems(tx, orderId)
        const ordered = [...items].sort((a, b) =>
          a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
        )
        for (const line of ordered) {
          await ensureBalance(tx, line.variantId)
          const balance = await addStock(tx, line.variantId, line.quantity)
          await insertMovement(tx, {
            variantId: line.variantId,
            movementType: 'ORDER_CANCELLATION_RESTORE',
            quantityChange: line.quantity,
            quantityAfter: balance?.quantityOnHand ?? null,
            orderId,
            staffId: actorStaffId,
            reason: 'order cancellation restore',
          })
        }
      }

      await recordAudit(
        tx,
        auditActor(actorStaffId),
        'order.cancelled',
        'order',
        orderId,
        auditMeta({
          number: next.number,
          fromStatus,
          toStatus: 'cancelled',
          restocked: restock,
        }),
      )
      return next
    }),
  )
  return commandResult(updated)
}

// ---------------------------------------------------------------------------
// Delayed physical stock-return receipt (final pre-provider correction)
// ---------------------------------------------------------------------------

/**
 * Record merchandise physically received back at the store after a
 * cancelled order — a separate, later event from the cancellation itself
 * (goods may have still been with a courier at cancel time). Never touches
 * `orders.status` (stays `cancelled`) or any payment row — this is a
 * physical-inventory fact only, never a refund.
 *
 * All-or-nothing per receipt: every submitted line is validated against its
 * live `remainingReturnableQuantity` before any write; one over-limit line
 * rejects the whole receipt with zero mutation. Idempotent: replaying the
 * same `idempotencyKey` with byte-identical lines returns the original
 * receipt with zero new mutation; the same key with different lines is a
 * 409. Concurrency-safe: the affected `inventory_balances` rows are locked
 * (`SELECT ... FOR UPDATE`, ascending `variant_id` — the repo-wide lock
 * order) before remaining-quantity is computed from a fresh read, so two
 * racing requests for the last outstanding unit serialize instead of both
 * succeeding.
 */
export async function recordOrderStockReturnService(
  db: DbClient,
  orderId: string,
  input: OrderStockReturnRequest,
  actorStaffId: string,
): Promise<AdminOrderStockReturnReceipt> {
  const receipt = await withDeadlockRetry(() =>
    db.transaction(async (tx) => {
      // Idempotency: check for a prior receipt under this key INSIDE the
      // transaction (after the order lock below settles concurrent ordering)
      // via the unique index — a concurrent duplicate submit blocks on the
      // order row lock first, so by the time it reaches this check the first
      // request has already committed and this read sees it.
      const order = await getOrderForUpdate(tx, orderId)
      if (order === undefined) throw new NotFoundError('order not found')
      if (order.status !== 'cancelled') {
        throw new OrderNotReturnEligibleError({ current: order.status })
      }

      const existing = await getReturnByIdempotencyKey(tx, input.idempotencyKey)
      const items = await listOrderItems(tx, orderId)
      const itemById = new Map(items.map((i) => [i.id, i]))

      if (existing !== undefined) {
        const existingLines = await listItemsForReturn(tx, existing.id)
        const matches =
          existing.orderId === orderId &&
          existingLines.length === input.lines.length &&
          input.lines.every((line) =>
            existingLines.some(
              (e) => e.orderItemId === line.orderItemId && e.quantity === line.quantity,
            ),
          )
        if (!matches) {
          throw new ReturnIdempotencyConflictError({ idempotencyKey: input.idempotencyKey })
        }
        // Byte-identical replay — return the original receipt, mutate nothing.
        return buildReceiptDoc(tx, existing, itemById)
      }

      // inventory_restored_on_cancel === true means the whole order was
      // already fully restored at cancellation — nothing is outstanding.
      if (order.inventoryRestoredOnCancel === true) {
        throw new NoOutstandingReturnError({ reason: 'already fully restored at cancellation' })
      }

      const alreadyReturnedByItem = await sumReturnedQuantityByOrderItem(tx, orderId)

      const lines: Array<{ orderItemId: string; variantId: string; quantity: number }> = []
      for (const line of input.lines) {
        const item = itemById.get(line.orderItemId)
        if (item === undefined) {
          throw new ReturnQuantityExceedsRemainingError({
            orderItemId: line.orderItemId,
            reason: 'order item does not belong to this order',
          })
        }
        lines.push({ orderItemId: item.id, variantId: item.variantId, quantity: line.quantity })
      }

      // Lock every affected variant balance, ascending variant_id, BEFORE
      // computing remaining — this is what makes two concurrent receipts for
      // the same variant serialize rather than both reading a stale sum.
      const variantIds = lines.map((l) => l.variantId)
      for (const variantId of new Set(variantIds)) await ensureBalance(tx, variantId)
      const balances = await getBalancesForUpdate(tx, variantIds)

      for (const line of lines) {
        const item = itemById.get(line.orderItemId)
        if (item === undefined) continue
        const alreadyReturned = alreadyReturnedByItem.get(line.orderItemId) ?? 0
        const remaining = Math.max(0, item.quantity - alreadyReturned)
        if (line.quantity > remaining) {
          throw new ReturnQuantityExceedsRemainingError({
            orderItemId: line.orderItemId,
            requested: line.quantity,
            remaining,
          })
        }
      }

      const { receipt: newReceipt } = await insertOrderStockReturn(tx, {
        orderId,
        idempotencyKey: input.idempotencyKey,
        receivedByStaffId: actorStaffId,
        note: input.note ?? null,
        lines,
      })

      let totalQuantity = 0
      for (const line of lines) {
        totalQuantity += line.quantity
        const balance = balances.get(line.variantId)
        const updated = await addStock(tx, line.variantId, line.quantity)
        await insertMovement(tx, {
          variantId: line.variantId,
          movementType: 'RETURN',
          quantityChange: line.quantity,
          quantityAfter: updated?.quantityOnHand ?? balance?.quantityOnHand ?? null,
          orderId,
          staffId: actorStaffId,
          reason: 'physical stock return recorded after cancellation',
        })
      }

      await recordAudit(
        tx,
        auditActor(actorStaffId),
        'order.stock_returned',
        'order',
        orderId,
        auditMeta({ number: order.number, quantity: totalQuantity, receiptId: newReceipt.id }),
      )

      return buildReceiptDoc(tx, newReceipt, itemById)
    }),
  )
  return receipt
}
