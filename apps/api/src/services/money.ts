/**
 * Response formatting for money values as human-readable strings.
 *
 * The API always carries integer minor-unit values as the authoritative
 * payload; this helper only adds human-friendly string forms for the success
 * page and totals display. Currency is ILS (V1).
 */
import { fromMinorUnits } from '@likehoney/shared'

const CURRENCY = 'ILS'

export function toMoneyStrings(
  totalMinor: number,
  subtotalMinor: number,
  deliveryFeeMinor: number,
): {
  subtotal: string
  deliveryFee: string
  total: string
  currency: string
} {
  return {
    subtotal: fromMinorUnits(subtotalMinor, CURRENCY),
    deliveryFee: fromMinorUnits(deliveryFeeMinor, CURRENCY),
    total: fromMinorUnits(totalMinor, CURRENCY),
    currency: CURRENCY,
  }
}
