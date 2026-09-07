import { Hono } from 'hono'
import { UnauthorizedError } from '@likehoney/shared'
import {
  storeSaleCreateSchema,
  storeSaleCustomerLookupQuerySchema,
  storeSaleListQuerySchema,
  storeSaleSearchQuerySchema,
  storeSaleUuidParamSchema,
} from '@likehoney/shared'

import type { AppEnv } from '../env'
import { currentStaffId, requirePermission } from '../http/auth'
import { parseBody, parseParams, parseQuery } from '../http/request'
import { getDatabase } from '../services/db'
import {
  createStoreSaleService,
  getStoreSaleDetailService,
  listStoreSalesService,
  lookupStoreSaleCustomerService,
  searchStoreSaleProductsService,
} from '../services/store-sales'

export const storeSalesRouter = new Hono<AppEnv>()

/** Register product lookup — name or SKU, with variants + live stock. */
storeSalesRouter.get('/search', requirePermission('store-sales:read'), async (c) => {
  const { q, limit } = parseQuery(c, storeSaleSearchQuerySchema)
  const origin = new URL(c.req.url).origin
  return c.json(await searchStoreSaleProductsService(getDatabase(c.env), q, limit, origin))
})

/**
 * POS phone-first customer lookup (§14) — minimal card only (never full
 * Customer 360 analytics). Gated on `store-sales:write` like the sale itself:
 * this is the minimum lookup/mutation a register operator needs, not the
 * dedicated `customers:read` directory permission.
 */
storeSalesRouter.get('/customer-lookup', requirePermission('store-sales:write'), async (c) => {
  const { phone } = parseQuery(c, storeSaleCustomerLookupQuerySchema)
  return c.json(await lookupStoreSaleCustomerService(getDatabase(c.env), phone))
})

/** Record a physical-store sale (atomic: header + items + stock + ledger + audit). */
storeSalesRouter.post('/', requirePermission('store-sales:write'), async (c) => {
  const input = await parseBody(c, storeSaleCreateSchema)
  const staffId = await currentStaffId(c)
  if (staffId === undefined) throw new UnauthorizedError('authentication required')
  const result = await createStoreSaleService(getDatabase(c.env), input, staffId)
  return c.json(result, 201)
})

/** Store-sales history. */
storeSalesRouter.get('/', requirePermission('store-sales:read'), async (c) => {
  const query = parseQuery(c, storeSaleListQuerySchema)
  return c.json(await listStoreSalesService(getDatabase(c.env), query))
})

storeSalesRouter.get('/:storeSaleId', requirePermission('store-sales:read'), async (c) => {
  const { storeSaleId } = parseParams(c, storeSaleUuidParamSchema)
  return c.json(await getStoreSaleDetailService(getDatabase(c.env), storeSaleId))
})
