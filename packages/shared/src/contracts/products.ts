/**
 * Product wire contracts.
 *
 * The `pricing` discriminated union captures the two documented catalog
 * shapes:
 * - `simple` — a product without options gets exactly one auto-created default
 *   variant (SKU suffix `DEF`).
 * - `options` — the service creates the option definitions and one variant per
 *   unique option-value combination, each priced at `priceMinor` initially
 *   (per-variant prices are managed afterwards via PATCH /variants/:id).
 *
 * Value codes follow SKU_STANDARD.md grammar (`^[A-Z0-9]{1,8}$`).
 */
import { z } from 'zod'

import { paginationQuerySchema, productStatusSchema } from './common'

export const optionValueInputSchema = z.object({
  code: z.string().regex(/^[A-Z0-9]{1,8}$/, 'uppercase ASCII code, 1-8 chars'),
  valueEn: z.string().trim().min(1).max(150),
  valueAr: z.string().trim().min(1).max(150),
})

export const optionInputSchema = z.object({
  nameEn: z.string().trim().min(1).max(150),
  nameAr: z.string().trim().min(1).max(150),
  displayOrder: z.number().int().min(0).max(10000).optional(),
  values: z.array(optionValueInputSchema).min(1).max(50),
})

export const simplePricingSchema = z.object({
  mode: z.literal('simple'),
  priceMinor: z.number().int().min(0).max(100_000_000),
})

export const optionedPricingSchema = z.object({
  mode: z.literal('options'),
  priceMinor: z.number().int().min(0).max(100_000_000),
  options: z.array(optionInputSchema).min(1).max(10),
})

export const productPricingSchema = z.discriminatedUnion('mode', [
  simplePricingSchema,
  optionedPricingSchema,
])

export const productCreateSchema = z.object({
  categoryId: z.uuid().optional(),
  supplierId: z.uuid().optional(),
  nameEn: z.string().trim().min(1).max(300),
  nameAr: z.string().trim().min(1).max(300),
  descriptionEn: z.string().max(5000).optional(),
  descriptionAr: z.string().max(5000).optional(),
  shortBlurbEn: z.string().max(500).optional(),
  shortBlurbAr: z.string().max(500).optional(),
  status: productStatusSchema.optional(),
  pricing: productPricingSchema,
})

export const productUpdateSchema = z
  .object({
    categoryId: z.uuid().nullish(),
    supplierId: z.uuid().nullish(),
    nameEn: z.string().trim().min(1).max(300).optional(),
    nameAr: z.string().trim().min(1).max(300).optional(),
    descriptionEn: z.string().max(5000).nullish(),
    descriptionAr: z.string().max(5000).nullish(),
    shortBlurbEn: z.string().max(500).nullish(),
    shortBlurbAr: z.string().max(500).nullish(),
    status: productStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one updatable field is required',
  })

export const productListQuerySchema = paginationQuerySchema.extend({
  status: productStatusSchema.optional(),
  categoryId: z.uuid().optional(),
  supplierId: z.uuid().optional(),
  search: z.string().trim().max(300).optional(),
})

export type ProductCreateInput = z.infer<typeof productCreateSchema>
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>
export type ProductListQuery = z.infer<typeof productListQuerySchema>
export type ProductPricing = z.infer<typeof productPricingSchema>
export type OptionInput = z.infer<typeof optionInputSchema>
export type OptionValueInput = z.infer<typeof optionValueInputSchema>
