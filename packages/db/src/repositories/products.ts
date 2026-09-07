/**
 * Product data access.
 */
import { and, count, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm'

import type { DbClient } from '../client'
import { categories, productVariants, products } from '../schema'

export type ProductRow = typeof products.$inferSelect
export type ProductNew = typeof products.$inferInsert

export type ProductStatusValue = 'draft' | 'active' | 'inactive' | 'archived'

export interface ProductListOptions {
  page: number
  pageSize: number
  status?: ProductStatusValue
  categoryId?: string
  supplierId?: string
  search?: string
}

export async function listProducts(
  db: DbClient,
  options: ProductListOptions,
): Promise<{ rows: ProductRow[]; total: number }> {
  const conditions: (SQL | undefined)[] = []

  if (options.status !== undefined) {
    conditions.push(eq(products.status, options.status))
  }
  if (options.categoryId !== undefined) {
    conditions.push(eq(products.categoryId, options.categoryId))
  }
  if (options.supplierId !== undefined) {
    conditions.push(eq(products.supplierId, options.supplierId))
  }
  if (options.search !== undefined && options.search.length > 0) {
    const like = `%${options.search.toLowerCase()}%`
    conditions.push(or(ilike(products.nameEn, like), ilike(products.nameAr, like)))
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const totalRows = await db.select({ value: count() }).from(products).where(where)
  const total = totalRows[0]?.value ?? 0

  const rows = await db
    .select()
    .from(products)
    .where(where)
    .orderBy(desc(products.createdAt))
    .limit(options.pageSize)
    .offset((options.page - 1) * options.pageSize)

  return { rows, total }
}

export async function getProduct(db: DbClient, id: string): Promise<ProductRow | undefined> {
  const rows = await db.select().from(products).where(eq(products.id, id)).limit(1)
  return rows[0]
}

export async function createProduct(db: DbClient, values: ProductNew): Promise<ProductRow> {
  const rows = await db.insert(products).values(values).returning()
  return rows[0] as ProductRow
}

export async function updateProduct(
  db: DbClient,
  id: string,
  values: Partial<ProductNew>,
): Promise<ProductRow | undefined> {
  const rows = await db
    .update(products)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning()
  return rows[0]
}

export async function countVariants(db: DbClient, productId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
  return rows[0]?.value ?? 0
}

export async function getCategoryCode(
  db: DbClient,
  categoryId: string,
): Promise<string | undefined> {
  const rows = await db
    .select({ code: categories.code })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1)
  return rows[0]?.code
}

export async function getProductSequence(
  db: DbClient,
  productId: string,
): Promise<number | undefined> {
  const rows = await db
    .select({ sequence: products.sequence })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1)
  return rows[0]?.sequence
}

export async function listProductIdsByCategories(
  db: DbClient,
  categoryIds: string[],
): Promise<string[]> {
  if (categoryIds.length === 0) return []
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(inArray(products.categoryId, categoryIds))
  return rows.map((row) => row.id)
}

export async function hasAnyVariant(db: DbClient, productId: string): Promise<boolean> {
  const rows = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .limit(1)
  return rows.length > 0
}
