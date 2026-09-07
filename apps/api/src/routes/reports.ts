import { Hono } from 'hono'
import { reportsQuerySchema, reportsStagnantQuerySchema, uuidParamSchema } from '@likehoney/shared'

import type { AppEnv } from '../env'
import { requirePermission } from '../http/auth'
import { parseParams, parseQuery } from '../http/request'
import { getDatabase } from '../services/db'
import {
  getReportsCategoriesService,
  getReportsCustomersService,
  getReportsOverviewService,
  getReportsProductsService,
  getReportsRegionsService,
  getReportsSalesService,
  getReportsSupplierDrilldownService,
  getReportsSuppliersService,
} from '../services/reports'

/**
 * Owner Reports & Insights — every route `reports:read` (owner-only by
 * default). Read-only; the public storefront never reaches this router.
 * Period params: `period` (day|week|month|custom) + `date` / `month` /
 * `fromDate`+`toDate` — see `reportsQuerySchema`.
 */
export const reportsRouter = new Hono<AppEnv>()

reportsRouter.get('/overview', requirePermission('reports:read'), async (c) => {
  const q = parseQuery(c, reportsQuerySchema)
  return c.json(await getReportsOverviewService(getDatabase(c.env), q))
})

reportsRouter.get('/sales', requirePermission('reports:read'), async (c) => {
  const q = parseQuery(c, reportsQuerySchema)
  return c.json(await getReportsSalesService(getDatabase(c.env), q))
})

reportsRouter.get('/products', requirePermission('reports:read'), async (c) => {
  const q = parseQuery(c, reportsStagnantQuerySchema)
  return c.json(await getReportsProductsService(getDatabase(c.env), q))
})

reportsRouter.get('/suppliers', requirePermission('reports:read'), async (c) => {
  const q = parseQuery(c, reportsQuerySchema)
  return c.json(await getReportsSuppliersService(getDatabase(c.env), q))
})

reportsRouter.get('/categories', requirePermission('reports:read'), async (c) => {
  const q = parseQuery(c, reportsQuerySchema)
  return c.json(await getReportsCategoriesService(getDatabase(c.env), q))
})

/** §5 supplier drilldown — one supplier's per-product performance in the window. */
reportsRouter.get('/suppliers/:id/products', requirePermission('reports:read'), async (c) => {
  const { id } = parseParams(c, uuidParamSchema)
  const q = parseQuery(c, reportsQuerySchema)
  return c.json(await getReportsSupplierDrilldownService(getDatabase(c.env), id, q))
})

reportsRouter.get('/customers', requirePermission('reports:read'), async (c) => {
  const q = parseQuery(c, reportsQuerySchema)
  return c.json(await getReportsCustomersService(getDatabase(c.env), q))
})

reportsRouter.get('/regions', requirePermission('reports:read'), async (c) => {
  const q = parseQuery(c, reportsQuerySchema)
  return c.json(await getReportsRegionsService(getDatabase(c.env), q))
})
