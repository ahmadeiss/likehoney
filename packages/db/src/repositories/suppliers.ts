/**
 * Supplier data access.
 */
import { and, asc, count, eq, ilike, or, type SQL } from 'drizzle-orm'

import type { DbClient } from '../client'
import { products, suppliers } from '../schema'
import type { EntityStatusValue } from './categories'

export type SupplierRow = typeof suppliers.$inferSelect
export type SupplierNew = typeof suppliers.$inferInsert

export interface SupplierListOptions {
  page: number
  pageSize: number
  status?: EntityStatusValue
  search?: string
}

export async function listSuppliers(
  db: DbClient,
  options: SupplierListOptions,
): Promise<{ rows: SupplierRow[]; total: number }> {
  const conditions: (SQL | undefined)[] = []

  if (options.status !== undefined) {
    conditions.push(eq(suppliers.status, options.status))
  }
  if (options.search !== undefined && options.search.length > 0) {
    const like = `%${options.search.toLowerCase()}%`
    conditions.push(or(ilike(suppliers.nameAr, like), ilike(suppliers.nameEn, like)))
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const totalRows = await db.select({ value: count() }).from(suppliers).where(where)
  const total = totalRows[0]?.value ?? 0

  const rows = await db
    .select()
    .from(suppliers)
    .where(where)
    .orderBy(asc(suppliers.nameAr))
    .limit(options.pageSize)
    .offset((options.page - 1) * options.pageSize)

  return { rows, total }
}

export async function getSupplier(db: DbClient, id: string): Promise<SupplierRow | undefined> {
  const rows = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1)
  return rows[0]
}

export async function createSupplier(db: DbClient, values: SupplierNew): Promise<SupplierRow> {
  const rows = await db.insert(suppliers).values(values).returning()
  return rows[0] as SupplierRow
}

export async function updateSupplier(
  db: DbClient,
  id: string,
  values: Partial<SupplierNew>,
): Promise<SupplierRow | undefined> {
  const rows = await db
    .update(suppliers)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(suppliers.id, id))
    .returning()
  return rows[0]
}

export async function removeSupplier(db: DbClient, id: string): Promise<SupplierRow | undefined> {
  const rows = await db.delete(suppliers).where(eq(suppliers.id, id)).returning()
  return rows[0]
}

export async function countProductsBySupplier(db: DbClient, supplierId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(products)
    .where(eq(products.supplierId, supplierId))
  return rows[0]?.value ?? 0
}
