/**
 * In-store sale data access.
 *
 * Store-sale creation is a service-transaction operation, identical in shape to
 * online orders: the caller inserts the sale header + item snapshots inside ONE
 * `db.transaction`, against the same `DbClient` that performs the atomic stock
 * deductions and writes the `STORE_SALE` movements. The human sale `number`
 * (`LH-POS-000001`) is a stored generated column — never populated here.
 *
 * `searchStoreSaleProducts` is the register lookup: it matches an Arabic /
 * English product name OR a variant SKU and returns everything the till needs
 * to complete a sale without a second round-trip (variants, live balances,
 * option pickers, primary image key).
 */
import { and, asc, count, desc, eq, ilike, inArray, or, sum } from 'drizzle-orm'

import type { DbClient } from '../client'
import {
  inventoryBalances,
  productMedia,
  productOptionValues,
  productOptions,
  productVariantOptions,
  productVariants,
  products,
  staffUsers,
  storeSaleItems,
  storeSales,
} from '../schema'
import { getBalancesByVariantIds } from './catalog'

/**
 * Reservation-aware sellable ceiling per variant — Gate B4 Stage 5 (§30/§43).
 * `quantityOnHand` alone would let the register imply stock is sellable when
 * it is actually held for a pending electronic order; `deductStock` already
 * guards the real sale transactionally on this same `on_hand - reserved`
 * ceiling (see `deductStock`) — this is only the matching READ so the
 * register never displays a number it cannot honor. Never negative.
 */
async function getAvailableToSellByVariantIds(
  db: DbClient,
  variantIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (variantIds.length === 0) return result
  const rows = await db
    .select({
      variantId: inventoryBalances.variantId,
      quantityOnHand: inventoryBalances.quantityOnHand,
      quantityReserved: inventoryBalances.quantityReserved,
    })
    .from(inventoryBalances)
    .where(inArray(inventoryBalances.variantId, variantIds))
  for (const row of rows) {
    result.set(row.variantId, Math.max(0, row.quantityOnHand - row.quantityReserved))
  }
  return result
}

export type StoreSaleRow = typeof storeSales.$inferSelect
export type StoreSaleNew = typeof storeSales.$inferInsert
export type StoreSaleItemRow = typeof storeSaleItems.$inferSelect

// ---------------------------------------------------------------------------
// Register product search
// ---------------------------------------------------------------------------

export interface StoreSaleProductHitRaw {
  productId: string
  nameAr: string
  nameEn: string
  primaryImageKey: string | null
  fromPriceMinor: number
  totalOnHand: number
  /** Sum of `availableToSell` across variants — the truthful pre-selection
   *  sellable count (§30/§43). */
  totalAvailableToSell: number
  hasOptions: boolean
  options: {
    id: string
    nameAr: string
    nameEn: string
    values: { id: string; valueAr: string; valueEn: string }[]
  }[]
  variants: {
    variantId: string
    sku: string
    optionLabelAr: string | null
    optionLabelEn: string | null
    optionValueIds: string[]
    priceMinor: number
    quantityOnHand: number
    /** Physical on-hand minus any quantity held for electronic orders — the
     *  true register sellable ceiling (§30/§43). */
    availableToSell: number
    status: 'draft' | 'active' | 'inactive'
  }[]
}

export async function searchStoreSaleProducts(
  db: DbClient,
  term: string,
  limit: number,
): Promise<StoreSaleProductHitRaw[]> {
  const like = `%${term.toLowerCase()}%`

  // Candidate active products whose name matches, or which own an active
  // variant whose SKU matches. One indexed query, distinct product ids.
  const candidates = await db
    .selectDistinct({ id: products.id, sequence: products.sequence })
    .from(products)
    .leftJoin(
      productVariants,
      and(eq(productVariants.productId, products.id), eq(productVariants.status, 'active')),
    )
    .where(
      and(
        eq(products.status, 'active'),
        or(
          ilike(products.nameEn, like),
          ilike(products.nameAr, like),
          ilike(productVariants.sku, like),
        ),
      ),
    )
    .orderBy(asc(products.sequence))
    .limit(limit)

  const productIds = candidates.map((row) => row.id)
  if (productIds.length === 0) return []

  const [productRows, variantRows, optionRows] = await Promise.all([
    db.select().from(products).where(inArray(products.id, productIds)),
    db
      .select()
      .from(productVariants)
      .where(
        and(inArray(productVariants.productId, productIds), eq(productVariants.status, 'active')),
      ),
    db.select().from(productOptions).where(inArray(productOptions.productId, productIds)),
  ])

  const variantIds = variantRows.map((v) => v.id)
  const optionIds = optionRows.map((o) => o.id)

  const [balances, availableToSell, linkRows, valueRows, mediaRows] = await Promise.all([
    getBalancesByVariantIds(db, variantIds),
    getAvailableToSellByVariantIds(db, variantIds),
    variantIds.length > 0
      ? db
          .select()
          .from(productVariantOptions)
          .where(inArray(productVariantOptions.variantId, variantIds))
      : Promise.resolve([] as (typeof productVariantOptions.$inferSelect)[]),
    optionIds.length > 0
      ? db
          .select()
          .from(productOptionValues)
          .where(inArray(productOptionValues.optionId, optionIds))
      : Promise.resolve([] as (typeof productOptionValues.$inferSelect)[]),
    db
      .select()
      .from(productMedia)
      .where(and(inArray(productMedia.productId, productIds), eq(productMedia.mediaType, 'image')))
      .orderBy(
        asc(productMedia.productId),
        desc(productMedia.isPrimary),
        asc(productMedia.sortOrder),
        asc(productMedia.createdAt),
      ),
  ])

  const linksByVariant = new Map<string, string[]>()
  for (const link of linkRows) {
    const list = linksByVariant.get(link.variantId) ?? []
    list.push(link.optionValueId)
    linksByVariant.set(link.variantId, list)
  }

  const valuesByOption = new Map<string, typeof valueRows>()
  for (const value of valueRows) {
    const list = valuesByOption.get(value.optionId) ?? []
    list.push(value)
    valuesByOption.set(value.optionId, list)
  }

  // Rows arrive ordered primary-first per product; keep the first seen.
  const imageByProduct = new Map<string, string>()
  for (const row of mediaRows) {
    if (!imageByProduct.has(row.productId)) imageByProduct.set(row.productId, row.objectKey)
  }

  const productById = new Map(productRows.map((p) => [p.id, p]))

  const hits: StoreSaleProductHitRaw[] = []
  for (const id of productIds) {
    const product = productById.get(id)
    if (product === undefined) continue

    const variants = variantRows
      .filter((v) => v.productId === id)
      .map((v) => ({
        variantId: v.id,
        sku: v.sku,
        optionLabelAr: v.optionLabelAr,
        optionLabelEn: v.optionLabelEn,
        optionValueIds: linksByVariant.get(v.id) ?? [],
        priceMinor: v.priceMinor,
        quantityOnHand: balances.get(v.id) ?? 0,
        availableToSell: availableToSell.get(v.id) ?? 0,
        status: v.status as 'draft' | 'active' | 'inactive',
      }))

    if (variants.length === 0) continue

    const options = optionRows
      .filter((o) => o.productId === id)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((o) => ({
        id: o.id,
        nameAr: o.nameAr,
        nameEn: o.nameEn,
        values: (valuesByOption.get(o.id) ?? [])
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((value) => ({ id: value.id, valueAr: value.valueAr, valueEn: value.valueEn })),
      }))

    hits.push({
      productId: product.id,
      nameAr: product.nameAr,
      nameEn: product.nameEn,
      primaryImageKey: imageByProduct.get(product.id) ?? null,
      fromPriceMinor: Math.min(...variants.map((v) => v.priceMinor)),
      totalOnHand: variants.reduce((n, v) => n + v.quantityOnHand, 0),
      totalAvailableToSell: variants.reduce((n, v) => n + v.availableToSell, 0),
      hasOptions: options.length > 0,
      options,
      variants,
    })
  }

  return hits
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface NewStoreSaleItemSnapshot {
  productId: string
  variantId: string
  skuSnapshot: string
  productNameEnSnapshot: string
  productNameArSnapshot: string
  variantLabelArSnapshot: string | null
  variantLabelEnSnapshot: string | null
  unitPriceMinor: number
  quantity: number
  /** Gate C sale-time snapshot fields — see `store_sale_items` schema doc. */
  unitCostSnapshot?: number | null
  supplierIdSnapshot?: string | null
  supplierNameEnSnapshot?: string | null
  supplierNameArSnapshot?: string | null
  categoryIdSnapshot?: string | null
  categoryNameEnSnapshot?: string | null
  categoryNameArSnapshot?: string | null
}

export async function insertStoreSale(db: DbClient, values: StoreSaleNew): Promise<StoreSaleRow> {
  const rows = await db.insert(storeSales).values(values).returning()
  return rows[0] as StoreSaleRow
}

export async function insertStoreSaleItems(
  db: DbClient,
  storeSaleId: string,
  items: NewStoreSaleItemSnapshot[],
): Promise<StoreSaleItemRow[]> {
  if (items.length === 0) return []
  return db
    .insert(storeSaleItems)
    .values(items.map((item) => ({ ...item, storeSaleId })))
    .returning()
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface StoreSaleListOptions {
  page: number
  pageSize: number
  search?: string
}

export interface StoreSaleListRow {
  id: string
  number: string
  createdAt: Date
  staffId: string
  staffNameAr: string
  staffNameEn: string | null
  itemCount: number
  totalUnits: number
  subtotalMinor: number
  totalMinor: number
  currency: string
  note: string | null
  customerId: string | null
  customerPhoneNormalized: string | null
}

export async function listStoreSales(
  db: DbClient,
  options: StoreSaleListOptions,
): Promise<{ rows: StoreSaleListRow[]; total: number }> {
  const where =
    options.search !== undefined && options.search.length > 0
      ? (() => {
          const like = `%${options.search.toLowerCase()}%`
          return or(
            ilike(storeSales.number, like),
            ilike(storeSales.customerPhoneNormalized, like),
            ilike(staffUsers.nameAr, like),
            ilike(staffUsers.nameEn, like),
          )
        })()
      : undefined

  const totalRows = await db
    .select({ value: count() })
    .from(storeSales)
    .innerJoin(staffUsers, eq(staffUsers.id, storeSales.staffId))
    .where(where)
  const total = totalRows[0]?.value ?? 0

  const headers = await db
    .select({
      id: storeSales.id,
      number: storeSales.number,
      createdAt: storeSales.createdAt,
      staffId: storeSales.staffId,
      staffNameAr: staffUsers.nameAr,
      staffNameEn: staffUsers.nameEn,
      subtotalMinor: storeSales.subtotalMinor,
      totalMinor: storeSales.totalMinor,
      currency: storeSales.currency,
      note: storeSales.note,
      customerId: storeSales.customerId,
      customerPhoneNormalized: storeSales.customerPhoneNormalized,
    })
    .from(storeSales)
    .innerJoin(staffUsers, eq(staffUsers.id, storeSales.staffId))
    .where(where)
    .orderBy(desc(storeSales.createdAt))
    .limit(options.pageSize)
    .offset((options.page - 1) * options.pageSize)

  const ids = headers.map((h) => h.id)
  const agg =
    ids.length > 0
      ? await db
          .select({
            storeSaleId: storeSaleItems.storeSaleId,
            lines: count(),
            units: sum(storeSaleItems.quantity),
          })
          .from(storeSaleItems)
          .where(inArray(storeSaleItems.storeSaleId, ids))
          .groupBy(storeSaleItems.storeSaleId)
      : []
  const aggById = new Map(agg.map((a) => [a.storeSaleId, a]))

  return {
    rows: headers.map((h) => ({
      ...h,
      itemCount: Number(aggById.get(h.id)?.lines ?? 0),
      totalUnits: Number(aggById.get(h.id)?.units ?? 0),
    })),
    total,
  }
}

export async function getStoreSaleWithItems(
  db: DbClient,
  id: string,
): Promise<{ header: StoreSaleListRow; items: StoreSaleItemRow[] } | undefined> {
  const headerRows = await db
    .select({
      id: storeSales.id,
      number: storeSales.number,
      createdAt: storeSales.createdAt,
      staffId: storeSales.staffId,
      staffNameAr: staffUsers.nameAr,
      staffNameEn: staffUsers.nameEn,
      subtotalMinor: storeSales.subtotalMinor,
      totalMinor: storeSales.totalMinor,
      currency: storeSales.currency,
      note: storeSales.note,
      customerId: storeSales.customerId,
      customerPhoneNormalized: storeSales.customerPhoneNormalized,
    })
    .from(storeSales)
    .innerJoin(staffUsers, eq(staffUsers.id, storeSales.staffId))
    .where(eq(storeSales.id, id))
    .limit(1)

  const header = headerRows[0]
  if (header === undefined) return undefined

  const items = await db
    .select()
    .from(storeSaleItems)
    .where(eq(storeSaleItems.storeSaleId, id))
    .orderBy(asc(storeSaleItems.createdAt))

  return {
    header: {
      ...header,
      itemCount: items.length,
      totalUnits: items.reduce((n, i) => n + i.quantity, 0),
    },
    items,
  }
}
