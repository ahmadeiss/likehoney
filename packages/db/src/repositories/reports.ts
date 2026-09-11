/**
 * Owner Reports & Insights — server-side aggregation (Gate C).
 *
 * Every figure is computed in SQL against a resolved `[fromUtc, toUtc)`
 * instant range — the caller derives that from a store-local `Asia/Hebron`
 * calendar period. NOTHING here fetches rows for the app to sum in memory.
 *
 * "Completed sales" (§Gate C): online orders with `status = 'completed'`,
 * bucketed by `completed_at` (the real completion instant, not creation);
 * every store sale (the register has no partial/pending state). Cancelled,
 * pending and failed are never counted. The operational pipeline
 * (processing/delivering) is a SEPARATE query — current state, not windowed.
 *
 * Cost: `unit_cost_snapshot` is used ONLY where present. A NULL snapshot is
 * NEVER read as 0 — the covered-vs-total line counts flow up so the report
 * can state coverage. Supplier/category attribution uses the SALE-TIME
 * snapshot columns, so a later catalog reassignment never moves history.
 */
import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm'

import type { DbClient } from '../client'
import {
  categories,
  customers,
  deliveryZones,
  inventoryBalances,
  orderItems,
  orders,
  productVariants,
  products,
  storeSaleItems,
  storeSales,
  suppliers,
} from '../schema'

const TZ = 'Asia/Hebron'

// ---------------------------------------------------------------------------
// Completed-sales totals (overview + sales headline)
// ---------------------------------------------------------------------------

export interface CompletedTotalsRow {
  merchandiseRevenueMinor: number
  onlineMerchandiseMinor: number
  storeMerchandiseMinor: number
  deliveryFeesMinor: number
  completedOrders: number
  completedStoreSales: number
  unitsSold: number
  /** COGS of ONLY the lines that carried a captured `unit_cost_snapshot`. */
  cogsMinor: number
  /** Line revenue of ONLY the cost-covered lines (denominator-free margin). */
  coveredRevenueMinor: number
  /** Line revenue of ALL completed lines — the eligible-merchandise base for
   *  the revenue-weighted coverage ratio. */
  lineRevenueTotalMinor: number
  costLinesTotal: number
  costLinesCovered: number
}

export async function getCompletedTotals(
  db: DbClient,
  fromUtc: Date,
  toUtc: Date,
): Promise<CompletedTotalsRow> {
  const [orderAgg] = await db
    .select({
      merch: sql<string>`coalesce(sum(${orders.subtotalMinor}), 0)`,
      delivery: sql<string>`coalesce(sum(${orders.deliveryFeeMinor}), 0)`,
      n: sql<string>`count(*)`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.status, 'completed'),
        isNotNull(orders.completedAt),
        gte(orders.completedAt, fromUtc),
        lt(orders.completedAt, toUtc),
      ),
    )

  const [saleAgg] = await db
    .select({
      merch: sql<string>`coalesce(sum(${storeSales.totalMinor}), 0)`,
      n: sql<string>`count(*)`,
    })
    .from(storeSales)
    .where(and(gte(storeSales.createdAt, fromUtc), lt(storeSales.createdAt, toUtc)))

  const [orderCost] = await db
    .select({
      cogs: sql<string>`coalesce(sum(case when ${orderItems.unitCostSnapshot} is not null then ${orderItems.unitCostSnapshot} * ${orderItems.quantity} else 0 end), 0)`,
      coveredRevenue: sql<string>`coalesce(sum(case when ${orderItems.unitCostSnapshot} is not null then ${orderItems.lineTotalMinor} else 0 end), 0)`,
      lineRevenue: sql<string>`coalesce(sum(${orderItems.lineTotalMinor}), 0)`,
      units: sql<string>`coalesce(sum(${orderItems.quantity}), 0)`,
      total: sql<string>`count(*)`,
      covered: sql<string>`count(*) filter (where ${orderItems.unitCostSnapshot} is not null)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orders.status, 'completed'),
        isNotNull(orders.completedAt),
        gte(orders.completedAt, fromUtc),
        lt(orders.completedAt, toUtc),
      ),
    )

  const [saleCost] = await db
    .select({
      cogs: sql<string>`coalesce(sum(case when ${storeSaleItems.unitCostSnapshot} is not null then ${storeSaleItems.unitCostSnapshot} * ${storeSaleItems.quantity} else 0 end), 0)`,
      coveredRevenue: sql<string>`coalesce(sum(case when ${storeSaleItems.unitCostSnapshot} is not null then ${storeSaleItems.unitPriceMinor} * ${storeSaleItems.quantity} else 0 end), 0)`,
      lineRevenue: sql<string>`coalesce(sum(${storeSaleItems.unitPriceMinor} * ${storeSaleItems.quantity}), 0)`,
      units: sql<string>`coalesce(sum(${storeSaleItems.quantity}), 0)`,
      total: sql<string>`count(*)`,
      covered: sql<string>`count(*) filter (where ${storeSaleItems.unitCostSnapshot} is not null)`,
    })
    .from(storeSaleItems)
    .innerJoin(storeSales, eq(storeSales.id, storeSaleItems.storeSaleId))
    .where(and(gte(storeSales.createdAt, fromUtc), lt(storeSales.createdAt, toUtc)))

  const online = Number(orderAgg?.merch ?? 0)
  const store = Number(saleAgg?.merch ?? 0)
  return {
    merchandiseRevenueMinor: online + store,
    onlineMerchandiseMinor: online,
    storeMerchandiseMinor: store,
    deliveryFeesMinor: Number(orderAgg?.delivery ?? 0),
    completedOrders: Number(orderAgg?.n ?? 0),
    completedStoreSales: Number(saleAgg?.n ?? 0),
    unitsSold: Number(orderCost?.units ?? 0) + Number(saleCost?.units ?? 0),
    cogsMinor: Number(orderCost?.cogs ?? 0) + Number(saleCost?.cogs ?? 0),
    coveredRevenueMinor:
      Number(orderCost?.coveredRevenue ?? 0) + Number(saleCost?.coveredRevenue ?? 0),
    lineRevenueTotalMinor: Number(orderCost?.lineRevenue ?? 0) + Number(saleCost?.lineRevenue ?? 0),
    costLinesTotal: Number(orderCost?.total ?? 0) + Number(saleCost?.total ?? 0),
    costLinesCovered: Number(orderCost?.covered ?? 0) + Number(saleCost?.covered ?? 0),
  }
}

// ---------------------------------------------------------------------------
// Operational pipeline — current state, deliberately NOT windowed
// ---------------------------------------------------------------------------

export interface PipelineRow {
  processingOrders: number
  processingValueMinor: number
  deliveringOrders: number
  deliveringValueMinor: number
}

export async function getPipeline(db: DbClient): Promise<PipelineRow> {
  const rows = await db
    .select({
      status: orders.status,
      n: sql<string>`count(*)`,
      value: sql<string>`coalesce(sum(${orders.totalMinor}), 0)`,
    })
    .from(orders)
    .where(sql`${orders.status} in ('processing', 'delivering')`)
    .groupBy(orders.status)

  const out: PipelineRow = {
    processingOrders: 0,
    processingValueMinor: 0,
    deliveringOrders: 0,
    deliveringValueMinor: 0,
  }
  for (const r of rows) {
    if (r.status === 'processing') {
      out.processingOrders = Number(r.n)
      out.processingValueMinor = Number(r.value)
    } else if (r.status === 'delivering') {
      out.deliveringOrders = Number(r.n)
      out.deliveringValueMinor = Number(r.value)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Daily series (Sales tab) — online / store split per business day
// ---------------------------------------------------------------------------

export interface DailyPointRow {
  date: string
  merchandiseRevenueMinor: number
  onlineRevenueMinor: number
  storeRevenueMinor: number
  ordersCount: number
  storeSalesCount: number
}

export async function getDailySeries(
  db: DbClient,
  fromUtc: Date,
  toUtc: Date,
): Promise<DailyPointRow[]> {
  const orderRows = await db
    .select({
      d: sql<string>`to_char(date_trunc('day', ${orders.completedAt} at time zone ${TZ}), 'YYYY-MM-DD')`,
      revenue: sql<string>`coalesce(sum(${orders.subtotalMinor}), 0)`,
      n: sql<string>`count(*)`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.status, 'completed'),
        isNotNull(orders.completedAt),
        gte(orders.completedAt, fromUtc),
        lt(orders.completedAt, toUtc),
      ),
    )
    .groupBy(sql`1`)

  const saleRows = await db
    .select({
      d: sql<string>`to_char(date_trunc('day', ${storeSales.createdAt} at time zone ${TZ}), 'YYYY-MM-DD')`,
      revenue: sql<string>`coalesce(sum(${storeSales.totalMinor}), 0)`,
      n: sql<string>`count(*)`,
    })
    .from(storeSales)
    .where(and(gte(storeSales.createdAt, fromUtc), lt(storeSales.createdAt, toUtc)))
    .groupBy(sql`1`)

  const byDay = new Map<string, DailyPointRow>()
  const ensure = (d: string) => {
    let row = byDay.get(d)
    if (row === undefined) {
      row = {
        date: d,
        merchandiseRevenueMinor: 0,
        onlineRevenueMinor: 0,
        storeRevenueMinor: 0,
        ordersCount: 0,
        storeSalesCount: 0,
      }
      byDay.set(d, row)
    }
    return row
  }
  for (const r of orderRows) {
    const row = ensure(r.d)
    row.onlineRevenueMinor += Number(r.revenue)
    row.merchandiseRevenueMinor += Number(r.revenue)
    row.ordersCount += Number(r.n)
  }
  for (const r of saleRows) {
    const row = ensure(r.d)
    row.storeRevenueMinor += Number(r.revenue)
    row.merchandiseRevenueMinor += Number(r.revenue)
    row.storeSalesCount += Number(r.n)
  }
  return [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

// ---------------------------------------------------------------------------
// Product performance (top sellers)
// ---------------------------------------------------------------------------

export interface ProductSalesRow {
  variantId: string
  sku: string
  productNameAr: string
  productNameEn: string
  unitsSold: number
  revenueMinor: number
}

export async function getTopSellers(
  db: DbClient,
  fromUtc: Date,
  toUtc: Date,
  limit: number,
): Promise<ProductSalesRow[]> {
  const orderRows = await db
    .select({
      variantId: orderItems.variantId,
      sku: orderItems.skuSnapshot,
      ar: orderItems.productNameArSnapshot,
      en: orderItems.productNameEnSnapshot,
      units: sql<string>`sum(${orderItems.quantity})`,
      revenue: sql<string>`sum(${orderItems.lineTotalMinor})`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orders.status, 'completed'),
        isNotNull(orders.completedAt),
        gte(orders.completedAt, fromUtc),
        lt(orders.completedAt, toUtc),
      ),
    )
    .groupBy(
      orderItems.variantId,
      orderItems.skuSnapshot,
      orderItems.productNameArSnapshot,
      orderItems.productNameEnSnapshot,
    )

  const saleRows = await db
    .select({
      variantId: storeSaleItems.variantId,
      sku: storeSaleItems.skuSnapshot,
      ar: storeSaleItems.productNameArSnapshot,
      en: storeSaleItems.productNameEnSnapshot,
      units: sql<string>`sum(${storeSaleItems.quantity})`,
      revenue: sql<string>`sum(${storeSaleItems.unitPriceMinor} * ${storeSaleItems.quantity})`,
    })
    .from(storeSaleItems)
    .innerJoin(storeSales, eq(storeSales.id, storeSaleItems.storeSaleId))
    .where(and(gte(storeSales.createdAt, fromUtc), lt(storeSales.createdAt, toUtc)))
    .groupBy(
      storeSaleItems.variantId,
      storeSaleItems.skuSnapshot,
      storeSaleItems.productNameArSnapshot,
      storeSaleItems.productNameEnSnapshot,
    )

  const byVariant = new Map<string, ProductSalesRow>()
  const fold = (r: {
    variantId: string
    sku: string
    ar: string
    en: string
    units: string
    revenue: string
  }) => {
    let row = byVariant.get(r.variantId)
    if (row === undefined) {
      row = {
        variantId: r.variantId,
        sku: r.sku,
        productNameAr: r.ar,
        productNameEn: r.en,
        unitsSold: 0,
        revenueMinor: 0,
      }
      byVariant.set(r.variantId, row)
    }
    row.unitsSold += Number(r.units)
    row.revenueMinor += Number(r.revenue)
  }
  orderRows.forEach(fold)
  saleRows.forEach(fold)
  return [...byVariant.values()]
    .sort((a, b) => b.unitsSold - a.unitsSold || b.revenueMinor - a.revenueMinor)
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Stagnation / slow movers — with filters (§24/§25)
// ---------------------------------------------------------------------------

export interface StagnantFilter {
  /** Days a stocked variant must have gone WITHOUT a sale to qualify. */
  stagnantDays: number
  categoryId?: string
  supplierId?: string
  /** Only variants with `availableToSell > 0` (default true — that's the point). */
  withStockOnly?: boolean
  /** Only variants that have never been sold at all. */
  neverSoldOnly?: boolean
  search?: string
  limit: number
}

export interface StagnantRow {
  variantId: string
  sku: string
  productNameAr: string
  productNameEn: string
  categoryNameAr: string | null
  categoryNameEn: string | null
  supplierNameAr: string | null
  supplierNameEn: string | null
  availableToSell: number
  unitsSoldInWindow: number
  lastSoldAt: Date | null
  daysSinceLastSale: number | null
  /** availableToSell × current acquisition cost, when cost is known. */
  estimatedCapitalMinor: number | null
  lowStock: boolean
  outOfStock: boolean
}

const LOW_STOCK_THRESHOLD = 3

export async function getStagnant(
  db: DbClient,
  fromUtc: Date,
  toUtc: Date,
  filter: StagnantFilter,
): Promise<StagnantRow[]> {
  const like = filter.search ? `%${filter.search.toLowerCase()}%` : null
  const rows = await db
    .select({
      variantId: productVariants.id,
      sku: productVariants.sku,
      cost: productVariants.acquisitionCostMinor,
      productId: products.id,
      catId: products.categoryId,
      supId: products.supplierId,
      ar: products.nameAr,
      en: products.nameEn,
      available: sql<string>`greatest(coalesce(${inventoryBalances.quantityOnHand}, 0) - coalesce(${inventoryBalances.quantityReserved}, 0), 0)`,
      soldInWindow: sql<string>`(
        coalesce((select sum(oi.quantity) from order_items oi join orders o on o.id = oi.order_id
          where oi.variant_id = ${productVariants.id} and o.status = 'completed'
          and o.completed_at >= ${fromUtc} and o.completed_at < ${toUtc}), 0)
        + coalesce((select sum(si.quantity) from store_sale_items si join store_sales s on s.id = si.store_sale_id
          where si.variant_id = ${productVariants.id}
          and s.created_at >= ${fromUtc} and s.created_at < ${toUtc}), 0)
      )`,
      lastSoldAt: sql<Date | null>`greatest(
        (select max(o.completed_at) from order_items oi join orders o on o.id = oi.order_id
          where oi.variant_id = ${productVariants.id} and o.status = 'completed'),
        (select max(s.created_at) from store_sale_items si join store_sales s on s.id = si.store_sale_id
          where si.variant_id = ${productVariants.id})
      )`,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(inventoryBalances, eq(inventoryBalances.variantId, productVariants.id))
    .where(eq(productVariants.status, 'active'))

  // Category / supplier names for display (CURRENT — this is a "what's slow in
  // my catalog right now" view, not a historical sale attribution).
  const catIds = [...new Set(rows.map((r) => r.catId).filter((x): x is string => x !== null))]
  const supIds = [...new Set(rows.map((r) => r.supId).filter((x): x is string => x !== null))]
  const cats =
    catIds.length > 0
      ? await db
          .select({ id: categories.id, ar: categories.nameAr, en: categories.nameEn })
          .from(categories)
          .where(inArray(categories.id, catIds))
      : []
  const sups =
    supIds.length > 0
      ? await db
          .select({ id: suppliers.id, ar: suppliers.nameAr, en: suppliers.nameEn })
          .from(suppliers)
          .where(inArray(suppliers.id, supIds))
      : []
  const catById = new Map(cats.map((c) => [c.id, c]))
  const supById = new Map(sups.map((s) => [s.id, s]))

  const now = Date.now()
  const thresholdMs = filter.stagnantDays * 86_400_000
  const withStockOnly = filter.withStockOnly ?? true

  return rows
    .map((r) => {
      const available = Number(r.available)
      const last = r.lastSoldAt ? new Date(r.lastSoldAt) : null
      const daysSince = last ? Math.floor((now - last.getTime()) / 86_400_000) : null
      const cost = r.cost
      return {
        variantId: r.variantId,
        sku: r.sku,
        productNameAr: r.ar,
        productNameEn: r.en,
        categoryNameAr: r.catId ? (catById.get(r.catId)?.ar ?? null) : null,
        categoryNameEn: r.catId ? (catById.get(r.catId)?.en ?? null) : null,
        supplierNameAr: r.supId ? (supById.get(r.supId)?.ar ?? null) : null,
        supplierNameEn: r.supId ? (supById.get(r.supId)?.en ?? null) : null,
        availableToSell: available,
        unitsSoldInWindow: Number(r.soldInWindow),
        lastSoldAt: last,
        daysSinceLastSale: daysSince,
        estimatedCapitalMinor: cost != null ? available * cost : null,
        lowStock: available > 0 && available <= LOW_STOCK_THRESHOLD,
        outOfStock: available === 0,
        _catId: r.catId,
        _supId: r.supId,
        _searchable: `${r.ar} ${r.en} ${r.sku}`.toLowerCase(),
      }
    })
    .filter((r) => {
      if (withStockOnly && r.availableToSell <= 0) return false
      if (filter.categoryId && r._catId !== filter.categoryId) return false
      if (filter.supplierId && r._supId !== filter.supplierId) return false
      if (like && !r._searchable.includes(like.replaceAll('%', ''))) return false
      // "stagnant" gate: no sale within the window AND (never sold OR the last
      // sale is older than the threshold — a never-sold item still needs to be
      // old enough to count, using its variant age is out of scope so we treat
      // never-sold-with-stock as always stagnant per §25's "age threshold" only
      // when we lack a date; keep it simple and truthful).
      if (r.unitsSoldInWindow > 0) return false
      if (filter.neverSoldOnly) return r.lastSoldAt === null
      if (r.lastSoldAt === null) return true
      return now - r.lastSoldAt.getTime() >= thresholdMs
    })
    .sort(
      (a, b) =>
        (b.daysSinceLastSale ?? Number.MAX_SAFE_INTEGER) -
          (a.daysSinceLastSale ?? Number.MAX_SAFE_INTEGER) || b.availableToSell - a.availableToSell,
    )
    .slice(0, filter.limit)
    .map((row) => {
      const clean: Omit<StagnantRow, never> & {
        _catId?: unknown
        _supId?: unknown
        _searchable?: unknown
      } = { ...row }
      delete clean._catId
      delete clean._supId
      delete clean._searchable
      return clean as StagnantRow
    })
}

// ---------------------------------------------------------------------------
// Supplier / category breakdown
// ---------------------------------------------------------------------------

export interface BreakdownRow {
  key: string
  labelAr: string
  labelEn: string
  unitsSold: number
  revenueMinor: number
  /** COGS of the cost-covered lines only. */
  cogsMinor: number
  /** Line revenue of the cost-covered lines only. */
  coveredRevenueMinor: number
  costLinesTotal: number
  costLinesCovered: number
}

async function breakdownByColumn(
  db: DbClient,
  fromUtc: Date,
  toUtc: Date,
  which: 'supplier' | 'category',
): Promise<{ rows: BreakdownRow[]; unattributedRevenueMinor: number }> {
  const idCol = which === 'supplier' ? 'supplier_id_snapshot' : 'category_id_snapshot'
  const arCol = which === 'supplier' ? 'supplier_name_ar_snapshot' : 'category_name_ar_snapshot'
  const enCol = which === 'supplier' ? 'supplier_name_en_snapshot' : 'category_name_en_snapshot'

  const q = sql`
    select
      coalesce(key_id::text, '') as key,
      max(ar) as ar,
      max(en) as en,
      sum(units)::bigint as units,
      sum(revenue)::bigint as revenue,
      sum(cogs)::bigint as cogs,
      sum(case when has_cost then revenue else 0 end)::bigint as covered_revenue,
      count(*)::bigint as lines_total,
      count(*) filter (where has_cost)::bigint as lines_covered
    from (
      select oi.${sql.raw(idCol)} as key_id, oi.${sql.raw(arCol)} as ar, oi.${sql.raw(enCol)} as en,
        oi.quantity as units, oi.line_total_minor as revenue,
        case when oi.unit_cost_snapshot is not null then oi.unit_cost_snapshot * oi.quantity else 0 end as cogs,
        (oi.unit_cost_snapshot is not null) as has_cost
      from order_items oi join orders o on o.id = oi.order_id
      where o.status = 'completed' and o.completed_at >= ${fromUtc} and o.completed_at < ${toUtc}
      union all
      select si.${sql.raw(idCol)}, si.${sql.raw(arCol)}, si.${sql.raw(enCol)},
        si.quantity, si.unit_price_minor * si.quantity,
        case when si.unit_cost_snapshot is not null then si.unit_cost_snapshot * si.quantity else 0 end,
        (si.unit_cost_snapshot is not null)
      from store_sale_items si join store_sales s on s.id = si.store_sale_id
      where s.created_at >= ${fromUtc} and s.created_at < ${toUtc}
    ) lines
    group by coalesce(key_id::text, '')
  `
  const result = await db.execute(q)
  const raw = (result as unknown as { rows?: Record<string, unknown>[] }).rows ?? []

  let unattributedRevenueMinor = 0
  const rows: BreakdownRow[] = []
  for (const r of raw) {
    const key = String(r.key ?? '')
    const revenue = Number(r.revenue ?? 0)
    if (key === '') {
      unattributedRevenueMinor += revenue
      continue
    }
    rows.push({
      key,
      labelAr: (r.ar as string | null) ?? key,
      labelEn: (r.en as string | null) ?? key,
      unitsSold: Number(r.units ?? 0),
      revenueMinor: revenue,
      cogsMinor: Number(r.cogs ?? 0),
      coveredRevenueMinor: Number(r.covered_revenue ?? 0),
      costLinesTotal: Number(r.lines_total ?? 0),
      costLinesCovered: Number(r.lines_covered ?? 0),
    })
  }
  rows.sort((a, b) => b.revenueMinor - a.revenueMinor)
  return { rows, unattributedRevenueMinor }
}

export function getSupplierBreakdown(db: DbClient, fromUtc: Date, toUtc: Date) {
  return breakdownByColumn(db, fromUtc, toUtc, 'supplier')
}

export function getCategoryBreakdown(db: DbClient, fromUtc: Date, toUtc: Date) {
  return breakdownByColumn(db, fromUtc, toUtc, 'category')
}

/**
 * Per-CURRENT-supplier catalog health — units in stock and how many of its
 * active SKUs have gone `stagnantDays` without a sale. Joined on the product's
 * CURRENT supplier (a "what should I reorder / stop ordering" view), distinct
 * from the historical sale-time supplier snapshot used for revenue.
 */
export interface SupplierInventoryRow {
  supplierId: string
  currentInventoryUnits: number
  stagnantSkuCount: number
}

/** All supplier display names — for listing suppliers that have inventory but
 *  no window sales. */
export async function getSupplierNames(
  db: DbClient,
): Promise<Map<string, { ar: string; en: string | null }>> {
  const rows = await db
    .select({ id: suppliers.id, ar: suppliers.nameAr, en: suppliers.nameEn })
    .from(suppliers)
  return new Map(rows.map((r) => [r.id, { ar: r.ar, en: r.en }]))
}

export async function getSupplierInventoryHealth(
  db: DbClient,
  stagnantDays: number,
): Promise<Map<string, SupplierInventoryRow>> {
  const cutoff = new Date(Date.now() - stagnantDays * 86_400_000)
  const q = sql`
    select p.supplier_id as sup,
      coalesce(sum(greatest(coalesce(b.quantity_on_hand,0) - coalesce(b.quantity_reserved,0), 0)), 0)::bigint as units,
      count(*) filter (where
        greatest(coalesce(b.quantity_on_hand,0) - coalesce(b.quantity_reserved,0), 0) > 0
        and coalesce(
          greatest(
            (select max(o.completed_at) from order_items oi join orders o on o.id=oi.order_id where oi.variant_id=v.id and o.status='completed'),
            (select max(s.created_at) from store_sale_items si join store_sales s on s.id=si.store_sale_id where si.variant_id=v.id)
          ),
          timestamptz '1970-01-01'
        ) < ${cutoff}
      )::bigint as stagnant_skus
    from product_variants v
    join products p on p.id = v.product_id
    left join inventory_balances b on b.variant_id = v.id
    where v.status = 'active' and p.supplier_id is not null
    group by p.supplier_id
  `
  const result = await db.execute(q)
  const raw = (result as unknown as { rows?: Record<string, unknown>[] }).rows ?? []
  const map = new Map<string, SupplierInventoryRow>()
  for (const r of raw) {
    const id = String(r.sup)
    map.set(id, {
      supplierId: id,
      currentInventoryUnits: Number(r.units ?? 0),
      stagnantSkuCount: Number(r.stagnant_skus ?? 0),
    })
  }
  return map
}

export interface SupplierProductRow {
  variantId: string
  sku: string
  productNameAr: string
  productNameEn: string
  unitsSold: number
  revenueMinor: number
  cogsMinor: number
  coveredRevenueMinor: number
  costLinesTotal: number
  costLinesCovered: number
  /** CURRENT available stock — reported ONLY while the product is STILL
   *  supplied by this supplier (§6/§7). `0` once it has moved elsewhere. */
  availableToSell: number
  /** `false` once the product's CURRENT supplier is no longer this supplier —
   *  the historical sales still show, the current stock does not attach here. */
  currentlySupplied: boolean
  daysSinceLastSale: number | null
}

/**
 * Supplier drilldown (§5–§7). TWO deliberately different truths:
 *  - HISTORICAL units/revenue/margin: attributed by the SALE-TIME
 *    `supplier_id_snapshot`. A later reassignment never moves a past line.
 *  - CURRENT available stock: attached ONLY when the product's CURRENT
 *    `products.supplier_id` is still this supplier. If the product has since
 *    moved to another supplier, the historical rows remain but `availableToSell`
 *    is `0` and `currentlySupplied` is `false` — the current stock is counted
 *    under the new supplier's current-inventory metrics instead.
 */
export async function getSupplierProductBreakdown(
  db: DbClient,
  supplierId: string,
  fromUtc: Date,
  toUtc: Date,
): Promise<{ name: { ar: string; en: string | null } | null; rows: SupplierProductRow[] }> {
  const [sup] = await db
    .select({ ar: suppliers.nameAr, en: suppliers.nameEn })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId))
    .limit(1)

  const q = sql`
    with lines as (
      select oi.variant_id as vid, oi.sku_snapshot as sku,
        oi.product_name_ar_snapshot as ar, oi.product_name_en_snapshot as en,
        oi.quantity as units, oi.line_total_minor as revenue,
        case when oi.unit_cost_snapshot is not null then oi.unit_cost_snapshot * oi.quantity else 0 end as cogs,
        (oi.unit_cost_snapshot is not null) as has_cost
      from order_items oi join orders o on o.id = oi.order_id
      where oi.supplier_id_snapshot = ${supplierId}
        and o.status = 'completed' and o.completed_at >= ${fromUtc} and o.completed_at < ${toUtc}
      union all
      select si.variant_id, si.sku_snapshot,
        si.product_name_ar_snapshot, si.product_name_en_snapshot,
        si.quantity, si.unit_price_minor * si.quantity,
        case when si.unit_cost_snapshot is not null then si.unit_cost_snapshot * si.quantity else 0 end,
        (si.unit_cost_snapshot is not null)
      from store_sale_items si join store_sales s on s.id = si.store_sale_id
      where si.supplier_id_snapshot = ${supplierId}
        and s.created_at >= ${fromUtc} and s.created_at < ${toUtc}
    )
    select l.vid, max(l.sku) as sku, max(l.ar) as ar, max(l.en) as en,
      sum(l.units)::bigint as units, sum(l.revenue)::bigint as revenue,
      sum(l.cogs)::bigint as cogs,
      sum(case when l.has_cost then l.revenue else 0 end)::bigint as covered_revenue,
      count(*)::bigint as lines_total,
      count(*) filter (where l.has_cost)::bigint as lines_covered,
      -- CURRENT stock ONLY while the product is STILL supplied by this supplier
      (p.supplier_id is not distinct from ${supplierId}) as currently_supplied,
      case when p.supplier_id is not distinct from ${supplierId}
        then greatest(coalesce(b.quantity_on_hand,0) - coalesce(b.quantity_reserved,0), 0)
        else 0 end as available,
      greatest(
        (select max(o.completed_at) from order_items oi join orders o on o.id=oi.order_id where oi.variant_id = l.vid and o.status='completed'),
        (select max(s.created_at) from store_sale_items si join store_sales s on s.id=si.store_sale_id where si.variant_id = l.vid)
      ) as last_sold_at
    from lines l
    left join product_variants pv on pv.id = l.vid
    left join products p on p.id = pv.product_id
    left join inventory_balances b on b.variant_id = l.vid
    group by l.vid, p.supplier_id, b.quantity_on_hand, b.quantity_reserved
    order by revenue desc
  `
  const result = await db.execute(q)
  const raw = (result as unknown as { rows?: Record<string, unknown>[] }).rows ?? []
  const now = Date.now()
  return {
    name: sup ? { ar: sup.ar, en: sup.en } : null,
    rows: raw.map((r) => {
      const last = r.last_sold_at ? new Date(r.last_sold_at as string) : null
      return {
        variantId: String(r.vid),
        sku: String(r.sku),
        productNameAr: (r.ar as string) ?? String(r.sku),
        productNameEn: (r.en as string) ?? String(r.sku),
        unitsSold: Number(r.units ?? 0),
        revenueMinor: Number(r.revenue ?? 0),
        cogsMinor: Number(r.cogs ?? 0),
        coveredRevenueMinor: Number(r.covered_revenue ?? 0),
        costLinesTotal: Number(r.lines_total ?? 0),
        costLinesCovered: Number(r.lines_covered ?? 0),
        availableToSell: Number(r.available ?? 0),
        currentlySupplied: r.currently_supplied === true,
        daysSinceLastSale: last ? Math.floor((now - last.getTime()) / 86_400_000) : null,
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Regions (delivery-zone snapshot)
// ---------------------------------------------------------------------------

export interface ZoneBreakdownRow {
  key: string
  labelAr: string
  labelEn: string
  ordersCount: number
  uniqueCustomers: number
  revenueMinor: number
  averageBasketMinor: number
  lastActivityAt: Date | null
}

export async function getZoneBreakdown(
  db: DbClient,
  fromUtc: Date,
  toUtc: Date,
): Promise<ZoneBreakdownRow[]> {
  const q = sql`
    select
      coalesce(nullif(o.delivery_zone_code_snapshot, ''), '__none__') as code,
      max(coalesce(
        nullif(o.delivery_zone_name_ar_snapshot, ''),
        nullif(dz.name_ar, ''),
        nullif(o.city_ar, ''),
        nullif(dz.name_en, '')
      )) as ar,
      max(coalesce(
        nullif(o.delivery_zone_name_en_snapshot, ''),
        nullif(dz.name_en, ''),
        nullif(o.city_en, ''),
        nullif(dz.name_ar, '')
      )) as en,
      count(*)::bigint as n,
      count(distinct coalesce(o.customer_id::text, o.customer_phone_normalized))::bigint as uniq,
      coalesce(sum(o.subtotal_minor), 0)::bigint as revenue,
      max(o.completed_at) as last_at
    from orders o
    left join delivery_zones dz
      on dz.id = o.delivery_zone_id
      or dz.code = nullif(o.delivery_zone_code_snapshot, '')
    where o.status = 'completed' and o.completed_at >= ${fromUtc} and o.completed_at < ${toUtc}
    group by 1
  `
  const result = await db.execute(q)
  const raw = (result as unknown as { rows?: Record<string, unknown>[] }).rows ?? []
  return raw
    .map((r) => {
      const n = Number(r.n ?? 0)
      const revenue = Number(r.revenue ?? 0)
      const code = String(r.code)
      return {
        key: code === '__none__' ? 'unknown' : code,
        labelAr: (r.ar as string | null) || (code === '__none__' ? '' : code),
        labelEn: (r.en as string | null) || (code === '__none__' ? '' : code),
        ordersCount: n,
        uniqueCustomers: Number(r.uniq ?? 0),
        revenueMinor: revenue,
        averageBasketMinor: n > 0 ? Math.round(revenue / n) : 0,
        lastActivityAt: r.last_at ? new Date(r.last_at as string) : null,
      }
    })
    .sort((a, b) => b.revenueMinor - a.revenueMinor)
}

export interface CustomerRegionRequestRow {
  labelAr: string
  labelEn: string
  requestsCount: number
}

/** Most-requested customer region for the overview insight. */
export async function getCustomerRegionRequests(
  db: DbClient,
  fromUtc: Date,
  toUtc: Date,
): Promise<CustomerRegionRequestRow[]> {
  const q = sql`
    select
      max(nullif(btrim(c.city_ar), '')) as ar,
      max(nullif(btrim(c.city_en), '')) as en,
      count(*)::bigint as requests
    from orders o
    join ${customers} c on c.id = o.customer_id
    where o.status = 'completed'
      and o.completed_at >= ${fromUtc} and o.completed_at < ${toUtc}
      and nullif(btrim(coalesce(c.city_ar, c.city_en)), '') is not null
    group by lower(coalesce(nullif(btrim(c.city_ar), ''), nullif(btrim(c.city_en), '')))
  `
  const result = await db.execute(q)
  const raw = (result as unknown as { rows?: Record<string, unknown>[] }).rows ?? []
  return raw
    .map((r) => ({
      labelAr: (r.ar as string | null) ?? (r.en as string | null) ?? '',
      labelEn: (r.en as string | null) ?? (r.ar as string | null) ?? '',
      requestsCount: Number(r.requests ?? 0),
    }))
    .sort((a, b) => b.requestsCount - a.requestsCount)
}

// ---------------------------------------------------------------------------
// Customers (window)
// ---------------------------------------------------------------------------

export interface WindowCustomersRow {
  /** Distinct PURCHASING customers active in the window (>= 1 completed tx). */
  uniqueCount: number
  /** First-ever completed purchase falls inside the window. */
  newCount: number
  /** Active in the window with >= 2 completed purchases by the window's end.
   *  MAY overlap `newCount` — the two are intentionally independent. */
  repeatPurchaserCount: number
  /** SEPARATE cohort: active in the window and had a completed purchase
   *  BEFORE it. Never labelled the generic "returning customers". */
  returnedFromPreviousPeriodCount: number
  onlineOnly: number
  storeOnly: number
  bothChannels: number
}

export async function getWindowCustomers(
  db: DbClient,
  fromUtc: Date,
  toUtc: Date,
): Promise<WindowCustomersRow> {
  // "Unique" = customers with at least one COMPLETED transaction IN the
  // window. NEW is by the FIRST-EVER completed purchase instant (falls in the
  // window). REPEAT PURCHASER is by the customer's TOTAL completed purchase
  // count up to the END of the window (>= 2) — so a customer whose 1st and
  // 2nd purchases are both inside the window is BOTH new and repeat.
  // `returned_from_previous_period` is the separate "first purchase predates
  // the window" cohort. Never uses `first_seen_at`. Anonymous POS sales
  // (customer_id null) are never counted — they can't inflate any KPI here.
  const q = sql`
    with online as (
      select o.customer_id as cid from orders o
        where o.customer_id is not null and o.status = 'completed'
        and o.completed_at >= ${fromUtc} and o.completed_at < ${toUtc}
      group by o.customer_id
    ),
    store as (
      select s.customer_id as cid from store_sales s
        where s.customer_id is not null
        and s.created_at >= ${fromUtc} and s.created_at < ${toUtc}
      group by s.customer_id
    ),
    active as (
      select cid, true as has_online, false as has_store from online
      union all
      select cid, false, true from store
    ),
    per_customer as (
      select cid,
        bool_or(has_online) as online,
        bool_or(has_store) as store
      from active group by cid
    ),
    with_first as (
      select pc.*,
        least(
          coalesce((select min(o.completed_at) from orders o
            where o.customer_id = pc.cid and o.status = 'completed'), 'infinity'::timestamptz),
          coalesce((select min(s.created_at) from store_sales s
            where s.customer_id = pc.cid), 'infinity'::timestamptz)
        ) as first_completed_at,
        (
          (select count(*) from orders o
            where o.customer_id = pc.cid and o.status = 'completed'
            and o.completed_at < ${toUtc})
          +
          (select count(*) from store_sales s
            where s.customer_id = pc.cid and s.created_at < ${toUtc})
        ) as completed_total_to_end
      from per_customer pc
    )
    select
      count(*)::bigint as uniq,
      count(*) filter (where first_completed_at >= ${fromUtc})::bigint as new_count,
      count(*) filter (where completed_total_to_end >= 2)::bigint as repeat_count,
      count(*) filter (where first_completed_at < ${fromUtc})::bigint as returned_prev_count,
      count(*) filter (where online and not store)::bigint as online_only,
      count(*) filter (where store and not online)::bigint as store_only,
      count(*) filter (where online and store)::bigint as both
    from with_first
  `
  const result = await db.execute(q)
  const r = ((result as unknown as { rows?: Record<string, unknown>[] }).rows ?? [])[0] ?? {}
  return {
    uniqueCount: Number(r.uniq ?? 0),
    newCount: Number(r.new_count ?? 0),
    repeatPurchaserCount: Number(r.repeat_count ?? 0),
    returnedFromPreviousPeriodCount: Number(r.returned_prev_count ?? 0),
    onlineOnly: Number(r.online_only ?? 0),
    storeOnly: Number(r.store_only ?? 0),
    bothChannels: Number(r.both ?? 0),
  }
}

export interface CustomerLinkCoverageRow {
  completedTransactionsTotal: number
  completedTransactionsLinked: number
  onlineCompletedLinked: number
  onlineCompletedUnlinked: number
  storeCompletedLinked: number
  storeCompletedUnlinked: number
}

/**
 * Data-quality view for owner analytics: how many COMPLETED commercial
 * transactions in the window are attached to a customer profile. Unlinked
 * rows are real — anonymous POS sales and historical records with no
 * customer identity. NEVER backfilled, NEVER hidden.
 */
export async function getCustomerLinkCoverage(
  db: DbClient,
  fromUtc: Date,
  toUtc: Date,
): Promise<CustomerLinkCoverageRow> {
  const q = sql`
    with tx as (
      select 'online'::text as ch, o.customer_id as cid from orders o
        where o.status = 'completed'
        and o.completed_at >= ${fromUtc} and o.completed_at < ${toUtc}
      union all
      select 'store'::text as ch, s.customer_id as cid from store_sales s
        where s.created_at >= ${fromUtc} and s.created_at < ${toUtc}
    )
    select
      count(*)::bigint as total,
      count(*) filter (where cid is not null)::bigint as linked,
      count(*) filter (where ch = 'online' and cid is not null)::bigint as online_linked,
      count(*) filter (where ch = 'online' and cid is null)::bigint as online_unlinked,
      count(*) filter (where ch = 'store' and cid is not null)::bigint as store_linked,
      count(*) filter (where ch = 'store' and cid is null)::bigint as store_unlinked
    from tx
  `
  const result = await db.execute(q)
  const r = ((result as unknown as { rows?: Record<string, unknown>[] }).rows ?? [])[0] ?? {}
  return {
    completedTransactionsTotal: Number(r.total ?? 0),
    completedTransactionsLinked: Number(r.linked ?? 0),
    onlineCompletedLinked: Number(r.online_linked ?? 0),
    onlineCompletedUnlinked: Number(r.online_unlinked ?? 0),
    storeCompletedLinked: Number(r.store_linked ?? 0),
    storeCompletedUnlinked: Number(r.store_unlinked ?? 0),
  }
}

/**
 * Contacts (customer identities) that exist but have NEVER completed a
 * purchase — a checkout-attempt / POS-lookup residue. Reported SEPARATELY
 * from purchaser KPIs (§Gate C final: never mixed in). All-time, not
 * windowed.
 */
export async function getContactsWithoutPurchase(db: DbClient): Promise<number> {
  const q = sql`
    select count(*)::bigint as n
    from ${customers} c
    where not exists (
      select 1 from orders o where o.customer_id = c.id and o.status = 'completed'
    ) and not exists (
      select 1 from store_sales s where s.customer_id = c.id
    )
  `
  const result = await db.execute(q)
  const r = ((result as unknown as { rows?: Record<string, unknown>[] }).rows ?? [])[0] ?? {}
  return Number(r.n ?? 0)
}

export interface TopCustomerRow {
  customerId: string
  nameAr: string | null
  nameEn: string | null
  phoneNormalized: string
  ordersCount: number
  storeSalesCount: number
  spendMinor: number
}

export async function getTopCustomers(
  db: DbClient,
  fromUtc: Date,
  toUtc: Date,
  limit: number,
): Promise<TopCustomerRow[]> {
  const q = sql`
    with tx as (
      select o.customer_id as cid, o.total_minor as spend, 1 as is_order, 0 as is_sale
      from orders o
      where o.customer_id is not null and o.status = 'completed'
        and o.completed_at >= ${fromUtc} and o.completed_at < ${toUtc}
      union all
      select s.customer_id, s.total_minor, 0, 1
      from store_sales s
      where s.customer_id is not null
        and s.created_at >= ${fromUtc} and s.created_at < ${toUtc}
    )
    select c.id as customer_id, c.first_name_ar as ar, c.first_name_en as en, c.phone_normalized as phone,
      sum(tx.is_order)::bigint as orders_count,
      sum(tx.is_sale)::bigint as sales_count,
      sum(tx.spend)::bigint as spend
    from tx join ${customers} c on c.id = tx.cid
    group by c.id, c.first_name_ar, c.first_name_en, c.phone_normalized
    order by spend desc
    limit ${limit}
  `
  const result = await db.execute(q)
  const raw = (result as unknown as { rows?: Record<string, unknown>[] }).rows ?? []
  return raw.map((r) => ({
    customerId: String(r.customer_id),
    nameAr: (r.ar as string | null) ?? null,
    nameEn: (r.en as string | null) ?? null,
    phoneNormalized: String(r.phone),
    ordersCount: Number(r.orders_count ?? 0),
    storeSalesCount: Number(r.sales_count ?? 0),
    spendMinor: Number(r.spend ?? 0),
  }))
}
