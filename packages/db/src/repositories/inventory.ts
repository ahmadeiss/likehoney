/**
 * Inventory data access.
 *
 * The balance + ledger must always be written in ONE transaction: services
 * call `ensureBalance`, then `addStock`/`deductStock`, then `insertMovement`
 * using the SAME `DbClient` (a `db.transaction` callback) so a crash rolls the
 * balance and its movement back together (INVENTORY_RULES.md §1).
 *
 * `deductStock` performs the atomic, race-free deduction described in
 * INVENTORY_RULES.md §2, made reservation-aware for Gate B4:
 * `UPDATE ... SET quantity_on_hand = quantity_on_hand - $n WHERE variant_id = $v
 * AND quantity_on_hand - quantity_reserved >= $n` — its row count (1 vs 0) is
 * the oversell guard. Every current physical-consumption path (Store Sale, COD
 * checkout, DAMAGE, negative MANUAL_ADJUSTMENT, corrections) goes through it,
 * so a pending electronic hold is never sold from under.
 *
 * The multi-write reservation primitives (`reserveOrderStockTx`,
 * `releaseOrderReservationsTx`, `commitOrderReservationsTx`) each perform
 * several dependent writes across `stock_reservations` and `inventory_balances`
 * — a partial apply would corrupt the reserved/on-hand invariant. They are
 * therefore typed to accept ONLY a transaction executor (`DbTx`), never the
 * root `DbClient`, so a caller cannot run them outside a transaction. They do
 * NOT open their own transaction — Stage 4 composes them inside its larger
 * order → payment → reservation → inventory → event transaction. Writes go
 * `stock_reservations` before `inventory_balances`, `variant_id ASC`, holding
 * the global lock order `orders → payments → stock_reservations →
 * inventory_balances`.
 */
import { and, asc, count, desc, eq, gt, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm'

import type { DbClient, DbTx } from '../client'
import {
  categories,
  inventoryBalances,
  inventoryMovements,
  products,
  productVariants,
  stockReservations,
  suppliers,
} from '../schema'
import {
  ACTIVE_RESERVATION_STATES,
  insertHeldReservations,
  transitionActiveOrderReservations,
  type NewReservationLine,
  type StockReservationRow,
} from './stock-reservations'

export type InventoryBalanceRow = typeof inventoryBalances.$inferSelect
export type InventoryMovementRow = typeof inventoryMovements.$inferSelect

export type InventoryMovementTypeValue =
  | 'INITIAL_STOCK'
  | 'RESTOCK'
  | 'ONLINE_ORDER'
  | 'ORDER_CANCELLATION_RESTORE'
  | 'RETURN'
  | 'DAMAGE'
  | 'MANUAL_ADJUSTMENT'
  | 'STORE_SALE'

/** Create the variant balance row when missing (idempotent, 1:1 by unique). */
export async function ensureBalance(db: DbClient, variantId: string): Promise<void> {
  await db
    .insert(inventoryBalances)
    .values({ variantId, quantityOnHand: 0 })
    .onConflictDoNothing({ target: inventoryBalances.variantId })
}

export async function getBalance(
  db: DbClient,
  variantId: string,
): Promise<InventoryBalanceRow | undefined> {
  const rows = await db
    .select()
    .from(inventoryBalances)
    .where(eq(inventoryBalances.variantId, variantId))
    .limit(1)
  return rows[0]
}

/**
 * Row-lock a set of variant balances (`SELECT ... FOR UPDATE`), always in
 * ascending `variant_id` order — the repo-wide deterministic lock order that
 * prevents two multi-line transactions from deadlocking on each other. MUST
 * run inside the caller's transaction. Callers must `ensureBalance` first for
 * any variant that might not yet have a row (this only locks rows that exist).
 */
export async function getBalancesForUpdate(
  db: DbTx,
  variantIds: string[],
): Promise<Map<string, InventoryBalanceRow>> {
  if (variantIds.length === 0) return new Map()
  const sorted = [...new Set(variantIds)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const rows = await db
    .select()
    .from(inventoryBalances)
    .where(inArray(inventoryBalances.variantId, sorted))
    .orderBy(asc(inventoryBalances.variantId))
    .for('update')
  return new Map(rows.map((r) => [r.variantId, r]))
}

/** Atomic stock addition. Returns the new balance row. */
export async function addStock(
  db: DbClient,
  variantId: string,
  amount: number,
): Promise<InventoryBalanceRow | undefined> {
  const rows = await db
    .update(inventoryBalances)
    .set({
      quantityOnHand: sql`${inventoryBalances.quantityOnHand} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(eq(inventoryBalances.variantId, variantId))
    .returning()
  return rows[0]
}

/**
 * Atomic physical stock deduction guarded against overselling AND against
 * consuming units held for a pending electronic order. Returns the new balance
 * row, or `undefined` when `available_to_sell` (`quantity_on_hand -
 * quantity_reserved`) is below `amount` (no row matched — the caller must abort
 * the movement and roll back the transaction).
 *
 * This is the single reservation-aware decrement used by Store Sale, COD
 * checkout, DAMAGE, negative MANUAL_ADJUSTMENT and correction paths.
 */
export async function deductStock(
  db: DbClient,
  variantId: string,
  amount: number,
): Promise<InventoryBalanceRow | undefined> {
  const rows = await db
    .update(inventoryBalances)
    .set({
      quantityOnHand: sql`${inventoryBalances.quantityOnHand} - ${amount}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(inventoryBalances.variantId, variantId),
        sql`${inventoryBalances.quantityOnHand} - ${inventoryBalances.quantityReserved} >= ${amount}`,
      ),
    )
    .returning()
  return rows[0]
}

export interface NewMovement {
  variantId: string
  movementType: InventoryMovementTypeValue
  quantityChange: number
  quantityAfter?: number | null
  reason?: string | null
  orderId?: string | null
  storeSaleId?: string | null
  staffId?: string | null
}

export async function insertMovement(
  db: DbClient,
  values: NewMovement,
): Promise<InventoryMovementRow> {
  const rows = await db.insert(inventoryMovements).values(values).returning()
  return rows[0] as InventoryMovementRow
}

// ---------------------------------------------------------------------------
// Reservation-aware multi-write primitives (Gate B4) — TRANSACTION-ONLY
// ---------------------------------------------------------------------------
//
// INVARIANT: every function below takes `tx: DbTx` (a `db.transaction(...)`
// executor), NEVER the root `DbClient`. Each performs several dependent writes
// whose partial application would break `quantity_reserved <= quantity_on_hand`
// or leave orphan holds. They do not open a transaction of their own — Stage 4
// composes them inside one larger transaction. Writes: `stock_reservations`
// before `inventory_balances`, `variant_id ASC`. A `undefined` / `insufficient`
// / empty return is a guarded no-op the caller maps to a domain error and rolls
// the whole transaction back.

export interface ReserveOrderStockResult {
  reservations: StockReservationRow[]
  /** variantId → resulting balance after the hold was applied. */
  balances: Map<string, InventoryBalanceRow>
}

/**
 * Place an order-level hold: insert the `held` reservation rows, then bump
 * `quantity_reserved` for each line, guarded by `available_to_sell >= qty`.
 * Returns `{ insufficient, variantId }` for the first line that cannot be held —
 * the caller rolls the whole transaction back (no partial holds).
 *
 * MUST execute inside a caller-owned transaction (`tx: DbTx`).
 */
export async function reserveOrderStockTx(
  tx: DbTx,
  orderId: string,
  lines: readonly NewReservationLine[],
  reconcileAfter: Date,
): Promise<ReserveOrderStockResult | { insufficient: true; variantId: string }> {
  const ordered = [...lines].sort((a, b) =>
    a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
  )

  // stock_reservations first (its insert trigger locks the parent order and
  // validates order shape + line match).
  const reservations = await insertHeldReservations(tx, orderId, ordered, reconcileAfter)

  const balances = new Map<string, InventoryBalanceRow>()
  for (const line of ordered) {
    await ensureBalance(tx, line.variantId)
    const rows = await tx
      .update(inventoryBalances)
      .set({
        quantityReserved: sql`${inventoryBalances.quantityReserved} + ${line.quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryBalances.variantId, line.variantId),
          sql`${inventoryBalances.quantityOnHand} - ${inventoryBalances.quantityReserved} >= ${line.quantity}`,
        ),
      )
      .returning()
    if (rows[0] === undefined) return { insufficient: true, variantId: line.variantId }
    balances.set(line.variantId, rows[0])
  }

  return { reservations, balances }
}

/**
 * Release an order's active holds: terminal-transition the reservation rows to
 * `released`, then give the units back by lowering `quantity_reserved`. No
 * movement row — a released hold never was a physical change. Returns the rows
 * released (empty when nothing was active).
 *
 * MUST execute inside a caller-owned transaction (`tx: DbTx`).
 */
export async function releaseOrderReservationsTx(
  tx: DbTx,
  orderId: string,
  authoritativeTerminalAt: Date,
): Promise<StockReservationRow[]> {
  const released = await transitionActiveOrderReservations(
    tx,
    orderId,
    'released',
    authoritativeTerminalAt,
  )
  const ordered = [...released].sort((a, b) =>
    a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
  )
  for (const row of ordered) {
    await tx
      .update(inventoryBalances)
      .set({
        quantityReserved: sql`${inventoryBalances.quantityReserved} - ${row.quantity}`,
        updatedAt: new Date(),
      })
      .where(eq(inventoryBalances.variantId, row.variantId))
  }
  return released
}

export interface CommitOrderReservationsResult {
  reservations: StockReservationRow[]
  balances: Map<string, InventoryBalanceRow>
}

/**
 * Commit an order's active holds after its payment succeeded: terminal-
 * transition the reservation rows to `committed`, then convert each hold into a
 * real deduction — `quantity_on_hand -= qty` AND `quantity_reserved -= qty` in
 * one guarded UPDATE — and write the once-only `ONLINE_ORDER` movement.
 * Returns `undefined` when a balance row fails the guard (integrity fault:
 * caller rolls back).
 *
 * MUST execute inside a caller-owned transaction (`tx: DbTx`).
 */
export async function commitOrderReservationsTx(
  tx: DbTx,
  orderId: string,
  authoritativeTerminalAt: Date,
): Promise<CommitOrderReservationsResult | undefined> {
  const committed = await transitionActiveOrderReservations(
    tx,
    orderId,
    'committed',
    authoritativeTerminalAt,
  )
  const ordered = [...committed].sort((a, b) =>
    a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
  )

  const balances = new Map<string, InventoryBalanceRow>()
  for (const row of ordered) {
    const updated = await tx
      .update(inventoryBalances)
      .set({
        quantityOnHand: sql`${inventoryBalances.quantityOnHand} - ${row.quantity}`,
        quantityReserved: sql`${inventoryBalances.quantityReserved} - ${row.quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryBalances.variantId, row.variantId),
          sql`${inventoryBalances.quantityReserved} >= ${row.quantity}`,
          sql`${inventoryBalances.quantityOnHand} >= ${row.quantity}`,
        ),
      )
      .returning()
    if (updated[0] === undefined) return undefined
    balances.set(row.variantId, updated[0])

    await insertMovement(tx, {
      variantId: row.variantId,
      movementType: 'ONLINE_ORDER',
      quantityChange: -row.quantity,
      quantityAfter: updated[0].quantityOnHand,
      orderId,
      reason: 'electronic order capture',
    })
  }

  return { reservations: committed, balances }
}

/** Sum of active (`held` / `reconciling`) reserved units for a variant. */
export async function getReservedUnitsForVariant(db: DbClient, variantId: string): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`coalesce(sum(${stockReservations.quantity}), 0)::int` })
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.variantId, variantId),
        inArray(stockReservations.state, [...ACTIVE_RESERVATION_STATES]),
      ),
    )
  return rows[0]?.value ?? 0
}

export interface MovementListOptions {
  page: number
  pageSize: number
  variantId?: string
  movementType?: InventoryMovementTypeValue
}

export async function listMovements(
  db: DbClient,
  options: MovementListOptions,
): Promise<{ rows: InventoryMovementRow[]; total: number }> {
  const conditions: SQL[] = []
  if (options.variantId !== undefined) {
    conditions.push(eq(inventoryMovements.variantId, options.variantId))
  }
  if (options.movementType !== undefined) {
    conditions.push(eq(inventoryMovements.movementType, options.movementType))
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const totalRows = await db.select({ value: count() }).from(inventoryMovements).where(where)
  const total = totalRows[0]?.value ?? 0

  const rows = await db
    .select()
    .from(inventoryMovements)
    .where(where)
    // `id` tie-breaker: two movements can share a `createdAt` timestamp (same
    // millisecond), and `createdAt` alone is not a stable sort — without a
    // tie-breaker, adjacent pages could duplicate or drop a row when ties
    // land on the page boundary.
    .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
    .limit(options.pageSize)
    .offset((options.page - 1) * options.pageSize)

  return { rows, total }
}

/** Recent movements for the balance panel of a variant. */
export async function recentMovements(
  db: DbClient,
  variantId: string,
  limit: number,
): Promise<InventoryMovementRow[]> {
  return db
    .select()
    .from(inventoryMovements)
    .where(eq(inventoryMovements.variantId, variantId))
    .orderBy(desc(inventoryMovements.createdAt))
    .limit(limit)
}

// ---------------------------------------------------------------------------
// Admin stock summary (read-only aggregate)
// ---------------------------------------------------------------------------

export interface StockSummaryVariantRow {
  variantId: string
  sku: string
  variantStatus: 'draft' | 'active' | 'inactive'
  productId: string
  productNameAr: string
  productNameEn: string
  productStatus: 'draft' | 'active' | 'inactive' | 'archived'
  categoryId: string | null
  supplierId: string | null
  supplierNameAr: string | null
  supplierNameEn: string | null
  quantityOnHand: number
}

export interface StockSummaryResult {
  rows: StockSummaryVariantRow[]
  variantCounts: { total: number; active: number }
  productCounts: { total: number; active: number }
  categoryTotal: number
  supplierTotal: number
}

/**
 * Aggregate the real catalog + inventory state for the admin dashboard and
 * inventory health strip in a handful of indexed queries (no per-variant
 * N+1). Every variant (regardless of product/variant status) is listed with
 * its on-hand quantity so the service can classify stock levels. Read-only.
 */
export async function getStockSummary(db: DbClient): Promise<StockSummaryResult> {
  const variantRows = await db
    .select({
      variantId: productVariants.id,
      sku: productVariants.sku,
      variantStatus: productVariants.status,
      productId: products.id,
      productNameAr: products.nameAr,
      productNameEn: products.nameEn,
      productStatus: products.status,
      categoryId: products.categoryId,
      supplierId: products.supplierId,
      supplierNameAr: suppliers.nameAr,
      supplierNameEn: suppliers.nameEn,
      quantityOnHand: inventoryBalances.quantityOnHand,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .leftJoin(inventoryBalances, eq(inventoryBalances.variantId, productVariants.id))
    .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
    .orderBy(products.nameAr, productVariants.sku)

  const [categoryCount, supplierCount] = await Promise.all([
    db.select({ value: count() }).from(categories),
    db.select({ value: count() }).from(suppliers),
  ])

  const productStatuses = new Set(variantRows.map((row) => row.productStatus))
  const activeProductCount = [...productStatuses].filter((status) => status === 'active').length

  return {
    rows: variantRows.map((row) => ({
      variantId: row.variantId,
      sku: row.sku,
      variantStatus: row.variantStatus as StockSummaryVariantRow['variantStatus'],
      productId: row.productId,
      productNameAr: row.productNameAr,
      productNameEn: row.productNameEn,
      productStatus: row.productStatus as StockSummaryVariantRow['productStatus'],
      categoryId: row.categoryId,
      supplierId: row.supplierId,
      supplierNameAr: row.supplierNameAr,
      supplierNameEn: row.supplierNameEn,
      quantityOnHand: row.quantityOnHand ?? 0,
    })),
    variantCounts: {
      total: variantRows.length,
      active: variantRows.filter((row) => row.variantStatus === 'active').length,
    },
    productCounts: {
      total: productStatuses.size,
      active: activeProductCount,
    },
    categoryTotal: categoryCount[0]?.value ?? 0,
    supplierTotal: supplierCount[0]?.value ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Paginated Admin inventory register (Gate B4 Stage 5 — inventory UX pass)
// ---------------------------------------------------------------------------

/** Mirrors `LOW_STOCK_THRESHOLD` in `@likehoney/shared/contracts/inventory` — `db` has no
 *  dependency on `shared`, so the value is kept in sync by hand. Zero is always "out". */
const LOW_STOCK_THRESHOLD = 5

export interface InventoryBalanceListRow {
  variantId: string
  sku: string
  productId: string
  productNameAr: string
  productNameEn: string
  productStatus: 'draft' | 'active' | 'inactive' | 'archived'
  variantStatus: 'draft' | 'active' | 'inactive'
  quantityOnHand: number
  quantityReserved: number
}

export interface InventoryBalanceListOptions {
  page: number
  pageSize: number
  search?: string
  level?: 'available' | 'low' | 'out'
}

/**
 * Server-side filtered, searched and paginated variant-balance listing for the
 * Admin inventory register. One indexed join (no N+1 per-row product fetch),
 * a stable `product name → sku → variant id` order with an id tie-breaker, and
 * a matching-rows `total` for the page controls. The stock-level filter is
 * applied in SQL against `quantity_on_hand` using the exact same thresholds as
 * the shared `stockLevelFor` heuristic, so this list and the global
 * `stockHealth` counters from `getStockSummary` never disagree.
 */
export async function listInventoryBalances(
  db: DbClient,
  options: InventoryBalanceListOptions,
): Promise<{ rows: InventoryBalanceListRow[]; total: number }> {
  const conditions: (SQL | undefined)[] = []

  if (options.search !== undefined && options.search.length > 0) {
    const like = `%${options.search.toLowerCase()}%`
    conditions.push(
      or(
        ilike(productVariants.sku, like),
        ilike(products.nameEn, like),
        ilike(products.nameAr, like),
      ),
    )
  }

  const onHand = sql<number>`coalesce(${inventoryBalances.quantityOnHand}, 0)`
  if (options.level === 'out') {
    conditions.push(lte(onHand, 0))
  } else if (options.level === 'low') {
    conditions.push(and(gt(onHand, 0), lte(onHand, LOW_STOCK_THRESHOLD)))
  } else if (options.level === 'available') {
    conditions.push(gt(onHand, LOW_STOCK_THRESHOLD))
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const baseQuery = db
    .select({
      variantId: productVariants.id,
      sku: productVariants.sku,
      variantStatus: productVariants.status,
      productId: products.id,
      productNameAr: products.nameAr,
      productNameEn: products.nameEn,
      productStatus: products.status,
      quantityOnHand: inventoryBalances.quantityOnHand,
      quantityReserved: inventoryBalances.quantityReserved,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .leftJoin(inventoryBalances, eq(inventoryBalances.variantId, productVariants.id))

  const totalRows = await db
    .select({ value: count() })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .leftJoin(inventoryBalances, eq(inventoryBalances.variantId, productVariants.id))
    .where(where)
  const total = totalRows[0]?.value ?? 0

  const rows = await baseQuery
    .where(where)
    .orderBy(asc(products.nameAr), asc(productVariants.sku), asc(productVariants.id))
    .limit(options.pageSize)
    .offset((options.page - 1) * options.pageSize)

  return {
    rows: rows.map((row) => ({
      variantId: row.variantId,
      sku: row.sku,
      productId: row.productId,
      productNameAr: row.productNameAr,
      productNameEn: row.productNameEn,
      productStatus: row.productStatus as InventoryBalanceListRow['productStatus'],
      variantStatus: row.variantStatus as InventoryBalanceListRow['variantStatus'],
      quantityOnHand: row.quantityOnHand ?? 0,
      quantityReserved: row.quantityReserved ?? 0,
    })),
    total,
  }
}
