/**
 * Product media wire contracts.
 *
 * Media metadata is updated as JSON (alt text, sort order, primary flag).
 * Uploads are multipart (`FormData`) handled by the media routes; the R2
 * object key is minted by the media storage abstraction. Alt text follows the
 * bilingual policy (Type A): both `alt_ar` and `alt_en` are first-class.
 */
import { z } from 'zod'

export const mediaUpdateSchema = z
  .object({
    altAr: z.string().max(300).nullish(),
    altEn: z.string().max(300).nullish(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one updatable field is required',
  })

/** Full new display order for one product's media, applied atomically. */
export const mediaReorderSchema = z.object({
  mediaIds: z.array(z.uuid()).min(1).max(50),
})

export type MediaReorderInput = z.infer<typeof mediaReorderSchema>

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const

export const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'] as const

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024

export type MediaUpdateInput = z.infer<typeof mediaUpdateSchema>
