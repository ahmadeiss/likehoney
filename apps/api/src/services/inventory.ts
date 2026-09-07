/**
 * Inventory service. Every balance mutation runs in ONE PostgreSQL
 * transaction that writes the balance and its ledger movement together
 * (INVENTORY_RULES.md §§1–2):
 *
 *   ensureBalance → addStock/deductStock (atomic, guarded) → insertMovement
 *
 * `deductStock` returns no row when stock is below the requested amount — the
 * service treats that as an oversell attempt, aborts the whole transaction
 * and answers 409 `insufficient_stock`. No read-then-write anywhere.
 */
import {
  InsufficientStockError,
  NotFoundError,
  deriveProductReadiness,
  productStockLevelFor,
  stockLevelFor,
  type InventoryAttentionItem,
  type InventoryBalanceListItem,
  type InventoryBalanceListQuery,
  type InventoryMovementCreateInput,
  type InventoryMovementListQuery,
  type InventorySummaryDoc,
  type ProductReadiness,
  type StockLevel,
  type SupplierShortageDoc,
} from '@likehoney/shared'
import {
  addStock,
  deductStock,
  ensureBalance,
  getBalance,
  getStockSummary,
  getVariant,
  insertMovement,
  listInventoryBalances,
  listMovements,
  recentMovements,
  type DbClient,
} from '@likehoney/db'

export async function recordManualMovementService(
  db: DbClient,
  input: InventoryMovementCreateInput,
  actorStaffId: string | null,
) {
  const variant = await getVariant(db, input.variantId)
  if (variant === undefined) throw new NotFoundError('variant not found')

  const balance = await db.transaction(async (tx) => {
    await ensureBalance(tx, variant.id)

    const isAddition = input.quantityChange > 0
    const updated = isAddition
      ? await addStock(tx, variant.id, input.quantityChange)
      : await deductStock(tx, variant.id, -input.quantityChange)

    if (updated === undefined) {
      throw new InsufficientStockError({
        variantId: variant.id,
        requestedChange: input.quantityChange,
      })
    }

    await insertMovement(tx, {
      variantId: variant.id,
      movementType: input.movementType,
      quantityChange: input.quantityChange,
      quantityAfter: updated.quantityOnHand,
      reason: input.reason ?? null,
      staffId: actorStaffId,
    })

    return updated
  })

  return {
    variantId: variant.id,
    quantityOnHand: balance.quantityOnHand,
  }
}

export async function getVariantInventoryService(db: DbClient, variantId: string) {
  const variant = await getVariant(db, variantId)
  if (variant === undefined) throw new NotFoundError('variant not found')

  const balance = await getBalance(db, variantId)
  const rows = await recentMovements(db, variantId, 20)
  return {
    variantId: variant.id,
    sku: variant.sku,
    productId: variant.productId,
    quantityOnHand: balance?.quantityOnHand ?? 0,
    /** Held for pending electronic orders — a commercial hold, never a
     *  physical deduction (Gate B4 Stage 5 §28/§32). */
    quantityReserved: balance?.quantityReserved ?? 0,
    recentMovements: rows,
  }
}

export async function listMovementsService(db: DbClient, query: InventoryMovementListQuery) {
  const { rows, total } = await listMovements(db, query)
  return { data: rows, meta: { page: query.page, pageSize: query.pageSize, total } }
}

/**
 * Paginated, searched, stock-level-filtered Admin inventory register
 * (Gate B4 Stage 5 inventory UX pass). One indexed join, no per-row N+1 —
 * see `listInventoryBalances`. The `level` filter and returned per-row
 * `level` both use the exact same `stockLevelFor` threshold as the global
 * `stockHealth` counters from `getStockSummaryService`, so the two never
 * disagree.
 */
export async function listInventoryBalancesService(
  db: DbClient,
  query: InventoryBalanceListQuery,
): Promise<{
  data: InventoryBalanceListItem[]
  meta: { page: number; pageSize: number; total: number }
}> {
  const { rows, total } = await listInventoryBalances(db, {
    page: query.page,
    pageSize: query.pageSize,
    search: query.search,
    level: query.level,
  })

  return {
    data: rows.map((row) => ({
      variantId: row.variantId,
      sku: row.sku,
      productId: row.productId,
      productNameAr: row.productNameAr,
      productNameEn: row.productNameEn,
      productStatus: row.productStatus,
      variantStatus: row.variantStatus,
      quantityOnHand: row.quantityOnHand,
      quantityReserved: row.quantityReserved,
      level: stockLevelFor(row.quantityOnHand),
    })),
    meta: { page: query.page, pageSize: query.pageSize, total },
  }
}

/**
 * Read-only stock/dashboard summary derived from the real catalog + inventory
 * state. Classifies every variant with `stockLevelFor` (shared low-stock
 * heuristic) and assembles the counts the dashboard "needs attention" module
 * and inventory health strip surface. It never mutates any balance.
 */
export async function getStockSummaryService(
  db: DbClient,
  attentionLimit = 12,
): Promise<InventorySummaryDoc> {
  const summary = await getStockSummary(db)

  const attention: InventoryAttentionItem[] = []
  const stockHealth = { available: 0, low: 0, out: 0 }
  let totalUnits = 0

  const suppliersById = new Map<
    string,
    { nameAr: string; nameEn: string | null; products: Set<string>; low: number; out: number }
  >()

  // Per-product variant roll-up for the derived selling-readiness state.
  const variantsByProduct = new Map<
    string,
    { productStatus: string; variants: { status: string; quantityOnHand: number }[] }
  >()

  for (const row of summary.rows) {
    const level = stockLevelFor(row.quantityOnHand)
    stockHealth[level] += 1
    totalUnits += row.quantityOnHand

    let bucket = variantsByProduct.get(row.productId)
    if (bucket === undefined) {
      bucket = { productStatus: row.productStatus, variants: [] }
      variantsByProduct.set(row.productId, bucket)
    }
    bucket.variants.push({ status: row.variantStatus, quantityOnHand: row.quantityOnHand })

    if (row.supplierId !== null && row.supplierNameAr !== null) {
      let entry = suppliersById.get(row.supplierId)
      if (entry === undefined) {
        entry = {
          nameAr: row.supplierNameAr,
          nameEn: row.supplierNameEn,
          products: new Set(),
          low: 0,
          out: 0,
        }
        suppliersById.set(row.supplierId, entry)
      }
      entry.products.add(row.productId)
      if (level === 'low') entry.low += 1
      if (level === 'out') entry.out += 1
    }

    if (level !== 'available') {
      attention.push({
        productId: row.productId,
        productNameAr: row.productNameAr,
        productNameEn: row.productNameEn,
        categoryId: row.categoryId,
        supplierId: row.supplierId,
        supplierNameAr: row.supplierNameAr,
        supplierNameEn: row.supplierNameEn,
        variantId: row.variantId,
        sku: row.sku,
        variantStatus: row.variantStatus,
        productStatus: row.productStatus,
        quantityOnHand: row.quantityOnHand,
        level: level as Exclude<StockLevel, 'available'>,
      })
    }
  }

  const levelRank: Record<StockLevel, number> = { out: 0, low: 1, available: 2 }
  attention.sort(
    (a, b) =>
      levelRank[a.level] - levelRank[b.level] ||
      a.quantityOnHand - b.quantityOnHand ||
      a.sku.localeCompare(b.sku),
  )

  const supplierShortages: SupplierShortageDoc[] = [...suppliersById.entries()]
    .map(([supplierId, entry]) => ({
      supplierId,
      supplierNameAr: entry.nameAr,
      supplierNameEn: entry.nameEn,
      productCount: entry.products.size,
      lowVariants: entry.low,
      outVariants: entry.out,
    }))
    .filter((entry) => entry.lowVariants > 0 || entry.outVariants > 0)
    .sort((a, b) => b.outVariants + b.lowVariants - (a.outVariants + a.lowVariants))

  const readiness: Record<string, ProductReadiness> = {}
  const productStock: Record<string, StockLevel> = {}
  for (const [productId, bucket] of variantsByProduct) {
    readiness[productId] = deriveProductReadiness(bucket.productStatus, bucket.variants)
    // Physical truth: sum every balance the product owns, no lifecycle filter.
    productStock[productId] = productStockLevelFor(bucket.variants.map((v) => v.quantityOnHand))
  }

  return {
    products: {
      total: summary.productCounts.total,
      active: summary.productCounts.active,
    },
    variants: {
      total: summary.variantCounts.total,
      active: summary.variantCounts.active,
    },
    stock: { totalUnits },
    stockHealth,
    attention: attention.slice(0, attentionLimit),
    suppliers: { total: summary.supplierTotal },
    categories: { total: summary.categoryTotal },
    supplierShortages: supplierShortages.slice(0, attentionLimit),
    readiness,
    productStock,
  }
}
