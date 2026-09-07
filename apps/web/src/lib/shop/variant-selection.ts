/**
 * The ONE canonical client-side option-selection algorithm — shared by
 * Product Detail (`product-buy.tsx`) and the Quick Option Sheet
 * (`option-sheet.tsx`) so they can never disagree on option order, valid
 * combinations, disabled values, the resolved variant, price or stock state.
 *
 * Works for arbitrary flexible options (color/size/age/capacity/style/...) —
 * nothing here is aware of what an option is CALLED, only of option/value
 * ids, their configured DISPLAY ORDER, and the real variant matrix.
 * `variants` is assumed to already be lifecycle-filtered to "offered"
 * combinations (the public API never returns draft/inactive variants), so
 * "exists in this array" IS "offered".
 *
 * Constraint direction is a "waterfall" by configured option order, never by
 * option name: a value in a LATER option group can be disabled by what's
 * selected in an EARLIER group, but a value in an EARLIER group is never
 * disabled by a LATER group's selection — otherwise two mutually-exclusive
 * groups can deadlock each other (pick an edge Size, and the Color you used
 * to reach it would itself go disabled). This also directly implements the
 * "clear the now-incompatible DEPENDENT selection" recovery rule: changing
 * an earlier group always stays possible; only later, now-impossible
 * selections get pruned.
 */

export interface SelectableVariant {
  id: string
  optionValueIds: string[]
}

/** A `Record<optionId, selectedValueId>` — the shopper's in-progress choice. */
export type OptionSelection = Record<string, string>

/**
 * Resolve the EXACT variant for a complete selection — never "first match" /
 * "nearest match". Returns `undefined` while the selection is incomplete, or
 * (should not normally happen once every disabled value is enforced) if the
 * exact combination genuinely isn't offered.
 */
export function resolveExactVariant<T extends SelectableVariant>(
  optionIds: string[],
  variants: T[],
  selection: OptionSelection,
): T | undefined {
  const selectedIds = optionIds.map((id) => selection[id]).filter((id): id is string => Boolean(id))
  if (optionIds.length > 0 && selectedIds.length !== optionIds.length) return undefined
  if (selectedIds.length === 0) {
    return variants.find((v) => v.optionValueIds.length === 0) ?? variants[0]
  }
  return variants.find(
    (v) =>
      selectedIds.length === v.optionValueIds.length &&
      selectedIds.every((id) => v.optionValueIds.includes(id)),
  )
}

/**
 * Is `valueId` (belonging to `optionId`) reachable given the selections in
 * EARLIER option groups only (by `optionIds` order)? True iff at least one
 * offered variant contains this candidate value AND every earlier group's
 * selected value. Later groups never constrain an earlier one.
 */
export function isValueReachable(
  variants: SelectableVariant[],
  optionIds: string[],
  optionId: string,
  valueId: string,
  selection: OptionSelection,
): boolean {
  const optionIndex = optionIds.indexOf(optionId)
  return variants.some((variant) => {
    if (!variant.optionValueIds.includes(valueId)) return false
    for (const [selOptionId, selValueId] of Object.entries(selection)) {
      const selIndex = optionIds.indexOf(selOptionId)
      if (selIndex === -1 || selIndex >= optionIndex) continue // only earlier groups constrain
      if (!variant.optionValueIds.includes(selValueId)) return false
    }
    return true
  })
}

/**
 * After a selection changes, a LATER group's previously-chosen value may no
 * longer be reachable given the (possibly new) earlier selections — never
 * leave the UI in an impossible hidden state (§12). Walks the groups in
 * order and drops any selection that isn't reachable given only the earlier
 * ones, cascading left to right. Earlier selections are never touched.
 */
export function pruneIncompatibleSelection(
  variants: SelectableVariant[],
  optionIds: string[],
  selection: OptionSelection,
): OptionSelection {
  const next: OptionSelection = {}
  for (const optionId of optionIds) {
    const valueId = selection[optionId]
    if (valueId === undefined) continue
    if (isValueReachable(variants, optionIds, optionId, valueId, next)) {
      next[optionId] = valueId
    }
  }
  return next
}
