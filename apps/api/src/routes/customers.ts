import { Hono } from 'hono'
import {
  customerListQuerySchema,
  customerStatusUpdateSchema,
  customerUuidParamSchema,
} from '@likehoney/shared'

import type { AppEnv } from '../env'
import { requirePermission } from '../http/auth'
import { parseBody, parseParams, parseQuery } from '../http/request'
import { getDatabase } from '../services/db'
import {
  getCustomer360Service,
  listCustomerRegionsService,
  listCustomersService,
  setCustomerStatusService,
} from '../services/customers'

/**
 * Full Customer Directory / Customer 360 — `customers:read`, owner-only by
 * default (never the minimal `store-sales:write` POS lookup). Public
 * storefront must never reach this router.
 */
export const customersRouter = new Hono<AppEnv>()

customersRouter.get('/', requirePermission('customers:read'), async (c) => {
  const query = parseQuery(c, customerListQuerySchema)
  return c.json(await listCustomersService(getDatabase(c.env), query))
})

customersRouter.get('/regions', requirePermission('customers:read'), async (c) => {
  return c.json({ data: await listCustomerRegionsService(getDatabase(c.env)) })
})

customersRouter.get('/:customerId', requirePermission('customers:read'), async (c) => {
  const { customerId } = parseParams(c, customerUuidParamSchema)
  return c.json(await getCustomer360Service(getDatabase(c.env), customerId))
})

customersRouter.patch('/:customerId/status', requirePermission('customers:read'), async (c) => {
  const { customerId } = parseParams(c, customerUuidParamSchema)
  const input = await parseBody(c, customerStatusUpdateSchema)
  return c.json(await setCustomerStatusService(getDatabase(c.env), customerId, input.status))
})
