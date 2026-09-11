/**
 * Owner Reports & Insights service (Gate C) — `reports:read`.
 *
 * Resolves a store-local `Asia/Hebron` business period into a `[fromUtc,
 * toUtc)` instant range plus a comparison window, then delegates every
 * aggregate to SQL (`repositories/reports.ts`). Nothing is summed in memory
 * from row dumps.
 *
 * Business week = Sunday → Saturday (§14). Comparison windows: previous day /
 * previous 7 days / previous calendar month / preceding equal length.
 *
 * Financial terminology (§Gate C): the cost-based figure is `grossMarginMinor`
 * ("هامش إجمالي"), never "net profit"; delivery fees are separate from
 * merchandise revenue; cost coverage is surfaced, never assumed 100%.
 * Insights are deterministic rule output — no LLM, no unsupported claims.
 */
import {
  STORE_TIMEZONE,
  computeCoveredMargin,
  customerLinkCoverage,
  instantToStoreWallClock,
  isUsableLabel,
  repeatPurchaserRatePct,
  safeHistoricalText,
  storeTimeToUtc,
  type CoveredMargin,
  type ReportsBreakdown,
  type ReportsCustomers,
  type ReportsInsight,
  type ReportsOverview,
  type ReportsPeriodInfo,
  type ReportsProducts,
  type ReportsQuery,
  type ReportsRegions,
  type ReportsSupplierDrilldown,
  type ReportsSales,
  type ReportsStagnantQuery,
} from '@likehoney/shared'
import {
  getCategoryBreakdown,
  getCompletedTotals,
  getContactsWithoutPurchase,
  getCustomerRegionRequests,
  getCustomerLinkCoverage,
  getDailySeries,
  getPipeline,
  getStagnant,
  getSupplierBreakdown,
  getSupplierInventoryHealth,
  getSupplierNames,
  getSupplierProductBreakdown,
  getTopCustomers,
  getTopSellers,
  getWindowCustomers,
  getZoneBreakdown,
  type CompletedTotalsRow,
  type DbClient,
} from '@likehoney/db'

const CURRENCY = 'ILS'

const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
]
const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

interface ResolvedPeriod {
  info: ReportsPeriodInfo
  fromUtc: Date
  toUtc: Date
  compareFromUtc: Date
  compareToUtc: Date
}

function ymd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** UTC instant of store-local midnight starting `isoDate` (YYYY-MM-DD). */
function dayStartUtc(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number)
  return storeTimeToUtc({ year: y!, month: m!, day: d!, hour: 0, minute: 0, second: 0 })
}

function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days))
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

/** Calendar weekday of an ISO date (0 = Sunday), independent of any timezone. */
function weekdayOf(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()
}

function diffDays(fromIso: string, toIso: string): number {
  return Math.round((dayStartUtc(toIso).getTime() - dayStartUtc(fromIso).getTime()) / 86_400_000)
}

function labelForDay(isoDate: string, ar: boolean): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return ar ? `${d} ${MONTHS_AR[m! - 1]} ${y}` : `${d} ${MONTHS_EN[m! - 1]} ${y}`
}

/** "30 أغسطس – 5 سبتمبر 2026" / "1–30 September 2026" (drop the repeated month
 *  when both ends share it). `toDateExclusive` is the day AFTER the last day. */
function labelForRange(fromIso: string, toDateExclusive: string, ar: boolean): string {
  const lastIso = addDaysIso(toDateExclusive, -1)
  const [fy, fm, fd] = fromIso.split('-').map(Number)
  const [ly, lm, ld] = lastIso.split('-').map(Number)
  const months = ar ? MONTHS_AR : MONTHS_EN
  const dash = ' – '
  if (fromIso === lastIso) return labelForDay(fromIso, ar)
  if (fy === ly && fm === lm) {
    return ar ? `${fd}–${ld} ${months[fm! - 1]} ${fy}` : `${fd}–${ld} ${months[fm! - 1]} ${fy}`
  }
  if (fy === ly) {
    return `${fd} ${months[fm! - 1]}${dash}${ld} ${months[lm! - 1]} ${fy}`
  }
  return `${fd} ${months[fm! - 1]} ${fy}${dash}${ld} ${months[lm! - 1]} ${ly}`
}

export function resolvePeriod(q: ReportsQuery, now: Date): ResolvedPeriod {
  const wc = instantToStoreWallClock(now)
  const todayIso = ymd(wc.year, wc.month, wc.day)

  let fromIso: string
  let toIsoExclusive: string
  let compareFromIso: string
  let compareToIso: string

  if (q.period === 'day') {
    fromIso = q.date ?? todayIso
    toIsoExclusive = addDaysIso(fromIso, 1)
    compareToIso = fromIso
    compareFromIso = addDaysIso(fromIso, -1)
  } else if (q.period === 'week') {
    const anchor = q.date ?? todayIso
    fromIso = addDaysIso(anchor, -weekdayOf(anchor)) // back to Sunday
    toIsoExclusive = addDaysIso(fromIso, 7)
    compareToIso = fromIso
    compareFromIso = addDaysIso(fromIso, -7)
  } else if (q.period === 'month') {
    const ym = q.month ?? `${String(wc.year).padStart(4, '0')}-${String(wc.month).padStart(2, '0')}`
    const [y, m] = ym.split('-').map(Number)
    fromIso = ymd(y!, m!, 1)
    toIsoExclusive = m === 12 ? ymd(y! + 1, 1, 1) : ymd(y!, m! + 1, 1)
    const py = m === 1 ? y! - 1 : y!
    const pm = m === 1 ? 12 : m! - 1
    compareFromIso = ymd(py, pm, 1)
    compareToIso = fromIso
  } else {
    // custom — toDate is an INCLUSIVE last calendar day.
    fromIso = q.fromDate ?? todayIso
    const lastIso = q.toDate ?? fromIso
    if (dayStartUtc(lastIso).getTime() < dayStartUtc(fromIso).getTime()) {
      // swap so from <= to (§16 validation is lenient — never a 500)
      toIsoExclusive = addDaysIso(fromIso, 1)
      fromIso = lastIso
    } else {
      toIsoExclusive = addDaysIso(lastIso, 1)
    }
    const len = Math.max(1, diffDays(fromIso, toIsoExclusive))
    compareToIso = fromIso
    compareFromIso = addDaysIso(fromIso, -len)
  }

  return {
    info: {
      period: q.period,
      fromDate: fromIso,
      toDate: toIsoExclusive,
      fromUtc: dayStartUtc(fromIso).toISOString(),
      toUtc: dayStartUtc(toIsoExclusive).toISOString(),
      timezone: STORE_TIMEZONE,
      compareFromDate: compareFromIso,
      compareToDate: compareToIso,
      humanLabelAr: labelForRange(fromIso, toIsoExclusive, true),
      humanLabelEn: labelForRange(fromIso, toIsoExclusive, false),
    },
    fromUtc: dayStartUtc(fromIso),
    toUtc: dayStartUtc(toIsoExclusive),
    compareFromUtc: dayStartUtc(compareFromIso),
    compareToUtc: dayStartUtc(compareToIso),
  }
}

export function pct(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

/**
 * Covered-margin over ONLY the cost-covered lines (§1–§4). Unknown cost is
 * NEVER treated as 0. `coveragePct` is REVENUE-weighted (covered line revenue
 * ÷ all completed line revenue). At 0% coverage the margin is `null`.
 */
export function coveredMargin(totals: CompletedTotalsRow): CoveredMargin {
  return computeCoveredMargin(
    totals.coveredRevenueMinor,
    totals.cogsMinor,
    totals.lineRevenueTotalMinor,
  )
}

/** Per-row covered margin — same rule as the period figure (§4). */
function rowMargin(r: {
  coveredRevenueMinor: number
  cogsMinor: number
  revenueMinor: number
}): CoveredMargin {
  return computeCoveredMargin(r.coveredRevenueMinor, r.cogsMinor, r.revenueMinor)
}

/** Historical product label, U+FFFD-safe, keyed for a report row (§5). */
function safeProductNamesKeyed(r: { productNameAr: string; productNameEn: string; sku: string }): {
  productNameAr: string
  productNameEn: string
} {
  const input = { ar: r.productNameAr, en: r.productNameEn, sku: r.sku }
  return {
    productNameAr: safeHistoricalText(input, 'ar'),
    productNameEn: safeHistoricalText(input, 'en'),
  }
}

export function buildInsights(
  merchDelta: { currentMinor: number; previousMinor: number; changePct: number | null },
  totals: CompletedTotalsRow,
  pipeline: { processingOrders: number; deliveringOrders: number },
  newCustomers: number,
  stagnantNoSales: number,
  topSeller: { nameAr: string; nameEn: string; units: number } | null,
  topRegion?: { labelAr: string; labelEn: string; requestsCount: number } | null,
): ReportsInsight[] {
  const out: ReportsInsight[] = []

  if (merchDelta.changePct !== null && merchDelta.changePct >= 15) {
    out.push({
      kind: 'positive',
      code: 'sales_up',
      textAr: `مبيعات البضاعة أعلى بنسبة ${merchDelta.changePct}% مقارنة بالفترة السابقة.`,
      textEn: `Merchandise sales are up ${merchDelta.changePct}% versus the previous period.`,
    })
  } else if (merchDelta.changePct !== null && merchDelta.changePct <= -15) {
    out.push({
      kind: 'attention',
      code: 'sales_down',
      textAr: `مبيعات البضاعة أقل بنسبة ${Math.abs(merchDelta.changePct)}% مقارنة بالفترة السابقة.`,
      textEn: `Merchandise sales are down ${Math.abs(merchDelta.changePct)}% versus the previous period.`,
    })
  }

  const cov = coveredMargin(totals).coveragePct
  if (totals.lineRevenueTotalMinor > 0 && cov < 100) {
    out.push({
      kind: 'attention',
      code: 'cost_coverage_low',
      textAr: `تكلفة الشراء متوفرة لـ ${cov}% فقط من قيمة المبيعات — يُعرض هامش المبيعات المغطاة بالتكلفة فقط، لا هامش الفترة كاملة.`,
      textEn: `Acquisition cost is available for only ${cov}% of sales value — only the cost-covered margin is shown, not a full-period margin.`,
    })
  }

  if (stagnantNoSales > 0) {
    out.push({
      kind: 'attention',
      code: 'stagnant_stock',
      textAr: `${stagnantNoSales} صنف متوفر للبيع لم يُبَع منه أي قطعة في هذه الفترة.`,
      textEn: `${stagnantNoSales} in-stock ${stagnantNoSales === 1 ? 'product' : 'products'} had no sales in this period.`,
    })
  }

  if (pipeline.processingOrders > 0 || pipeline.deliveringOrders > 0) {
    out.push({
      kind: 'neutral',
      code: 'pipeline',
      textAr: `${pipeline.processingOrders} طلب قيد التجهيز و${pipeline.deliveringOrders} قيد التوصيل الآن.`,
      textEn: `${pipeline.processingOrders} orders preparing and ${pipeline.deliveringOrders} out for delivery right now.`,
    })
  }

  if (newCustomers > 0) {
    out.push({
      kind: 'positive',
      code: 'new_customers',
      textAr: `${newCustomers} عميل جديد ظهر لأول مرة في هذه الفترة.`,
      textEn: `${newCustomers} new ${newCustomers === 1 ? 'customer' : 'customers'} appeared for the first time this period.`,
    })
  }

  if (topRegion && topRegion.requestsCount > 0 && out.length < 6) {
    out.push({
      kind: 'positive',
      code: 'top_region',
      textAr: `أكثر منطقة طلبًا: ${topRegion.labelAr} (${topRegion.requestsCount} طلبات).`,
      textEn: `Most-requested region: ${topRegion.labelEn} (${topRegion.requestsCount} orders).`,
    })
  }

  if (topSeller && topSeller.units > 0 && out.length < 6) {
    out.push({
      kind: 'neutral',
      code: 'top_seller',
      textAr: `الأكثر مبيعًا: ${topSeller.nameAr} (${topSeller.units} قطعة).`,
      textEn: `Best seller: ${topSeller.nameEn} (${topSeller.units} units).`,
    })
  }

  return out.slice(0, 6)
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export async function getReportsOverviewService(
  db: DbClient,
  q: ReportsQuery,
): Promise<ReportsOverview> {
  const p = resolvePeriod(q, new Date())

  const [current, previous, pipeline, windowCustomers, topSellers, stagnant, customerRegions] = await Promise.all([
    getCompletedTotals(db, p.fromUtc, p.toUtc),
    getCompletedTotals(db, p.compareFromUtc, p.compareToUtc),
    getPipeline(db),
    getWindowCustomers(db, p.fromUtc, p.toUtc),
    getTopSellers(db, p.fromUtc, p.toUtc, 1),
    getStagnant(db, p.fromUtc, p.toUtc, {
      stagnantDays: 30,
      withStockOnly: true,
      neverSoldOnly: false,
      limit: 500,
    }),
    getCustomerRegionRequests(db, p.fromUtc, p.toUtc),
  ])

  const curTx = current.completedOrders + current.completedStoreSales
  const prevTx = previous.completedOrders + previous.completedStoreSales

  const merchandiseRevenue = {
    currentMinor: current.merchandiseRevenueMinor,
    previousMinor: previous.merchandiseRevenueMinor,
    changePct: pct(current.merchandiseRevenueMinor, previous.merchandiseRevenueMinor),
  }

  const stagnantNoSales = stagnant.filter((s) => s.unitsSoldInWindow === 0).length
  const top = topSellers[0]
    ? {
        // Safe historical label — corrupted legacy snapshot text (U+FFFD)
        // must never surface in an insight sentence.
        nameAr: safeHistoricalText(
          {
            ar: topSellers[0].productNameAr,
            en: topSellers[0].productNameEn,
            sku: topSellers[0].sku,
          },
          'ar',
        ),
        nameEn: safeHistoricalText(
          {
            ar: topSellers[0].productNameAr,
            en: topSellers[0].productNameEn,
            sku: topSellers[0].sku,
          },
          'en',
        ),
        units: topSellers[0].unitsSold,
      }
    : null
  const topRegion = customerRegions[0]
    ? {
        labelAr: safeHistoricalText(
          {
            ar: customerRegions[0].labelAr,
            en: customerRegions[0].labelEn,
            sku: customerRegions[0].labelEn,
          },
          'ar',
        ),
        labelEn: safeHistoricalText(
          {
            ar: customerRegions[0].labelAr,
            en: customerRegions[0].labelEn,
            sku: customerRegions[0].labelEn,
          },
          'en',
        ),
        requestsCount: customerRegions[0].requestsCount,
      }
    : null

  return {
    period: p.info,
    currency: CURRENCY,
    merchandiseRevenue,
    deliveryFees: {
      currentMinor: current.deliveryFeesMinor,
      previousMinor: previous.deliveryFeesMinor,
      changePct: pct(current.deliveryFeesMinor, previous.deliveryFeesMinor),
    },
    completedOrders: {
      current: current.completedOrders,
      previous: previous.completedOrders,
      changePct: pct(current.completedOrders, previous.completedOrders),
    },
    completedStoreSales: {
      current: current.completedStoreSales,
      previous: previous.completedStoreSales,
      changePct: pct(current.completedStoreSales, previous.completedStoreSales),
    },
    completedTransactions: { current: curTx, previous: prevTx, changePct: pct(curTx, prevTx) },
    unitsSold: {
      current: current.unitsSold,
      previous: previous.unitsSold,
      changePct: pct(current.unitsSold, previous.unitsSold),
    },
    averageBasketMinor: curTx > 0 ? Math.round(current.merchandiseRevenueMinor / curTx) : 0,
    channelSplit: {
      onlineMinor: current.onlineMerchandiseMinor,
      storeMinor: current.storeMerchandiseMinor,
    },
    margin: coveredMargin(current),
    pipeline: {
      processingOrders: pipeline.processingOrders,
      processingValueMinor: pipeline.processingValueMinor,
      deliveringOrders: pipeline.deliveringOrders,
      deliveringValueMinor: pipeline.deliveringValueMinor,
    },
    customers: {
      purchasingCount: windowCustomers.uniqueCount,
      newCount: windowCustomers.newCount,
      repeatPurchaserCount: windowCustomers.repeatPurchaserCount,
      repeatPurchaserRatePct: repeatPurchaserRatePct(
        windowCustomers.repeatPurchaserCount,
        windowCustomers.uniqueCount,
      ),
    },
    insights: buildInsights(
      merchandiseRevenue,
      current,
      pipeline,
      windowCustomers.newCount,
      stagnantNoSales,
      top,
      topRegion,
    ),
  }
}

export async function getReportsSalesService(db: DbClient, q: ReportsQuery): Promise<ReportsSales> {
  const p = resolvePeriod(q, new Date())
  const [daily, totals, prev] = await Promise.all([
    getDailySeries(db, p.fromUtc, p.toUtc),
    getCompletedTotals(db, p.fromUtc, p.toUtc),
    getCompletedTotals(db, p.compareFromUtc, p.compareToUtc),
  ])
  return {
    period: p.info,
    currency: CURRENCY,
    daily,
    totalMerchandiseRevenueMinor: totals.merchandiseRevenueMinor,
    totalDeliveryFeesMinor: totals.deliveryFeesMinor,
    previousMerchandiseRevenueMinor: prev.merchandiseRevenueMinor,
    changePct: pct(totals.merchandiseRevenueMinor, prev.merchandiseRevenueMinor),
  }
}

export async function getReportsProductsService(
  db: DbClient,
  q: ReportsStagnantQuery,
): Promise<ReportsProducts> {
  const p = resolvePeriod(q, new Date())
  const filter = {
    stagnantDays: q.stagnantDays,
    categoryId: q.categoryId,
    supplierId: q.supplierId,
    withStockOnly: q.withStockOnly ?? true,
    neverSoldOnly: q.neverSoldOnly ?? false,
    search: q.search,
    limit: 30,
  }
  const [topSellers, stagnant] = await Promise.all([
    getTopSellers(db, p.fromUtc, p.toUtc, 15),
    getStagnant(db, p.fromUtc, p.toUtc, filter),
  ])

  // enrich top sellers with current stock context
  const stockByVariant = new Map(stagnant.map((s) => [s.variantId, s]))

  return {
    period: p.info,
    currency: CURRENCY,
    topSellers: topSellers.map((r) => ({
      variantId: r.variantId,
      sku: r.sku,
      ...safeProductNamesKeyed(r),
      unitsSold: r.unitsSold,
      revenueMinor: r.revenueMinor,
      availableToSell: stockByVariant.get(r.variantId)?.availableToSell ?? 0,
      lowStock: stockByVariant.get(r.variantId)?.lowStock ?? false,
      outOfStock: stockByVariant.get(r.variantId)?.outOfStock ?? false,
      lastSoldAt: stockByVariant.get(r.variantId)?.lastSoldAt?.toISOString() ?? null,
    })),
    stagnant: stagnant.map((r) => ({
      variantId: r.variantId,
      sku: r.sku,
      ...safeProductNamesKeyed(r),
      categoryNameAr: r.categoryNameAr,
      categoryNameEn: r.categoryNameEn,
      supplierNameAr: r.supplierNameAr,
      supplierNameEn: r.supplierNameEn,
      availableToSell: r.availableToSell,
      unitsSoldInWindow: r.unitsSoldInWindow,
      lastSoldAt: r.lastSoldAt ? r.lastSoldAt.toISOString() : null,
      daysSinceLastSale: r.daysSinceLastSale,
      estimatedCapitalMinor: r.estimatedCapitalMinor,
      lowStock: r.lowStock,
      outOfStock: r.outOfStock,
    })),
    stagnantFilter: {
      stagnantDays: filter.stagnantDays,
      categoryId: filter.categoryId ?? null,
      supplierId: filter.supplierId ?? null,
      withStockOnly: filter.withStockOnly,
      neverSoldOnly: filter.neverSoldOnly,
      search: filter.search ?? null,
    },
  }
}

export async function getReportsSuppliersService(
  db: DbClient,
  q: ReportsQuery,
): Promise<ReportsBreakdown> {
  const p = resolvePeriod(q, new Date())
  const [{ rows, unattributedRevenueMinor }, health, names] = await Promise.all([
    getSupplierBreakdown(db, p.fromUtc, p.toUtc),
    getSupplierInventoryHealth(db, 30),
    getSupplierNames(db),
  ])

  const byKey = new Map(
    rows.map((r) => [
      r.key,
      {
        key: r.key,
        labelAr: r.labelAr,
        labelEn: r.labelEn,
        unitsSold: r.unitsSold,
        revenueMinor: r.revenueMinor,
        margin: rowMargin(r),
        currentInventoryUnits: health.get(r.key)?.currentInventoryUnits ?? 0,
        stagnantSkuCount: health.get(r.key)?.stagnantSkuCount ?? 0,
      },
    ]),
  )

  // Also surface suppliers that hold current inventory but had NO completed
  // sales in the window — the "what should I stop ordering" side of the view.
  for (const [supplierId, h] of health) {
    if (byKey.has(supplierId)) continue
    const n = names.get(supplierId)
    byKey.set(supplierId, {
      key: supplierId,
      labelAr: n?.ar ?? supplierId,
      labelEn: n?.en ?? supplierId,
      unitsSold: 0,
      revenueMinor: 0,
      margin: computeCoveredMargin(0, 0, 0),
      currentInventoryUnits: h.currentInventoryUnits,
      stagnantSkuCount: h.stagnantSkuCount,
    })
  }

  return {
    period: p.info,
    currency: CURRENCY,
    rows: [...byKey.values()].sort(
      (a, b) =>
        b.revenueMinor - a.revenueMinor || b.currentInventoryUnits - a.currentInventoryUnits,
    ),
    unattributedRevenueMinor,
  }
}

export async function getReportsCategoriesService(
  db: DbClient,
  q: ReportsQuery,
): Promise<ReportsBreakdown> {
  const p = resolvePeriod(q, new Date())
  const { rows, unattributedRevenueMinor } = await getCategoryBreakdown(db, p.fromUtc, p.toUtc)
  return {
    period: p.info,
    currency: CURRENCY,
    rows: rows.map((r) => ({
      key: r.key,
      labelAr: r.labelAr,
      labelEn: r.labelEn,
      unitsSold: r.unitsSold,
      revenueMinor: r.revenueMinor,
      margin: rowMargin(r),
    })),
    unattributedRevenueMinor,
  }
}

export async function getReportsSupplierDrilldownService(
  db: DbClient,
  supplierId: string,
  q: ReportsQuery,
): Promise<ReportsSupplierDrilldown> {
  const p = resolvePeriod(q, new Date())
  const { name, rows } = await getSupplierProductBreakdown(db, supplierId, p.fromUtc, p.toUtc)
  return {
    period: p.info,
    currency: CURRENCY,
    supplierId,
    supplierNameAr: name?.ar ?? null,
    supplierNameEn: name?.en ?? null,
    rows: rows.map((r) => ({
      variantId: r.variantId,
      sku: r.sku,
      ...safeProductNamesKeyed(r),
      unitsSold: r.unitsSold,
      revenueMinor: r.revenueMinor,
      margin: rowMargin(r),
      availableToSell: r.availableToSell,
      currentlySupplied: r.currentlySupplied,
      daysSinceLastSale: r.daysSinceLastSale,
    })),
  }
}

export async function getReportsRegionsService(
  db: DbClient,
  q: ReportsQuery,
): Promise<ReportsRegions> {
  const p = resolvePeriod(q, new Date())
  const rows = await getZoneBreakdown(db, p.fromUtc, p.toUtc)
  return {
    period: p.info,
    currency: CURRENCY,
    rows: rows.map((r) => ({
      key: r.key,
      labelAr: r.labelAr,
      labelEn: r.labelEn,
      ordersCount: r.ordersCount,
      uniqueCustomers: r.uniqueCustomers,
      revenueMinor: r.revenueMinor,
      averageBasketMinor: r.averageBasketMinor,
      lastActivityAt: r.lastActivityAt ? r.lastActivityAt.toISOString() : null,
    })),
  }
}

export async function getReportsCustomersService(
  db: DbClient,
  q: ReportsQuery,
): Promise<ReportsCustomers> {
  const p = resolvePeriod(q, new Date())
  const [windowCustomers, top, contactsWithoutPurchase, coverage] = await Promise.all([
    getWindowCustomers(db, p.fromUtc, p.toUtc),
    getTopCustomers(db, p.fromUtc, p.toUtc, 15),
    getContactsWithoutPurchase(db),
    getCustomerLinkCoverage(db, p.fromUtc, p.toUtc),
  ])
  const cov = customerLinkCoverage({
    completedTransactionsTotal: coverage.completedTransactionsTotal,
    completedTransactionsLinked: coverage.completedTransactionsLinked,
  })
  return {
    period: p.info,
    currency: CURRENCY,
    uniqueCount: windowCustomers.uniqueCount,
    newCount: windowCustomers.newCount,
    repeatPurchaserCount: windowCustomers.repeatPurchaserCount,
    repeatPurchaserRatePct: repeatPurchaserRatePct(
      windowCustomers.repeatPurchaserCount,
      windowCustomers.uniqueCount,
    ),
    returnedFromPreviousPeriodCount: windowCustomers.returnedFromPreviousPeriodCount,
    channelCounts: {
      onlineOnly: windowCustomers.onlineOnly,
      storeOnly: windowCustomers.storeOnly,
      both: windowCustomers.bothChannels,
    },
    contactsWithoutPurchase,
    linkCoverage: {
      completedTransactionsTotal: coverage.completedTransactionsTotal,
      completedTransactionsLinkedToCustomer: coverage.completedTransactionsLinked,
      completedTransactionsWithoutCustomer: cov.completedTransactionsWithoutCustomer,
      customerLinkCoveragePct: cov.customerLinkCoveragePct,
      onlineCompletedLinked: coverage.onlineCompletedLinked,
      onlineCompletedUnlinked: coverage.onlineCompletedUnlinked,
      storeCompletedLinked: coverage.storeCompletedLinked,
      storeCompletedUnlinked: coverage.storeCompletedUnlinked,
    },
    topCustomers: top.map((r) => ({
      customerId: r.customerId,
      // A corrupted stored name must not surface in an owner report — drop it
      // and let the UI fall back to the phone (never invent a name).
      nameAr: isUsableLabel(r.nameAr) ? r.nameAr : null,
      nameEn: isUsableLabel(r.nameEn) ? r.nameEn : null,
      phoneNormalized: r.phoneNormalized,
      ordersCount: r.ordersCount,
      storeSalesCount: r.storeSalesCount,
      spendMinor: r.spendMinor,
    })),
  }
}
