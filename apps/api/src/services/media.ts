/**
 * Product media service. Metadata (alt text, sort, primary flag) lives in
 * Neon; the binary lives in R2 behind the storage abstraction. Only the
 * backend touches the bucket — product pages stream through the Worker route.
 */
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  NotFoundError,
  ValidationError,
  type MediaReorderInput,
  type MediaUpdateInput,
} from '@likehoney/shared'
import {
  clearPrimaryForProduct,
  countMediaForProduct,
  getMedia,
  getMediaIdsForProduct,
  getProduct,
  insertMedia,
  listMediaForProduct,
  removeMedia,
  reorderMediaForProduct,
  updateMedia,
  type DbClient,
  type MediaTypeValue,
} from '@likehoney/db'

import type { MediaStorage } from '../media/storage'
import { buildMediaObjectKey, mediaStreamUrl } from '../media/storage'
import { recordAudit, type AuditActor } from './audit'

export interface UploadedMedia {
  name: string
  mimeType: string
  sizeBytes: number
  data: ArrayBuffer
}

interface MediaMeta {
  altAr?: string
  altEn?: string
  isPrimary?: boolean
}

function resolveMediaType(mimeType: string): MediaTypeValue {
  if ((ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) return 'image'
  if ((ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(mimeType)) return 'video'
  throw new ValidationError('unsupported media type')
}

function enforceSizeLimit(mimeType: string, sizeBytes: number) {
  const isImage = (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)
  const limit = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES
  if (sizeBytes > limit) {
    throw new ValidationError('media exceeds the size limit for its type', { sizeBytes, limit })
  }
}

export function serializeMedia(
  row: Awaited<ReturnType<typeof listMediaForProduct>>[number],
  origin: string,
) {
  return {
    id: row.id,
    productId: row.productId,
    mediaType: row.mediaType,
    mimeType: row.mimeType,
    objectKey: row.objectKey,
    altAr: row.altAr,
    altEn: row.altEn,
    sortOrder: row.sortOrder,
    isPrimary: row.isPrimary,
    sizeBytes: row.sizeBytes,
    url: mediaStreamUrl(origin, row.objectKey),
  }
}

export async function addMediaToProductService(
  db: DbClient,
  storage: MediaStorage,
  productId: string,
  upload: UploadedMedia,
  meta: MediaMeta,
  actor: AuditActor,
) {
  const product = await getProduct(db, productId)
  if (product === undefined) throw new NotFoundError('product not found')

  const mediaType = resolveMediaType(upload.mimeType)
  enforceSizeLimit(upload.mimeType, upload.sizeBytes)

  const objectKey = buildMediaObjectKey(productId, upload.name)
  const put = await storage.putObject(objectKey, upload.data, upload.mimeType)

  // R2 write happens first (there is no single distributed transaction
  // across R2 + Postgres). If the metadata write then fails, the object is
  // already real bytes in the bucket with no DB row pointing at it — an
  // orphan, but a harmless one (nothing references it, nothing serves it,
  // it costs storage only). Best-effort delete it immediately so the common
  // case never leaks; if THIS delete also fails, the orphan is still safe to
  // leave for a future bucket sweep (never a correctness or security issue).
  try {
    const sortOrderValue = meta.isPrimary === true ? 0 : await countMediaForProduct(db, productId)

    const media = await db.transaction(async (tx) => {
      if (meta.isPrimary === true) {
        await clearPrimaryForProduct(tx, productId)
      }
      const inserted = await insertMedia(tx, {
        productId,
        mediaType,
        objectKey,
        altEn: meta.altEn ?? null,
        altAr: meta.altAr ?? null,
        sortOrder: sortOrderValue,
        isPrimary: meta.isPrimary ?? false,
        sizeBytes: put.sizeBytes,
        mimeType: upload.mimeType,
      })
      return inserted
    })

    await recordAudit(db, actor, 'media.created', 'media', media.id)
    return media
  } catch (err) {
    await storage.deleteObject(objectKey).catch(() => undefined)
    throw err
  }
}

export async function updateMediaMetaService(
  db: DbClient,
  mediaId: string,
  input: MediaUpdateInput,
  actor: AuditActor,
) {
  const existing = await getMedia(db, mediaId)
  if (existing === undefined) throw new NotFoundError('media not found')

  const media = await db.transaction(async (tx) => {
    if (input.isPrimary === true) {
      await clearPrimaryForProduct(tx, existing.productId)
    }
    const updated = await updateMedia(tx, mediaId, {
      altAr: input.altAr,
      altEn: input.altEn,
      sortOrder: input.sortOrder,
      isPrimary: input.isPrimary,
    })
    if (updated === undefined) {
      throw new NotFoundError('media not found')
    }
    return updated
  })

  await recordAudit(db, actor, 'media.updated', 'media', media.id)
  return media
}

/**
 * Applies a full new display order atomically (§15). `mediaIds` must be
 * exactly the product's current media set (order aside) — never a subset,
 * never an id belonging to another product — otherwise the whole request is
 * rejected before touching any row.
 */
export async function reorderMediaService(
  db: DbClient,
  productId: string,
  input: MediaReorderInput,
  actor: AuditActor,
) {
  const product = await getProduct(db, productId)
  if (product === undefined) throw new NotFoundError('product not found')

  const actualIds = await getMediaIdsForProduct(db, productId)
  const actualSet = new Set(actualIds)
  const submittedSet = new Set(input.mediaIds)
  const sameSet =
    actualIds.length === input.mediaIds.length &&
    input.mediaIds.every((id) => actualSet.has(id)) &&
    actualIds.every((id) => submittedSet.has(id))
  if (!sameSet) {
    throw new ValidationError('mediaIds must be exactly this product’s current media set')
  }

  await reorderMediaForProduct(db, productId, input.mediaIds)
  await recordAudit(db, actor, 'media.reordered', 'product', productId)
}

export async function listMediaForProductService(db: DbClient, productId: string, origin: string) {
  const product = await getProduct(db, productId)
  if (product === undefined) throw new NotFoundError('product not found')

  const rows = await listMediaForProduct(db, productId)
  return rows.map((row) => serializeMedia(row, origin))
}

export async function removeMediaService(
  db: DbClient,
  storage: MediaStorage,
  mediaId: string,
  actor: AuditActor,
) {
  const existing = await getMedia(db, mediaId)
  if (existing === undefined) throw new NotFoundError('media not found')

  // DB row goes first: application truth is the thing that must never be
  // wrong. If the row-delete fails, the R2 object is untouched — fully
  // recoverable, nothing lost. Only once the row is confirmed gone do we
  // remove the bytes; if THAT step fails, the result is a harmless orphaned
  // object (same as the upload-side compensation above) rather than a DB
  // row pointing at bytes that no longer exist.
  const removed = await removeMedia(db, mediaId)
  if (removed === undefined) throw new NotFoundError('media not found')

  // Deterministic next-primary: the removed item was primary → the next
  // lowest-display-order IMAGE (never a video) takes over, or no primary at
  // all if no image remains. A product-card thumbnail must never silently
  // become a video.
  if (removed.isPrimary) {
    const remaining = await listMediaForProduct(db, removed.productId)
    const nextPrimary = remaining.find((row) => row.mediaType === 'image')
    if (nextPrimary !== undefined) {
      await updateMedia(db, nextPrimary.id, { isPrimary: true })
    }
  }

  await storage.deleteObject(existing.objectKey)
  await recordAudit(db, actor, 'media.deleted', 'media', removed.id)
  return removed
}
