/**
 * Category service: code/slug uniqueness, soft-disable safety, audit trail.
 */
import {
  ConflictError,
  NotFoundError,
  slugify,
  type CategoryCreateInput,
  type CategoryListQuery,
  type CategoryUpdateInput,
} from '@likehoney/shared'
import {
  countProductsInCategory,
  createCategory,
  getCategory,
  getCategoryByCode,
  getCategoryBySlug,
  listCategories,
  removeCategory,
  updateCategory,
  type CategoryRow,
  type DbClient,
} from '@likehoney/db'

import { mediaStreamUrl } from '../media/storage'
import { auditMeta, recordAudit, type AuditActor } from './audit'

/**
 * Admin category document. URLs are minted by the backend; the raw R2 object
 * key is included (parity with product media) but the binary always streams
 * through the authenticated `/api/v1/media/stream` route.
 */
export function serializeCategory(category: CategoryRow, origin: string) {
  return {
    id: category.id,
    code: category.code,
    slug: category.slug,
    nameEn: category.nameEn,
    nameAr: category.nameAr,
    descriptionEn: category.descriptionEn,
    descriptionAr: category.descriptionAr,
    status: category.status,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
    imageObjectKey: category.imageObjectKey,
    imageMimeType: category.imageMimeType,
    imageSizeBytes: category.imageSizeBytes,
    imageUrl:
      category.imageObjectKey === null ? null : mediaStreamUrl(origin, category.imageObjectKey),
    iconKey: category.iconKey,
    visualMode: category.visualMode,
  }
}

function slugOrThrow(inputSlug: string | undefined, nameEn: string): string {
  if (inputSlug !== undefined) return inputSlug
  const derived = slugify(nameEn)
  if (!derived) {
    throw new ConflictError('cannot derive a slug from the English name; provide one explicitly')
  }
  return derived
}

export async function listCategoriesService(
  db: DbClient,
  query: CategoryListQuery,
  origin: string,
) {
  const { rows, total } = await listCategories(db, query)
  return {
    data: rows.map((row) => serializeCategory(row, origin)),
    meta: { page: query.page, pageSize: query.pageSize, total },
  }
}

export async function getCategoryService(db: DbClient, categoryId: string, origin: string) {
  const category = await getCategory(db, categoryId)
  if (category === undefined) throw new NotFoundError('category not found')
  return serializeCategory(category, origin)
}

export async function createCategoryService(
  db: DbClient,
  input: CategoryCreateInput,
  actor: AuditActor,
  origin: string,
) {
  const byCode = await getCategoryByCode(db, input.code)
  if (byCode !== undefined) {
    throw new ConflictError('category code is already in use', { code: input.code })
  }

  const slug = slugOrThrow(input.slug, input.nameEn)
  const bySlug = await getCategoryBySlug(db, slug)
  if (bySlug !== undefined) {
    throw new ConflictError('category slug is already in use', { slug })
  }

  const category = await createCategory(db, {
    nameEn: input.nameEn,
    nameAr: input.nameAr,
    code: input.code,
    slug,
    descriptionEn: input.descriptionEn ?? null,
    descriptionAr: input.descriptionAr ?? null,
    status: input.status ?? 'active',
    iconKey: input.iconKey ?? null,
    visualMode: input.visualMode ?? 'auto',
  })

  await recordAudit(
    db,
    actor,
    'category.created',
    'category',
    category.id,
    auditMeta({ code: category.code }),
  )
  return serializeCategory(category, origin)
}

export async function updateCategoryService(
  db: DbClient,
  categoryId: string,
  input: CategoryUpdateInput,
  actor: AuditActor,
  origin: string,
) {
  const existing = await getCategory(db, categoryId)
  if (existing === undefined) throw new NotFoundError('category not found')

  if (input.slug !== undefined && input.slug !== existing.slug) {
    const bySlug = await getCategoryBySlug(db, input.slug)
    if (bySlug !== undefined) {
      throw new ConflictError('category slug is already in use', { slug: input.slug })
    }
  }

  const category = await updateCategory(db, categoryId, {
    nameEn: input.nameEn,
    nameAr: input.nameAr,
    slug: input.slug,
    descriptionEn: input.descriptionEn,
    descriptionAr: input.descriptionAr,
    status: input.status,
    iconKey: input.iconKey,
    visualMode: input.visualMode,
  })

  if (category === undefined) throw new NotFoundError('category not found')
  await recordAudit(db, actor, 'category.updated', 'category', category.id)
  return serializeCategory(category, origin)
}

export async function removeCategoryService(
  db: DbClient,
  categoryId: string,
  actor: AuditActor,
  origin: string,
) {
  const existing = await getCategory(db, categoryId)
  if (existing === undefined) throw new NotFoundError('category not found')

  const productCount = await countProductsInCategory(db, categoryId)
  if (productCount > 0) {
    throw new ConflictError('category has products; set status inactive instead', {
      productCount,
    })
  }

  const removed = await removeCategory(db, categoryId)
  if (removed === undefined) throw new NotFoundError('category not found')
  await recordAudit(
    db,
    actor,
    'category.deleted',
    'category',
    removed.id,
    auditMeta({ code: removed.code }),
  )
  return serializeCategory(removed, origin)
}
