import { Hono } from 'hono'
import {
  categoryCreateSchema,
  categoryListQuerySchema,
  categoryUpdateSchema,
  uuidParamSchema,
  ValidationError,
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
import { removeCategoryImageService, setCategoryImageService } from '../services/category-media'
import { auditActor } from '../services/audit'
import { getMediaStorage } from '../media/storage'

export const categoriesRouter = new Hono<AppEnv>()

categoriesRouter.get('/', requirePermission('catalog:read'), async (c) => {
  const query = parseQuery(c, categoryListQuerySchema)
  const origin = new URL(c.req.url).origin
  return c.json(await listCategoriesService(getDatabase(c.env), query, origin))
})

categoriesRouter.get('/:id', requirePermission('catalog:read'), async (c) => {
  const { id } = parseParams(c, uuidParamSchema)
  const db = getDatabase(c.env)
  const origin = new URL(c.req.url).origin
  return c.json(await getCategoryService(db, id, origin))
})

categoriesRouter.post('/', requirePermission('catalog:write'), async (c) => {
  const input = await parseBody(c, categoryCreateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const origin = new URL(c.req.url).origin
  const category = await createCategoryService(db, input, actor, origin)
  return c.json(category, 201)
})

categoriesRouter.patch('/:id', requirePermission('catalog:write'), async (c) => {
  const { id } = parseParams(c, uuidParamSchema)
  const input = await parseBody(c, categoryUpdateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const origin = new URL(c.req.url).origin
  const category = await updateCategoryService(db, id, input, actor, origin)
  return c.json(category)
})

categoriesRouter.delete('/:id', requirePermission('catalog:write'), async (c) => {
  const { id } = parseParams(c, uuidParamSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const origin = new URL(c.req.url).origin
  const removed = await removeCategoryService(db, id, actor, origin)
  return c.json(removed)
})

/** Multipart upload: field `file` (Blob). Replaces any existing image atomically. */
categoriesRouter.post('/:id/image', requirePermission('catalog:write'), async (c) => {
  const { id } = parseParams(c, uuidParamSchema)
  const form = await c.req.formData()

  const file = form.get('file')
  if (!(file instanceof Blob) || !file.size) {
    throw new ValidationError('multipart field "file" is required')
  }

  const db = getDatabase(c.env)
  const storage = getMediaStorage(c.env.MEDIA_BUCKET)
  const actor = auditActor(await currentStaffId(c))
  const origin = new URL(c.req.url).origin

  const name = (file instanceof File && file.name) || 'category-image'
  const category = await setCategoryImageService(
    db,
    storage,
    id,
    {
      name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      data: await file.arrayBuffer(),
    },
    actor,
    origin,
  )
  return c.json(category, 200)
})

/** Removes the category's display image (idempotent when none is set). */
categoriesRouter.delete('/:id/image', requirePermission('catalog:write'), async (c) => {
  const { id } = parseParams(c, uuidParamSchema)
  const db = getDatabase(c.env)
  const storage = getMediaStorage(c.env.MEDIA_BUCKET)
  const actor = auditActor(await currentStaffId(c))
  const origin = new URL(c.req.url).origin
  const category = await removeCategoryImageService(db, storage, id, actor, origin)
  return c.json(category)
})
