/**
 * Gate B4 — the physical / reserved / available stock model.
 *
 * `quantity_on_hand`  real physical units in the store (unchanged Gate-A meaning).
 * `quantity_reserved` physical units held for pending electronic orders.
 * `available_to_sell`  = on_hand − reserved. ALWAYS derived here, NEVER stored.
 *
 * Every surface that answers "can we sell N of this right now?" — Store Sale,
 * COD checkout, electronic reserve, Admin inventory strip — must derive the
 * answer through `availableToSell` / `canFulfil`, so one balance produces one
 * answer everywhere. The DB CHECK `quantity_reserved <= quantity_on_hand`
 * guarantees the difference is never negative, but the helper clamps at 0
 * defensively.
 */

export interface VariantStockLevels {
  /** Real physical units on hand. */
  quantityOnHand: number
  /** Physical units held for pending electronic orders. */
  quantityReserved: number
  /** Derived: units a new sale/order may consume right now. Never negative. */
  availableToSell: number
}

/** Derive `available_to_sell` from the two stored facts. Clamped at 0. */
export function availableToSell(quantityOnHand: number, quantityReserved: number): number {
  return Math.max(0, quantityOnHand - quantityReserved)
}

/** Build the canonical threefold view from the two stored columns. */
export function toStockLevels(
  quantityOnHand: number,
  quantityReserved: number,
): VariantStockLevels {
  return {
    quantityOnHand,
    quantityReserved,
    availableToSell: availableToSell(quantityOnHand, quantityReserved),
  }
}

/** True when `requested` units can be consumed without overselling. */
export function canFulfil(
  levels: Pick<VariantStockLevels, 'quantityOnHand' | 'quantityReserved'>,
  requested: number,
): boolean {
  return (
    requested > 0 && availableToSell(levels.quantityOnHand, levels.quantityReserved) >= requested
  )
}
