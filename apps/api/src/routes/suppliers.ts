import { Hono } from 'hono'
import {
  supplierCreateSchema,
  supplierListQuerySchema,
  supplierUpdateSchema,
  uuidParamSchema,
} from '@likehoney/shared'

import type { AppEnv } from '../env'
import { requirePermission, currentStaffId } from '../http/auth'
import { parseBody, parseParams, parseQuery } from '../http/request'
import { getDatabase } from '../services/db'
import {
  createSupplierService,
  getSupplierService,
  listSuppliersService,
  removeSupplierService,
  updateSupplierService,
} from '../services/suppliers'
import { auditActor } from '../services/audit'

export const suppliersRouter = new Hono<AppEnv>()

suppliersRouter.get('/', requirePermission('catalog:read'), async (c) => {
  const query = parseQuery(c, supplierListQuerySchema)
  return c.json(await listSuppliersService(getDatabase(c.env), query))
})

suppliersRouter.get('/:id', requirePermission('catalog:read'), async (c) => {
  const { id } = parseParams(c, uuidParamSchema)
  return c.json(await getSupplierService(getDatabase(c.env), id))
})

suppliersRouter.post('/', requirePermission('suppliers:write'), async (c) => {
  const input = await parseBody(c, supplierCreateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const supplier = await createSupplierService(db, input, actor)
  return c.json(supplier, 201)
})

suppliersRouter.patch('/:id', requirePermission('suppliers:write'), async (c) => {
  const { id } = parseParams(c, uuidParamSchema)
  const input = await parseBody(c, supplierUpdateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const supplier = await updateSupplierService(db, id, input, actor)
  return c.json(supplier)
})

suppliersRouter.delete('/:id', requirePermission('suppliers:write'), async (c) => {
  const { id } = parseParams(c, uuidParamSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const removed = await removeSupplierService(db, id, actor)
  return c.json(removed)
})
