/**
 * Public (customer-facing) catalog service.
 *
 * Serves only sellable catalog data: `active` products and `active` variants,
 * with authoritative prices (integer minor units) and stock. Never projects
 * supplier internals, cost data, audit fields or staff data. Media URLs are
 * minted from the request origin; binary content streams through the public
 * Worker media route on the same origin.
 */
import { NotFoundError, type PublicProductListQuery } from '@likehoney/shared'
import type { DbClient } from '@likehoney/db'
import {
  getActiveCategoryById,
  getActiveCategoryBySlug,
  getPublicProduct,
  listActiveCategories,
  listPublicProducts,
  loadPublicProductJoins,
} from '@likehoney/db'

import { mediaStreamUrl } from '../media/storage'

interface CategorySummary {
  id: string
  code: string
  slug: string
  nameEn: string
  nameAr: string
}

async function categorySummary(
  db: DbClient,
  categoryId: string | null,
): Promise<CategorySummary | null> {
  if (categoryId === null) return null
  const category = await getActiveCategoryById(db, categoryId)
  if (category === undefined) return null
  return {
    id: category.id,
    code: category.code,
    slug: category.slug,
    nameEn: category.nameEn,
    nameAr: category.nameAr,
  }
}

function primaryImageUrl(media: PublicProductMediaRow[], origin: string): string | null {
  const ordered = [...media].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
    return a.sortOrder - b.sortOrder
  })
  const primary = ordered[0]
  if (primary === undefined) return null
  return mediaStreamUrl(origin, primary.objectKey, { public: true })
}

interface PublicProductMediaRow {
  objectKey: string
  isPrimary: boolean
  sortOrder: number
}

export interface PublicProductListItem {
  id: string
  sequence: number
  nameEn: string
  nameAr: string
  shortBlurbEn: string | null
  shortBlurbAr: string | null
  status: 'active'
  category: CategorySummary | null
  priceFromMinor: number
  priceToMinor: number
  inStock: boolean
  imageUrl: string | null
  /**
   * True when the product needs an option choice before it can be added to
   * cart (more than one active variant). Computed from the same variant
   * join already loaded for pricing/stock — no extra query. Lets the
   * storefront's ProductCard show "quick add" vs "choose option" without a
   * per-card product-detail fetch (only single-variant products carry
   * `singleVariantId`, so a true quick-add still never guesses a variant).
   */
  hasOptions: boolean
  singleVariantId: string | null
}

export async function listPublicProductsService(
  db: DbClient,
  query: PublicProductListQuery,
  origin: string,
) {
  const { rows, total } = await listPublicProducts(db, {
    page: query.page,
    pageSize: query.pageSize,
    categoryId: query.categoryId,
    search: query.search,
  })

  const ids = rows.map((row) => row.id)
  const joins = await loadPublicProductJoins(db, ids)

  if (rows.length === 0) {
    return {
      data: [] as PublicProductListItem[],
      meta: { page: query.page, pageSize: query.pageSize, total },
    }
  }

  const data: PublicProductListItem[] = []
  for (const row of rows) {
    const join = joins.get(row.id)
    const variants = join?.variants ?? []
    const prices = variants.map((variant) => variant.priceMinor)
    const priceFromMinor = prices.length > 0 ? Math.min(...prices) : 0
    const priceToMinor = prices.length > 0 ? Math.max(...prices) : 0
    const inStock = variants.some((variant) => (join?.balances.get(variant.id) ?? 0) > 0)
    data.push({
      id: row.id,
      sequence: row.sequence,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      shortBlurbEn: row.shortBlurbEn,
      shortBlurbAr: row.shortBlurbAr,
      status: 'active',
      category: await categorySummary(db, row.categoryId),
      priceFromMinor,
      priceToMinor,
      inStock,
      hasOptions: variants.length > 1,
      singleVariantId: variants.length === 1 ? (variants[0]?.id ?? null) : null,
      imageUrl: primaryImageUrl((join?.media ?? []) as PublicProductMediaRow[], origin),
    })
  }

  return { data, meta: { page: query.page, pageSize: query.pageSize, total } }
}

export interface PublicProductDetail {
  id: string
  sequence: number
  nameEn: string
  nameAr: string
  descriptionEn: string | null
  descriptionAr: string | null
  shortBlurbEn: string | null
  shortBlurbAr: string | null
  status: 'active'
  category: CategorySummary | null
  priceFromMinor: number
  priceToMinor: number
  options: {
    id: string
    nameEn: string
    nameAr: string
    values: { id: string; code: string; valueEn: string; valueAr: string }[]
  }[]
  variants: {
    id: string
    sku: string
    priceMinor: number
    optionLabelEn: string | null
    optionLabelAr: string | null
    optionValueIds: string[]
    quantityOnHand: number
  }[]
  media: {
    id: string
    mediaType: 'image' | 'video'
    url: string
    altEn: string | null
    altAr: string | null
    isPrimary: boolean
  }[]
}

export async function getPublicProductDetailService(
  db: DbClient,
  productId: string,
  origin: string,
): Promise<PublicProductDetail> {
  const product = await getPublicProduct(db, productId)
  if (product === undefined) throw new NotFoundError('product not found')

  const join = (await loadPublicProductJoins(db, [product.id])).get(product.id)
  const variants = join?.variants ?? []
  const prices = variants.map((variant) => variant.priceMinor)
  const priceFromMinor = prices.length > 0 ? Math.min(...prices) : 0
  const priceToMinor = prices.length > 0 ? Math.max(...prices) : 0

  const optionValueIdsByVariant = new Map<string, string[]>()
  for (const link of join?.optionValueLinks ?? []) {
    const list = optionValueIdsByVariant.get(link.variantId) ?? []
    list.push(link.optionValueId)
    optionValueIdsByVariant.set(link.variantId, list)
  }

  const options = (join?.options ?? [])
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((option) => ({
      id: option.id,
      nameEn: option.nameEn,
      nameAr: option.nameAr,
      values: (join?.optionValues ?? [])
        .filter((value) => value.optionId === option.id)
        .map((value) => ({
          id: value.id,
          code: value.code,
          valueEn: value.valueEn,
          valueAr: value.valueAr,
        })),
    }))

  const publicVariants = variants.map((variant) => ({
    id: variant.id,
    sku: variant.sku,
    priceMinor: variant.priceMinor,
    optionLabelEn: variant.optionLabelEn,
    optionLabelAr: variant.optionLabelAr,
    optionValueIds: optionValueIdsByVariant.get(variant.id) ?? [],
    quantityOnHand: join?.balances.get(variant.id) ?? 0,
  }))

  const media = (join?.media ?? [])
    .slice()
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
      return a.sortOrder - b.sortOrder
    })
    .map((row) => ({
      id: row.id,
      mediaType: row.mediaType,
      url: mediaStreamUrl(origin, row.objectKey, { public: true }),
      altEn: row.altEn,
      altAr: row.altAr,
      isPrimary: row.isPrimary,
    }))

  return {
    id: product.id,
    sequence: product.sequence,
    nameEn: product.nameEn,
    nameAr: product.nameAr,
    descriptionEn: product.descriptionEn,
    descriptionAr: product.descriptionAr,
    shortBlurbEn: product.shortBlurbEn,
    shortBlurbAr: product.shortBlurbAr,
    status: 'active',
    category: await categorySummary(db, product.categoryId),
    priceFromMinor,
    priceToMinor,
    options,
    variants: publicVariants,
    media,
  }
}

export async function listPublicCategoriesService(db: DbClient, origin: string) {
  const rows = await listActiveCategories(db)
  return rows.map((category) => ({
    id: category.id,
    code: category.code,
    slug: category.slug,
    nameEn: category.nameEn,
    nameAr: category.nameAr,
    imageUrl:
      category.imageObjectKey === null
        ? null
        : mediaStreamUrl(origin, category.imageObjectKey, { public: true }),
    iconKey: category.iconKey,
    visualMode: category.visualMode,
  }))
}

export async function getPublicCategoryBySlugService(db: DbClient, slug: string) {
  const category = await getActiveCategoryBySlug(db, slug)
  if (category === undefined) throw new NotFoundError('category not found')
  return {
    id: category.id,
    code: category.code,
    slug: category.slug,
    nameEn: category.nameEn,
    nameAr: category.nameAr,
  }
}

export async function resolvePublicCategoryId(
  db: DbClient,
  slug: string | undefined,
  id: string | undefined,
): Promise<string | undefined> {
  if (id !== undefined) return id
  if (slug !== undefined) {
    const category = await getActiveCategoryBySlug(db, slug)
    return category?.id
  }
  return undefined
}
