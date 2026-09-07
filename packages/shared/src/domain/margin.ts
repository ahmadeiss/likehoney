/**
 * Gross-margin truth for partial cost coverage (Gate C final).
 *
 * UNKNOWN acquisition cost is NEVER treated as zero. When some sold revenue
 * has no captured `unit_cost_snapshot`, we must NOT present
 * `totalRevenue − knownCOGS` as the period margin — that silently assumes the
 * uncovered lines cost nothing.
 *
 * Instead we report a margin computed over ONLY the cost-covered lines, plus
 * the revenue-weighted coverage so the owner knows how much of the period it
 * represents. No extrapolation, no estimation of missing cost.
 */
export interface CoveredMargin {
  /** Line revenue from the lines that carried a captured cost. */
  coveredRevenueMinor: number
  /**
   * Gross margin over ONLY those covered lines (`coveredRevenue −
   * coveredCOGS`). `null` when there is no covered revenue at all — 0%
   * coverage means "margin unavailable", never `0`.
   */
  coveredGrossMarginMinor: number | null
  /** 0–100, revenue-weighted: `coveredRevenue / eligibleMerchandiseRevenue`. */
  coveragePct: number
  /** `true` only when every eligible revenue minor is cost-covered — then the
   *  covered margin IS the full-period gross margin and may be shown as such. */
  complete: boolean
}

export function computeCoveredMargin(
  coveredRevenueMinor: number,
  coveredCogsMinor: number,
  eligibleMerchandiseRevenueMinor: number,
): CoveredMargin {
  const coveragePct =
    eligibleMerchandiseRevenueMinor > 0
      ? Math.round((coveredRevenueMinor / eligibleMerchandiseRevenueMinor) * 100)
      : 0
  return {
    coveredRevenueMinor,
    coveredGrossMarginMinor:
      coveredRevenueMinor > 0 ? coveredRevenueMinor - coveredCogsMinor : null,
    coveragePct,
    complete:
      eligibleMerchandiseRevenueMinor > 0 && coveredRevenueMinor >= eligibleMerchandiseRevenueMinor,
  }
}
