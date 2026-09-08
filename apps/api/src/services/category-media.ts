/**
 * Category display-image service.
 *
 * Category images follow the same physics as product media: the binary lives
 * in R2 behind the storage abstraction, and Neon stores only the object-key
 * reference + derived metadata on the `categories` row (structurally
 * "one active image" — V1, no tables). Every replacement mints a fresh UUID
 * object key, so public caching stays safe (immutable URLs, never in-place
 * overwrites).
 *
 * Sequence safety (copied from product media, §storage.ts + media service):
 *  - Set/replace: put new object FIRST → DB update (application truth) →
 *    best-effort delete of the previous object. If the DB write fails the new
 *    object is compensated (best-effort delete); the old object is never
 *    removed before the DB points at its replacement.
 *  - Remove: DB cleared FIRST → best-effort R2 delete of the previous object.
 *    The DB row is truth; a failed byte-delete leaves only a harmless orphan.
 */
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  NotFoundError,
  ValidationError,
} from '@likehoney/shared'
import { getCategory, updateCategory, type DbClient } from '@likehoney/db'

import type { MediaStorage } from '../media/storage'
import { buildCategoryObjectKey } from '../media/storage'
import { recordAudit, type AuditActor } from './audit'
import { serializeCategory } from './categories'

export interface CategoryImageUpload {
  name: string
  mimeType: string
  sizeBytes: number
  data: ArrayBuffer
}

function assertValidImage(mimeType: string, sizeBytes: number) {
  if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new ValidationError('unsupported image type; use JPEG, PNG, WebP or GIF')
  }
  if (sizeBytes > MAX_IMAGE_BYTES) {
    throw new ValidationError('category image exceeds the size limit', {
      sizeBytes,
      limit: MAX_IMAGE_BYTES,
    })
  }
}

/**
 * Uploads (or replaces) the category's display image. Replacing deletes the
 * previous R2 object best-effort AFTER the DB row points at the new key —
 * application truth never references bytes that no longer exist.
 */
export async function setCategoryImageService(
  db: DbClient,
  storage: MediaStorage,
  categoryId: string,
  upload: CategoryImageUpload,
  actor: AuditActor,
  origin: string,
) {
  const existing = await getCategory(db, categoryId)
  if (existing === undefined) throw new NotFoundError('category not found')

  assertValidImage(upload.mimeType, upload.sizeBytes)

  const objectKey = buildCategoryObjectKey(categoryId, upload.name)
  const put = await storage.putObject(objectKey, upload.data, upload.mimeType)

  try {
    const category = await updateCategory(db, categoryId, {
      imageObjectKey: objectKey,
      imageMimeType: upload.mimeType,
      imageSizeBytes: put.sizeBytes,
    })
    if (category === undefined) throw new NotFoundError('category not found')

    // Old object cleanup is best-effort: the DB already points at the new key,
    // so a failure here leaves only a harmless orphan (never a broken URL).
    if (existing.imageObjectKey !== null) {
      await storage.deleteObject(existing.imageObjectKey).catch(() => undefined)
    }

    await recordAudit(db, actor, 'category.image.updated', 'category', category.id)
    return serializeCategory(category, origin)
  } catch (err) {
    // Compensation: the new object exists but the DB was not updated — remove
    // the fresh bytes so nothing is leaked; if THAT also fails, the orphan is
    // safe to leave for a future bucket sweep.
    await storage.deleteObject(objectKey).catch(() => undefined)
    throw err
  }
}

/**
 * Removes the category's display image. DB cleared FIRST (truth), then the
 * previous object is deleted best-effort. Idempotent: a category with no
 * image simply returns its document unchanged.
 */
export async function removeCategoryImageService(
  db: DbClient,
  storage: MediaStorage,
  categoryId: string,
  actor: AuditActor,
  origin: string,
) {
  const existing = await getCategory(db, categoryId)
  if (existing === undefined) throw new NotFoundError('category not found')

  if (existing.imageObjectKey === null) {
    return serializeCategory(existing, origin)
  }

  const category = await updateCategory(db, categoryId, {
    imageObjectKey: null,
    imageMimeType: null,
    imageSizeBytes: null,
  })
  if (category === undefined) throw new NotFoundError('category not found')

  await storage.deleteObject(existing.imageObjectKey).catch(() => undefined)
  await recordAudit(db, actor, 'category.image.removed', 'category', category.id)
  return serializeCategory(category, origin)
}
