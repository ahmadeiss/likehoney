/**
 * Owner-only Reports & Insights — wire contracts (Gate C).
 *
 * Read-only, `reports:read` (owner-only by default). Every window is a
 * BUSINESS period in `Asia/Hebron` — the caller passes a resolved
 * `[fromUtc, toUtc)` instant range (computed from a store-local calendar
 * period via `@likehoney/shared` time helpers), never a raw UTC day.
 *
 * Financial-terminology rules baked into the field names here (§Gate C):
 *  - `merchandiseRevenueMinor` is goods only; delivery fees are reported
 *    SEPARATELY as `deliveryFeesMinor`, never folded into merchandise sales.
 *  - the cost-based figure is a `CoveredMargin` — margin over ONLY the
 *    cost-covered lines. Unknown cost is NEVER treated as 0 and never
 *    extrapolated. It is "هامش البضاعة" only when `complete`, otherwise
 *    "هامش المبيعات المغطاة بالتكلفة"; never "صافي الربح" / net profit.
 *  - `coveragePct` is REVENUE-weighted (covered revenue ÷ eligible revenue).
 *  - "completed sales" excludes cancelled/pending/failed — the operational
 *    pipeline (processing/delivering) is a SEPARATE block.
 *  - historical snapshot labels pass through `safeHistoricalLabel` before
 *    display — corrupted legacy text (U+FFFD) never reaches Owner Intelligence.
 */
import { z } from 'zod'

import type { CoveredMargin } from '../domain/margin'

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * Report modes (§12). Every window is a store-local `Asia/Hebron` business
 * period; the business week is **Sunday → Saturday** (§14 — the directive's own
 * "30 Aug – 5 Sep 2026" example is exactly that).
 *   day    — one business date (`date`, default: today). Compare: previous day.
 *   week   — the Sun–Sat week containing `date` (default: this week).
 *            Compare: the immediately-preceding 7 days.
 *   month  — the calendar month `month` (`YYYY-MM`, default: current).
 *            Compare: the previous calendar month.
 *   custom — `fromDate`..`toDate` inclusive. Compare: preceding equal length.
 */
export const reportPeriodSchema = z.enum(['day', 'week', 'month', 'custom'])

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const isoMonth = z.string().regex(/^\d{4}-\d{2}$/)

export const reportsQuerySchema = z.object({
  period: reportPeriodSchema.default('month'),
  /** Anchor for `day` / `week` — any date inside the target window. */
  date: isoDate.optional(),
  /** Target month for `period=month`. */
  month: isoMonth.optional(),
  /** Inclusive bounds for `period=custom`. */
  fromDate: isoDate.optional(),
  toDate: isoDate.optional(),
})

export type ReportPeriod = z.infer<typeof reportPeriodSchema>
export type ReportsQuery = z.infer<typeof reportsQuerySchema>

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export interface ReportsPeriodInfo {
  period: ReportPeriod
  /** Resolved store-local calendar bounds: `fromDate` inclusive first day,
   *  `toDate` EXCLUSIVE next day. */
  fromDate: string
  toDate: string
  fromUtc: string
  toUtc: string
  timezone: string
  /** The comparison window (previous day / previous 7 days / previous calendar
   *  month / preceding equal length), same inclusive/exclusive convention. */
  compareFromDate: string
  compareToDate: string
  /** Unambiguous "what this report covers" label (§18), fully formed. */
  humanLabelAr: string
  humanLabelEn: string
}

export interface ReportsMoneyDelta {
  currentMinor: number
  previousMinor: number
  /** null when previous is 0 (no baseline — never divide by zero). */
  changePct: number | null
}

export interface ReportsCountDelta {
  current: number
  previous: number
  changePct: number | null
}

export interface ReportsOverview {
  period: ReportsPeriodInfo
  currency: string
  /** Completed sales only (cancelled/pending/failed excluded). */
  merchandiseRevenue: ReportsMoneyDelta
  deliveryFees: ReportsMoneyDelta
  completedOrders: ReportsCountDelta
  completedStoreSales: ReportsCountDelta
  /** Total completed transactions (orders + store sales) and units. */
  completedTransactions: ReportsCountDelta
  unitsSold: ReportsCountDelta
  /** Merchandise revenue ÷ completed transactions. */
  averageBasketMinor: number
  /** Merchandise revenue split by channel (completed only). */
  channelSplit: { onlineMinor: number; storeMinor: number }
  /**
   * Gross margin computed over ONLY the cost-covered lines — unknown cost is
   * NEVER treated as 0. `coveredGrossMarginMinor` is `null` at 0% coverage
   * ("unavailable"). `complete` is `true` only when every eligible revenue
   * minor is covered — then it IS the full-period gross margin.
   * "هامش البضاعة" when complete, "هامش المبيعات المغطاة بالتكلفة" otherwise.
   * Never "net profit". `coveragePct` is REVENUE-weighted.
   */
  margin: CoveredMargin
  /** Separate operational view — NOT part of "completed sales". */
  pipeline: {
    processingOrders: number
    processingValueMinor: number
    deliveringOrders: number
    deliveringValueMinor: number
  }
  /** Customers active in the window (server-computed). `newCount` and
   *  `repeatPurchaserCount` are INTENTIONALLY independent — a customer whose
   *  1st and 2nd completed purchases both fall in the window is counted in
   *  both. `repeatPurchaserRatePct` = repeatPurchasers ÷ purchasing × 100. */
  customers: {
    /** Unique purchasing customers (>= 1 completed tx in the window). */
    purchasingCount: number
    /** First-ever completed purchase falls in the window. */
    newCount: number
    /** >= 2 completed purchases by the window's end. */
    repeatPurchaserCount: number
    /** repeatPurchasers ÷ purchasing × 100, one decimal. */
    repeatPurchaserRatePct: number
  }
  /** Deterministic, rule-based — never LLM-generated. 3–6 items. */
  insights: ReportsInsight[]
}

export interface ReportsInsight {
  kind: 'positive' | 'attention' | 'neutral'
  code: string
  /** Fully-formed bilingual sentences — no client-side templating of numbers. */
  textAr: string
  textEn: string
}

export interface ReportsDailyPoint {
  date: string
  merchandiseRevenueMinor: number
  onlineRevenueMinor: number
  storeRevenueMinor: number
  ordersCount: number
  storeSalesCount: number
}

export interface ReportsSales {
  period: ReportsPeriodInfo
  currency: string
  daily: ReportsDailyPoint[]
  totalMerchandiseRevenueMinor: number
  totalDeliveryFeesMinor: number
  /** Prior-period comparison of the merchandise total (§14/§16). */
  previousMerchandiseRevenueMinor: number
  changePct: number | null
}

export interface ReportsProductRow {
  variantId: string
  sku: string
  productNameAr: string
  productNameEn: string
  unitsSold: number
  revenueMinor: number
  availableToSell: number
  lowStock: boolean
  outOfStock: boolean
  lastSoldAt: string | null
}

export interface ReportsStagnantRow {
  variantId: string
  sku: string
  productNameAr: string
  productNameEn: string
  categoryNameAr: string | null
  categoryNameEn: string | null
  supplierNameAr: string | null
  supplierNameEn: string | null
  /** Actionable quantity — `availableToSell` (on-hand − reserved), never raw
   *  stock, so reserved-for-electronic units aren't double-counted. */
  availableToSell: number
  unitsSoldInWindow: number
  lastSoldAt: string | null
  daysSinceLastSale: number | null
  /** `availableToSell` × CURRENT acquisition cost, when cost is known — a
   *  current inventory VALUE estimate, not a historical figure. `null` when
   *  cost is not configured (never assumed 0). */
  estimatedCapitalMinor: number | null
  lowStock: boolean
  outOfStock: boolean
}

/** Query params for the stagnation view (§24). */
export const reportsStagnantQuerySchema = reportsQuerySchema.extend({
  stagnantDays: z.coerce.number().int().min(1).max(3650).default(30),
  categoryId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  withStockOnly: z.coerce.boolean().optional(),
  neverSoldOnly: z.coerce.boolean().optional(),
  search: z.string().trim().max(200).optional(),
})
export type ReportsStagnantQuery = z.infer<typeof reportsStagnantQuerySchema>

export interface ReportsProducts {
  period: ReportsPeriodInfo
  currency: string
  topSellers: ReportsProductRow[]
  stagnant: ReportsStagnantRow[]
  /** Echo of the applied stagnation filter, so the UI can reflect state. */
  stagnantFilter: {
    stagnantDays: number
    categoryId: string | null
    supplierId: string | null
    withStockOnly: boolean
    neverSoldOnly: boolean
    search: string | null
  }
}

export interface ReportsBreakdownRow {
  key: string
  labelAr: string
  labelEn: string
  unitsSold: number
  revenueMinor: number
  /**
   * Covered-margin semantics (§4): `coveredGrossMarginMinor` is over ONLY the
   * cost-covered lines, `null` at 0% coverage. `complete` → the covered
   * margin IS this row's full gross margin. `coveragePct` is revenue-weighted.
   */
  margin: CoveredMargin
  /** Supplier rows only — CURRENT catalog health for this supplier. */
  currentInventoryUnits?: number
  stagnantSkuCount?: number
}

export interface ReportsBreakdown {
  period: ReportsPeriodInfo
  currency: string
  rows: ReportsBreakdownRow[]
  /** Lines with no snapshot key (e.g. product had no supplier at sale time).
   *  Shown to the reader as "غير محدد", never hidden or fake-attributed. */
  unattributedRevenueMinor: number
}

/** Supplier drilldown (§5) — one supplier's per-product completed-sales
 *  performance in the window + current stock + recency. */
export interface ReportsSupplierProductRow {
  variantId: string
  sku: string
  productNameAr: string
  productNameEn: string
  /** Historical (sale-time snapshot attribution). */
  unitsSold: number
  revenueMinor: number
  /** Covered-margin semantics (§4) — same rule as everywhere else. */
  margin: CoveredMargin
  /** Current stock — non-zero ONLY while the product is still supplied by
   *  this supplier (§6/§7). */
  availableToSell: number
  /** `false` → this product has moved to another supplier; its historical
   *  sales stay here but its current stock does not attach to this supplier. */
  currentlySupplied: boolean
  daysSinceLastSale: number | null
}

export interface ReportsSupplierDrilldown {
  period: ReportsPeriodInfo
  currency: string
  supplierId: string
  supplierNameAr: string | null
  supplierNameEn: string | null
  rows: ReportsSupplierProductRow[]
}

export interface ReportsRegionRow {
  key: string
  labelAr: string
  labelEn: string
  ordersCount: number
  uniqueCustomers: number
  revenueMinor: number
  averageBasketMinor: number
  lastActivityAt: string | null
}

export interface ReportsRegions {
  period: ReportsPeriodInfo
  currency: string
  rows: ReportsRegionRow[]
}

export interface ReportsCustomerRow {
  customerId: string
  nameAr: string | null
  nameEn: string | null
  phoneNormalized: string
  ordersCount: number
  storeSalesCount: number
  spendMinor: number
}

export interface ReportsCustomers {
  period: ReportsPeriodInfo
  currency: string
  /** All of these count COMPLETED commercial transactions only. `uniqueCount`
   *  = distinct PURCHASING customers active in the window; a profile with 0
   *  completed purchases can never appear here. */
  uniqueCount: number
  /** First-ever completed purchase falls in this window. */
  newCount: number
  /** Active in the window with >= 2 completed purchases by the window's end.
   *  MAY overlap `newCount` — intentionally independent. */
  repeatPurchaserCount: number
  /** repeatPurchasers ÷ purchasing × 100, one decimal. */
  repeatPurchaserRatePct: number
  /** SEPARATE analytical cohort — active in the window AND had a completed
   *  purchase BEFORE it. NOT "returning customers" (a different concept). */
  returnedFromPreviousPeriodCount: number
  channelCounts: { onlineOnly: number; storeOnly: number; both: number }
  /** SEPARATE from the purchaser KPIs above: identities with NO completed
   *  purchase ever (checkout-attempt / POS-lookup residue). All-time. */
  contactsWithoutPurchase: number
  /** Data-quality: how many COMPLETED commercial transactions in the window
   *  are attached to a customer profile. Unlinked = anonymous POS sales +
   *  historical records with no identity. Never backfilled, never hidden. */
  linkCoverage: {
    completedTransactionsTotal: number
    completedTransactionsLinkedToCustomer: number
    completedTransactionsWithoutCustomer: number
    customerLinkCoveragePct: number
    onlineCompletedLinked: number
    onlineCompletedUnlinked: number
    storeCompletedLinked: number
    storeCompletedUnlinked: number
  }
  topCustomers: ReportsCustomerRow[]
}
