import { Hono } from 'hono'
import {
  categoryCreateSchema,
  categoryListQuerySchema,
  categoryUpdateSchema,
  uuidParamSchema,
} from '@likehoney/shared'

import type { AppEnv } from '../env'
import { requirePermission, currentStaffId } from '../http/auth'
import { parseBody, parseParams, parseQuery } from '../http/request'
import { getDatabase } from '../services/db'
import {
  createCategoryService,
  getCategoryService,
  listCategoriesService,
  removeCategoryService,
  updateCategoryService,
} from '../services/categories'
import { auditActor } from '../services/audit'

export const categoriesRouter = new Hono<AppEnv>()

categoriesRouter.get('/', requirePermission('catalog:read'), async (c) => {
  const query = parseQuery(c, categoryListQuerySchema)
  return c.json(await listCategoriesService(getDatabase(c.env), query))
})

categoriesRouter.get('/:id', requirePermission('catalog:read'), async (c) => {
  const { id } = parseParams(c, uuidParamSchema)
  const db = getDatabase(c.env)
  return c.json(await getCategoryService(db, id))
})

categoriesRouter.post('/', requirePermission('catalog:write'), async (c) => {
  const input = await parseBody(c, categoryCreateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const category = await createCategoryService(db, input, actor)
  return c.json(category, 201)
})

categoriesRouter.patch('/:id', requirePermission('catalog:write'), async (c) => {
  const { id } = parseParams(c, uuidParamSchema)
  const input = await parseBody(c, categoryUpdateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const category = await updateCategoryService(db, id, input, actor)
  return c.json(category)
})

categoriesRouter.delete('/:id', requirePermission('catalog:write'), async (c) => {
  const { id } = parseParams(c, uuidParamSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const removed = await removeCategoryService(db, id, actor)
  return c.json(removed)
})
