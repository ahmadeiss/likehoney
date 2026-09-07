/**
 * Period customer KPI semantics (Gate C final fix).
 *
 * The owner-facing model deliberately keeps NEW and REPEAT PURCHASER
 * independent — a customer whose first-ever completed purchase AND a second
 * completed purchase both fall in the selected period is BOTH new and a
 * repeat purchaser. They are never forced to be mutually exclusive.
 *
 *   PURCHASING CUSTOMERS  — unique customers with >= 1 completed commercial
 *                           transaction in the selected period.
 *   NEW CUSTOMERS         — first-ever completed commercial transaction falls
 *                           inside the selected period.
 *   REPEAT PURCHASERS     — customers active in the period whose total
 *                           completed commercial transaction count, up to the
 *                           END of the selected period, is >= 2.
 *   RETURNED FROM A       — a SEPARATE analytical cohort: active in the period
 *   PREVIOUS PERIOD         and had a completed purchase BEFORE the period.
 *                           Never labelled the generic "returning customers".
 *
 * These are pure functions. "Completed" = online orders with status
 * 'completed' plus every store sale; pending / processing / delivering /
 * cancelled / failed never count. Anonymous POS sales are never customers.
 */

export interface PeriodCustomerInput {
  /** Epoch ms of the customer's first-ever completed commercial transaction. */
  firstCompletedAtMs: number
  /** Count of the customer's completed commercial transactions with a
   *  timestamp strictly before the END of the selected period. */
  completedCountThroughPeriodEnd: number
  /** Epoch ms of the selected period's start (inclusive). */
  periodStartMs: number
}

export interface PeriodCustomerClass {
  /** First-ever completed purchase is inside the selected period. */
  isNew: boolean
  /** >= 2 completed purchases by the end of the selected period. */
  isRepeatPurchaser: boolean
  /** First completed purchase predates the selected period (separate cohort). */
  isReturnedFromPreviousPeriod: boolean
}

export function classifyPeriodCustomer(input: PeriodCustomerInput): PeriodCustomerClass {
  const isNew = input.firstCompletedAtMs >= input.periodStartMs
  return {
    isNew,
    isRepeatPurchaser: input.completedCountThroughPeriodEnd >= 2,
    isReturnedFromPreviousPeriod: !isNew,
  }
}

/**
 * repeatPurchasers ÷ purchasingCustomers × 100, rounded to one decimal
 * (e.g. 1 / 3 → 33.3). 0 when there are no purchasing customers — never
 * divides by zero, never fabricates a rate.
 */
export function repeatPurchaserRatePct(
  repeatPurchasers: number,
  purchasingCustomers: number,
): number {
  if (purchasingCustomers <= 0) return 0
  return Math.round((repeatPurchasers / purchasingCustomers) * 1000) / 10
}

export interface CustomerLinkCoverageInput {
  completedTransactionsTotal: number
  completedTransactionsLinked: number
}

export interface CustomerLinkCoverage {
  completedTransactionsWithoutCustomer: number
  /** linked ÷ total × 100, one decimal. 0 when there are no completed
   *  transactions. Unlinked rows are real (anonymous POS sales + historical
   *  records with no customer identity) — never backfilled or hidden. */
  customerLinkCoveragePct: number
}

export function customerLinkCoverage(input: CustomerLinkCoverageInput): CustomerLinkCoverage {
  const total = Math.max(0, input.completedTransactionsTotal)
  const linked = Math.max(0, Math.min(input.completedTransactionsLinked, total))
  return {
    completedTransactionsWithoutCustomer: total - linked,
    customerLinkCoveragePct: total > 0 ? Math.round((linked / total) * 1000) / 10 : 0,
  }
}
