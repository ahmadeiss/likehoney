/**
 * Supplier wire contracts.
 *
 * Suppliers are the entities Like Honey purchases stock from. Names are
 * staff-facing Type B (Arabic required, English optional); contact/address/
 * notes are operational free text (Type C) and are not translated.
 */
import { z } from 'zod'

import { entityStatusSchema } from './common'

export const supplierCreateSchema = z.object({
  nameAr: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().max(200).optional(),
  contactName: z.string().trim().max(200).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  status: entityStatusSchema.optional(),
})

export const supplierUpdateSchema = supplierCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one updatable field is required',
  })

export const supplierListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  status: entityStatusSchema.optional(),
  search: z.string().trim().max(200).optional(),
})

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>
export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>
