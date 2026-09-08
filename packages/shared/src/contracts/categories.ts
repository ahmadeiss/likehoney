/**
 * Category wire contracts.
 *
 * `code` is a technical identifier (Type D): stable, uppercase ASCII, embedded
 * in SKUs, and immutable once product variants exist. `slug` may be omitted;
 * the service auto-generates it from the English name.
 */
import { z } from 'zod'

import { CATEGORY_VISUAL_MODES, resolveCategoryIconKey } from '../domain/category-icons'
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
  /**
   * Safe category icon key. Optional; when present it must be a key from the
   * approved icon registry (curated grid or the larger registry-only set) —
   * never arbitrary SVG/URL/HTML. The API rejects anything not in the allowed
   * registry, and only the canonical lowercase key is accepted. Frontend
   * validation alone is not trusted.
   * `null` (or omitted) clears/keeps-clear the icon so the storefront falls
   * back to the automatic behavior.
   */
  iconKey: z
    .string()
    .trim()
    .max(64)
    .refine((value) => {
      const resolved = resolveCategoryIconKey(value)
      return resolved !== null && resolved === value
    }, 'icon key must be a canonical key from the approved icon registry')
    .nullish(),
  /**
   * Persistent storefront display mode: `auto` (prefer image → icon →
   * fallback), `image` (show the image when present), or `icon` (show the icon
   * even when an image is stored). Optional; absent defaults to `auto`. The
   * stored image always survives a mode switch — only an explicit image
   * deletion clears it.
   */
  visualMode: z.enum(CATEGORY_VISUAL_MODES).optional(),
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
