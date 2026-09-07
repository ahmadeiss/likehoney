/**
 * Public storefront catalog data access.
 *
 * These batched helpers serve the customer-facing list/detail endpoints. They
 * deliberately avoid the per-row N+1 patterns of the admin detail flow: join
 * rows are fetched in a handful of indexed `IN (...)` queries and assembled in
 * memory, which is both simple and efficient for storefront page sizes.
 *
 * Only sellable rows are considered:
 * - products with `status = 'active'`
 * - variants with `status = 'active'`
 * The caller is responsible for filtering those enum values at the query level.
 */
import { and, count, eq, ilike, inArray, or, type SQL } from 'drizzle-orm'

import type { DbClient } from '../client'
import {
  categories,
  deliveryZones,
  inventoryBalances,
  productMedia,
  productOptionValues,
  productOptions,
  productVariantOptions,
  productVariants,
  products,
  suppliers,
} from '../schema'

export interface PublicProductListOptions {
  page: number
  pageSize: number
  categoryId?: string
  /** Free-text search across Arabic and English product names. */
  search?: string
}

export interface PublicProductRow {
  id: string
  sequence: number
  categoryId: string | null
  nameEn: string
  nameAr: string
  descriptionEn: string | null
  descriptionAr: string | null
  shortBlurbEn: string | null
  shortBlurbAr: string | null
  createdAt: string | Date
}

/** Public projection lists for one product set (variants + balances + media + options). */
export interface PublicProductJoin {
  variants: (typeof productVariants.$inferSelect)[]
  balances: Map<string, number>
  media: (typeof productMedia.$inferSelect)[]
  options: (typeof productOptions.$inferSelect)[]
  optionValues: (typeof productOptionValues.$inferSelect)[]
  optionValueLinks: { variantId: string; optionValueId: string }[]
}

export async function listPublicProducts(
  db: DbClient,
  options: PublicProductListOptions,
): Promise<{ rows: PublicProductRow[]; total: number }> {
  const conditions: (SQL | undefined)[] = [eq(products.status, 'active')]
  if (options.categoryId !== undefined) {
    conditions.push(eq(products.categoryId, options.categoryId))
  }
  if (options.search !== undefined && options.search.length > 0) {
    const like = `%${options.search.toLowerCase()}%`
    conditions.push(or(ilike(products.nameEn, like), ilike(products.nameAr, like)))
  }
  const where = and(...conditions)

  const totalRows = await db.select({ value: count() }).from(products).where(where)
  const total = totalRows[0]?.value ?? 0

  const rows = await db
    .select()
    .from(products)
    .where(where)
    .orderBy(products.sequence)
    .limit(options.pageSize)
    .offset((options.page - 1) * options.pageSize)
  return { rows: rows as PublicProductRow[], total }
}

export async function getPublicProduct(
  db: DbClient,
  productId: string,
): Promise<PublicProductRow | undefined> {
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.status, 'active')))
    .limit(1)
  return rows[0] as PublicProductRow | undefined
}

/**
 * Batch-load the sellable join data for a set of products in O(few) indexed
 * queries (no per-product N+1). Option-value links are normalized into a
 * variant→optionValueId map.
 */
export async function loadPublicProductJoins(
  db: DbClient,
  productIds: string[],
): Promise<Map<string, PublicProductJoin>> {
  const result = new Map<string, PublicProductJoin>()
  if (productIds.length === 0) return result
  for (const id of productIds) {
    result.set(id, {
      variants: [],
      balances: new Map(),
      media: [],
      options: [],
      optionValues: [],
      optionValueLinks: [],
    })
  }

  const activeVariants = await db
    .select()
    .from(productVariants)
    .where(
      and(inArray(productVariants.productId, productIds), eq(productVariants.status, 'active')),
    )
  const variantIds = activeVariants.map((variant) => variant.id)

  const variantProductIds = new Map<string, string>()
  for (const variant of activeVariants) {
    result.get(variant.productId)?.variants.push(variant)
    variantProductIds.set(variant.id, variant.productId)
  }

  if (variantIds.length > 0) {
    const balanceRows = await db
      .select()
      .from(inventoryBalances)
      .where(inArray(inventoryBalances.variantId, variantIds))
    for (const balance of balanceRows) {
      const productId = variantProductIds.get(balance.variantId)
      const join = productId !== undefined ? result.get(productId) : undefined
      if (join) join.balances.set(balance.variantId, balance.quantityOnHand)
    }

    const linkRows = await db
      .select()
      .from(productVariantOptions)
      .where(inArray(productVariantOptions.variantId, variantIds))
    for (const link of linkRows) {
      const productId = variantProductIds.get(link.variantId)
      const join = productId !== undefined ? result.get(productId) : undefined
      if (join) join.optionValueLinks.push(link)
    }
  }

  const mediaRows = await db
    .select()
    .from(productMedia)
    .where(inArray(productMedia.productId, productIds))
  for (const media of mediaRows) {
    result.get(media.productId)?.media.push(media)
  }

  const optionRows = await db
    .select()
    .from(productOptions)
    .where(inArray(productOptions.productId, productIds))
  for (const option of optionRows) {
    result.get(option.productId)?.options.push(option)
  }

  const optionIds = optionRows.map((option) => option.id)
  if (optionIds.length > 0) {
    const valueRows = await db
      .select()
      .from(productOptionValues)
      .where(inArray(productOptionValues.optionId, optionIds))
    for (const value of valueRows) {
      const option = optionRows.find((item) => item.id === value.optionId)
      const join = option !== undefined ? result.get(option.productId) : undefined
      if (join) join.optionValues.push(value)
    }
  }

  return result
}

export async function getActiveCategoryBySlug(
  db: DbClient,
  slug: string,
): Promise<typeof categories.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.slug, slug), eq(categories.status, 'active')))
    .limit(1)
  return rows[0]
}

export async function getActiveCategoryById(
  db: DbClient,
  categoryId: string,
): Promise<typeof categories.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.status, 'active')))
    .limit(1)
  return rows[0]
}

/** Active variants by id — the only variants a guest may buy. */
export async function getActiveVariantsByIds(
  db: DbClient,
  variantIds: string[],
): Promise<(typeof productVariants.$inferSelect)[]> {
  if (variantIds.length === 0) return []
  return db
    .select()
    .from(productVariants)
    .where(and(eq(productVariants.status, 'active'), inArray(productVariants.id, variantIds)))
}

/** Active products by id — a buyable variant must belong to one of these. */
export async function getActiveProductsByIds(
  db: DbClient,
  productIds: string[],
): Promise<(typeof products.$inferSelect)[]> {
  if (productIds.length === 0) return []
  return db
    .select()
    .from(products)
    .where(and(eq(products.status, 'active'), inArray(products.id, productIds)))
}

/**
 * Categories/suppliers by id, ANY status (Gate C sale-time snapshot capture —
 * the current name is captured regardless of whether the row is active/
 * inactive at that instant; only a hard delete nulls the FK later).
 */
export async function getCategoriesByIds(
  db: DbClient,
  categoryIds: string[],
): Promise<(typeof categories.$inferSelect)[]> {
  if (categoryIds.length === 0) return []
  return db.select().from(categories).where(inArray(categories.id, categoryIds))
}

export async function getSuppliersByIds(
  db: DbClient,
  supplierIds: string[],
): Promise<(typeof suppliers.$inferSelect)[]> {
  if (supplierIds.length === 0) return []
  return db.select().from(suppliers).where(inArray(suppliers.id, supplierIds))
}

/** Balances keyed by variantId (only rows that exist). */
export async function getBalancesByVariantIds(
  db: DbClient,
  variantIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (variantIds.length === 0) return result
  const rows = await db
    .select()
    .from(inventoryBalances)
    .where(inArray(inventoryBalances.variantId, variantIds))
  for (const row of rows) result.set(row.variantId, row.quantityOnHand)
  return result
}

export async function listActiveCategories(
  db: DbClient,
): Promise<(typeof categories.$inferSelect)[]> {
  return db
    .select()
    .from(categories)
    .where(eq(categories.status, 'active'))
    .orderBy(categories.code)
}

/** Active delivery zone by id — the only zones a guest may select. */
export async function getActiveDeliveryZone(
  db: DbClient,
  zoneId: string,
): Promise<typeof deliveryZones.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(deliveryZones)
    .where(and(eq(deliveryZones.id, zoneId), eq(deliveryZones.isActive, true)))
    .limit(1)
  return rows[0]
}

export async function listActiveDeliveryZones(
  db: DbClient,
): Promise<(typeof deliveryZones.$inferSelect)[]> {
  return db
    .select()
    .from(deliveryZones)
    .where(eq(deliveryZones.isActive, true))
    .orderBy(deliveryZones.nameAr)
}
