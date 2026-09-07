/**
 * Variant + option wire contracts.
 *
 * A variant is the smallest sellable unit and carries its own SKU. Adding a
 * variant requires the option-value ids (empty for a no-option product) so the
 * service can derive the SKU suffix from their codes in option display order.
 *
 * Option-value `code`s are immutable once set (they are embedded in SKUs);
 * display labels may change (SKU_STANDARD.md §4). The service recomputes the
 * `option_label_*` snapshots of every affected variant when labels change.
 */
import { z } from 'zod'

import { variantStatusSchema } from './common'

/**
 * Acquisition (purchase) cost, minor units. `null` = explicitly "unknown / not
 * configured" — DISTINCT from `0` (an explicit zero cost). Reporting cost
 * coverage depends on that distinction, so the schema keeps `null` reachable
 * (`.nullish()`) and never coerces a blank to `0`. Gated by `catalog-cost:write`
 * at the route, independent of `catalog:write`.
 */
const acquisitionCostMinorSchema = z.number().int().min(0).max(100_000_000).nullish()

export const variantCreateSchema = z.object({
  optionValueIds: z.array(z.uuid()).max(20),
  priceMinor: z.number().int().min(0).max(100_000_000),
  acquisitionCostMinor: acquisitionCostMinorSchema,
  status: variantStatusSchema.optional(),
})

export const variantUpdateSchema = z
  .object({
    priceMinor: z.number().int().min(0).max(100_000_000).optional(),
    acquisitionCostMinor: acquisitionCostMinorSchema,
    status: variantStatusSchema.optional(),
    optionLabelEn: z.string().max(300).nullish(),
    optionLabelAr: z.string().max(300).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one updatable field is required',
  })

/**
 * §9 convenience — apply ONE acquisition cost to many sellable variants of a
 * product in one action ("تطبيق على جميع التركيبات"). Purely a fan-out over the
 * canonical per-variant update; `variantIds` omitted ⇒ every variant of the
 * product. `catalog-cost:write` only.
 */
export const variantBulkCostSchema = z.object({
  acquisitionCostMinor: acquisitionCostMinorSchema,
  variantIds: z.array(z.uuid()).max(500).optional(),
})

export const optionUpdateSchema = z
  .object({
    nameEn: z.string().trim().min(1).max(150).optional(),
    nameAr: z.string().trim().min(1).max(150).optional(),
    displayOrder: z.number().int().min(0).max(10000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one updatable field is required',
  })

export const optionValueUpdateSchema = z
  .object({
    valueEn: z.string().trim().min(1).max(150).optional(),
    valueAr: z.string().trim().min(1).max(150).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one updatable field is required',
  })

/**
 * Add a new VALUE to an already-existing option group (e.g. Size gains "31"
 * after the product was created). Deliberately narrow — no `code` (the
 * server derives the SKU segment from `valueEn`, same invariant as every
 * other code in the system: uppercase alnum, embedded in the SKU) and no
 * `displayOrder` (always appended after the current last value). Adding an
 * entirely new OPTION GROUP to an existing product is out of scope; this only
 * grows a value list within a group defined at product creation.
 */
export const optionValueAddSchema = z.object({
  valueEn: z.string().trim().min(1).max(150),
  valueAr: z.string().trim().min(1).max(150),
  /** Initializes every newly-generated variant for this value uniformly. */
  priceMinor: z.number().int().min(0).max(100_000_000),
  /** Optional — initializes the new variants' acquisition cost too. */
  acquisitionCostMinor: acquisitionCostMinorSchema,
})

export type VariantCreateInput = z.infer<typeof variantCreateSchema>
export type VariantUpdateInput = z.infer<typeof variantUpdateSchema>
export type VariantBulkCostInput = z.infer<typeof variantBulkCostSchema>
export type OptionValueAddInput = z.infer<typeof optionValueAddSchema>
