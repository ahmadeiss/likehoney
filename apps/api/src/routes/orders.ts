import { Hono, type Context } from 'hono'
import { UnauthorizedError } from '@likehoney/shared'
import {
  adminOrderIdParamSchema,
  adminOrderListQuerySchema,
  orderCancelSchema,
  orderStockReturnRequestSchema,
} from '@likehoney/shared'

import type { AppEnv } from '../env'
import { currentStaffId, requirePermission } from '../http/auth'
import { parseBody, parseParams, parseQuery } from '../http/request'
import { getDatabase } from '../services/db'
import {
  cancelOrderService,
  completeOrderService,
  getAdminOrderDetailService,
  getAdminOrderTimelineService,
  listAdminOrdersService,
  listOrderStatusCountsService,
  recordOrderStockReturnService,
  startDeliveryService,
} from '../services/admin-orders'

/**
 * Admin online-order backend (Gate B2), mounted at `/api/v1/orders`. Distinct
 * from the public `/api/v1/public/orders` checkout surface. No arbitrary status
 * PATCH — only the three explicit business commands.
 */
export const ordersRouter = new Hono<AppEnv>()

async function actor(c: Context<AppEnv>): Promise<string> {
  const staffId = await currentStaffId(c)
  if (staffId === undefined) throw new UnauthorizedError('authentication required')
  return staffId
}

// --- Reads (orders:read) --------------------------------------------------

ordersRouter.get('/', requirePermission('orders:read'), async (c) => {
  const query = parseQuery(c, adminOrderListQuerySchema)
  return c.json(await listAdminOrdersService(getDatabase(c.env), query))
})

// Registered BEFORE `/:orderId` so the static path always wins: Hono routes in
// registration order and a bare `/:orderId` segment must never swallow a
// well-formed `/status-counts` read for staff who may only hold `orders:read`.
ordersRouter.get('/status-counts', requirePermission('orders:read'), async (c) => {
  return c.json(await listOrderStatusCountsService(getDatabase(c.env)))
})

ordersRouter.get('/:orderId', requirePermission('orders:read'), async (c) => {
  const { orderId } = parseParams(c, adminOrderIdParamSchema)
  return c.json(await getAdminOrderDetailService(getDatabase(c.env), orderId))
})

ordersRouter.get('/:orderId/timeline', requirePermission('orders:read'), async (c) => {
  const { orderId } = parseParams(c, adminOrderIdParamSchema)
  return c.json({ data: await getAdminOrderTimelineService(getDatabase(c.env), orderId) })
})

// --- Commands -----------------------------------------------------------

ordersRouter.post('/:orderId/start-delivery', requirePermission('orders:write'), async (c) => {
  const { orderId } = parseParams(c, adminOrderIdParamSchema)
  return c.json(await startDeliveryService(getDatabase(c.env), orderId, await actor(c)))
})

ordersRouter.post('/:orderId/complete', requirePermission('orders:write'), async (c) => {
  const { orderId } = parseParams(c, adminOrderIdParamSchema)
  return c.json(await completeOrderService(getDatabase(c.env), orderId, await actor(c)))
})

ordersRouter.post('/:orderId/cancel', requirePermission('orders:cancel'), async (c) => {
  const { orderId } = parseParams(c, adminOrderIdParamSchema)
  const input = await parseBody(c, orderCancelSchema)
  return c.json(await cancelOrderService(getDatabase(c.env), orderId, input, await actor(c)))
})

// Delayed physical stock-return receipt — reuses the EXISTING inventory-write
// permission (this is a physical-inventory fact, not an order-lifecycle
// command), never `orders:write`/`orders:cancel`. API-enforced: a staff user
// without `inventory:write` gets a 403 regardless of what the Admin UI hides.
ordersRouter.post('/:orderId/stock-returns', requirePermission('inventory:write'), async (c) => {
  const { orderId } = parseParams(c, adminOrderIdParamSchema)
  const input = await parseBody(c, orderStockReturnRequestSchema)
  return c.json(
    await recordOrderStockReturnService(getDatabase(c.env), orderId, input, await actor(c)),
  )
})
