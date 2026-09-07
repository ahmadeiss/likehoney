/**
 * Category wire contracts.
 *
 * `code` is a technical identifier (Type D): stable, uppercase ASCII, embedded
 * in SKUs, and immutable once product variants exist. `slug` may be omitted;
 * the service auto-generates it from the English name.
 */
import { z } from 'zod'

import { entityStatusSchema } from './common'

export const categoryCreateSchema = z.object({
  nameEn: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase ASCII slug, hyphens allowed')
    .optional(),
  code: z.string().regex(/^[A-Z0-9]{1,8}$/, 'uppercase ASCII code, 1-8 chars'),
  descriptionEn: z.string().max(2000).optional(),
  descriptionAr: z.string().max(2000).optional(),
  status: entityStatusSchema.optional(),
})

export const categoryUpdateSchema = categoryCreateSchema
  .omit({ code: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one updatable field is required',
  })

export const categoryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  status: entityStatusSchema.optional(),
  search: z.string().trim().max(200).optional(),
})

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>
export type CategoryListQuery = z.infer<typeof categoryListQuerySchema>
