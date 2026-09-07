import { Hono } from 'hono'
import {
  inventoryBalanceListQuerySchema,
  inventoryMovementCreateSchema,
  inventoryMovementListQuerySchema,
  variantUuidParamSchema,
} from '@likehoney/shared'

import type { AppEnv } from '../env'
import { requirePermission, currentStaffId } from '../http/auth'
import { parseBody, parseParams, parseQuery } from '../http/request'
import { getDatabase } from '../services/db'
import {
  getVariantInventoryService,
  getStockSummaryService,
  listInventoryBalancesService,
  listMovementsService,
  recordManualMovementService,
} from '../services/inventory'

export const inventoryRouter = new Hono<AppEnv>()

inventoryRouter.get('/summary', requirePermission('inventory:read'), async (c) => {
  return c.json(await getStockSummaryService(getDatabase(c.env)))
})

inventoryRouter.get('/balances', requirePermission('inventory:read'), async (c) => {
  const query = parseQuery(c, inventoryBalanceListQuerySchema)
  return c.json(await listInventoryBalancesService(getDatabase(c.env), query))
})

inventoryRouter.post('/movements', requirePermission('inventory:write'), async (c) => {
  const input = await parseBody(c, inventoryMovementCreateSchema)
  const db = getDatabase(c.env)
  const result = await recordManualMovementService(db, input, (await currentStaffId(c)) ?? null)
  return c.json(result, 201)
})

inventoryRouter.get('/movements', requirePermission('inventory:read'), async (c) => {
  const query = parseQuery(c, inventoryMovementListQuerySchema)
  return c.json(await listMovementsService(getDatabase(c.env), query))
})

inventoryRouter.get('/variants/:variantId', requirePermission('inventory:read'), async (c) => {
  const { variantId } = parseParams(c, variantUuidParamSchema)
  return c.json(await getVariantInventoryService(getDatabase(c.env), variantId))
})
