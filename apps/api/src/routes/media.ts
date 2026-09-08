import { Hono } from 'hono'
import {
  mediaReorderSchema,
  mediaUpdateSchema,
  mediaUuidParamSchema,
  productUuidParamSchema,
  ValidationError,
} from '@likehoney/shared'

import type { AppEnv } from '../env'
import { requirePermission, currentStaffId } from '../http/auth'
import { parseBody, parseParams } from '../http/request'
import { getDatabase } from '../services/db'
import { buildMediaResponse, getMediaStorage, isSafeObjectKey } from '../media/storage'
import {
  addMediaToProductService,
  listMediaForProductService,
  removeMediaService,
  reorderMediaService,
  updateMediaMetaService,
} from '../services/media'
import { auditActor } from '../services/audit'

export const mediaRouter = new Hono<AppEnv>()

/** Multipart upload: field `file` (Blob), optional `altAr`, `altEn`, `isPrimary`. */
mediaRouter.post('/products/:productId/media', requirePermission('catalog:write'), async (c) => {
  const { productId } = parseParams(c, productUuidParamSchema)
  const form = await c.req.formData()

  const file = form.get('file')
  if (!(file instanceof Blob) || !file.size) {
    throw new ValidationError('multipart field "file" is required')
  }

  const altAr = stringOrUndefined(form.get('altAr'))
  const altEn = stringOrUndefined(form.get('altEn'))
  const isPrimary = form.get('isPrimary') === 'true'

  const db = getDatabase(c.env)
  const storage = getMediaStorage(c.env.MEDIA_BUCKET)
  const actor = auditActor(await currentStaffId(c))

  const name = (file instanceof File && file.name) || 'media'
  const media = await addMediaToProductService(
    db,
    storage,
    productId,
    {
      name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      data: await file.arrayBuffer(),
    },
    { altAr, altEn, isPrimary },
    actor,
  )
  return c.json(media, 201)
})

mediaRouter.get('/products/:productId/media', requirePermission('catalog:read'), async (c) => {
  const { productId } = parseParams(c, productUuidParamSchema)
  const origin = new URL(c.req.url).origin
  return c.json(await listMediaForProductService(getDatabase(c.env), productId, origin))
})

mediaRouter.patch(
  '/products/:productId/media/reorder',
  requirePermission('catalog:write'),
  async (c) => {
    const { productId } = parseParams(c, productUuidParamSchema)
    const input = await parseBody(c, mediaReorderSchema)
    const db = getDatabase(c.env)
    const actor = auditActor(await currentStaffId(c))
    await reorderMediaService(db, productId, input, actor)
    const origin = new URL(c.req.url).origin
    return c.json(await listMediaForProductService(db, productId, origin))
  },
)

mediaRouter.patch('/:mediaId', requirePermission('catalog:write'), async (c) => {
  const { mediaId } = parseParams(c, mediaUuidParamSchema)
  const input = await parseBody(c, mediaUpdateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const media = await updateMediaMetaService(db, mediaId, input, actor)
  return c.json(media)
})

mediaRouter.delete('/:mediaId', requirePermission('catalog:write'), async (c) => {
  const { mediaId } = parseParams(c, mediaUuidParamSchema)
  const db = getDatabase(c.env)
  const storage = getMediaStorage(c.env.MEDIA_BUCKET)
  const actor = auditActor(await currentStaffId(c))
  const removed = await removeMediaService(db, storage, mediaId, actor)
  return c.json(removed)
})

/**
 * Streams an R2 object body through the Worker. Key is provided via query.
 * Supports HTTP Range (206) for video scrubbing — see `buildMediaResponse`.
 */
mediaRouter.get('/stream', requirePermission('catalog:read'), async (c) => {
  const key = c.req.query('key')
  if (!key || !isSafeObjectKey(key)) {
    throw new ValidationError('a valid media object key query parameter is required')
  }

  const storage = getMediaStorage(c.env.MEDIA_BUCKET)
  const response = await buildMediaResponse(storage, key, c.req.header('Range'))
  if (response.status === 404) {
    return c.json({ error: { code: 'not_found', message: 'media not found' } }, 404)
  }
  return response
})

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
