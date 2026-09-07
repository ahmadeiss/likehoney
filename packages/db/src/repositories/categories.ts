/**
 * Category data access.
 */
import { and, asc, count, eq, ilike, or, type SQL } from 'drizzle-orm'

import type { DbClient } from '../client'
import { categories, products } from '../schema'

export type CategoryRow = typeof categories.$inferSelect
export type CategoryNew = typeof categories.$inferInsert

export type EntityStatusValue = 'active' | 'inactive'

export interface CategoryListOptions {
  page: number
  pageSize: number
  status?: EntityStatusValue
  search?: string
}

export async function listCategories(
  db: DbClient,
  options: CategoryListOptions,
): Promise<{ rows: CategoryRow[]; total: number }> {
  const conditions: (SQL | undefined)[] = []

  if (options.status !== undefined) {
    conditions.push(eq(categories.status, options.status))
  }
  if (options.search !== undefined && options.search.length > 0) {
    const like = `%${options.search.toLowerCase()}%`
    conditions.push(or(ilike(categories.nameEn, like), ilike(categories.nameAr, like)))
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const totalRows = await db.select({ value: count() }).from(categories).where(where)
  const total = totalRows[0]?.value ?? 0

  const rows = await db
    .select()
    .from(categories)
    .where(where)
    .orderBy(asc(categories.nameAr))
    .limit(options.pageSize)
    .offset((options.page - 1) * options.pageSize)

  return { rows, total }
}

export async function getCategory(db: DbClient, id: string): Promise<CategoryRow | undefined> {
  const rows = await db.select().from(categories).where(eq(categories.id, id)).limit(1)
  return rows[0]
}

export async function getCategoryByCode(
  db: DbClient,
  code: string,
): Promise<CategoryRow | undefined> {
  const rows = await db.select().from(categories).where(eq(categories.code, code)).limit(1)
  return rows[0]
}

export async function getCategoryBySlug(
  db: DbClient,
  slug: string,
): Promise<CategoryRow | undefined> {
  const rows = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1)
  return rows[0]
}

export async function createCategory(db: DbClient, values: CategoryNew): Promise<CategoryRow> {
  const rows = await db.insert(categories).values(values).returning()
  return rows[0] as CategoryRow
}

export async function updateCategory(
  db: DbClient,
  id: string,
  values: Partial<CategoryNew>,
): Promise<CategoryRow | undefined> {
  const rows = await db
    .update(categories)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(categories.id, id))
    .returning()
  return rows[0]
}

export async function removeCategory(db: DbClient, id: string): Promise<CategoryRow | undefined> {
  const rows = await db.delete(categories).where(eq(categories.id, id)).returning()
  return rows[0]
}

export async function countProductsInCategory(db: DbClient, categoryId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(products)
    .where(eq(products.categoryId, categoryId))
  return rows[0]?.value ?? 0
}
