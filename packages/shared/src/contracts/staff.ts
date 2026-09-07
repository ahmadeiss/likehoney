/**
 * Staff + RBAC foundation wire contracts.
 *
 * V1 has no authentication (no passwords/sessions/credentials — a separately
 * approved phase). This layer models staff identity and role/permission
 * assignments only; permission codes are stable ASCII (Type D), names and
 * descriptions are staff-facing Type B (Arabic required, English optional).
 */
import { z } from 'zod'

import { entityStatusSchema, paginationQuerySchema } from './common'

export const staffCreateSchema = z.object({
  nameAr: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().max(200).optional(),
  phoneNormalized: z.string().trim().min(6).max(20),
  email: z.string().trim().email().max(254).optional(),
  notes: z.string().trim().max(2000).optional(),
})

export const staffUpdateSchema = staffCreateSchema
  .partial()
  .extend({ status: entityStatusSchema.optional() })

export const staffListQuerySchema = paginationQuerySchema.extend({
  status: entityStatusSchema.optional(),
  search: z.string().trim().max(200).optional(),
})

export const roleCreateSchema = z.object({
  code: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, 'lowercase ASCII code')
    .max(32),
  nameAr: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().max(200).optional(),
  descriptionAr: z.string().trim().max(500).optional(),
  descriptionEn: z.string().trim().max(500).optional(),
})

export const roleUpdateSchema = z
  .object({
    nameAr: z.string().trim().min(1).max(200).optional(),
    nameEn: z.string().trim().max(200).optional(),
    descriptionAr: z.string().trim().max(500).optional(),
    descriptionEn: z.string().trim().max(500).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one updatable field is required',
  })

export const permissionCreateSchema = z.object({
  code: z
    .string()
    .max(64)
    .refine((value) => /^[a-z][a-z0-9:_-]*$/.test(value)),
  nameAr: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().max(200).optional(),
  descriptionAr: z.string().trim().max(500).optional(),
  descriptionEn: z.string().trim().max(500).optional(),
})

export const permissionUpdateSchema = z
  .object({
    nameAr: z.string().trim().min(1).max(200).optional(),
    nameEn: z.string().trim().max(200).optional(),
    descriptionAr: z.string().trim().max(500).optional(),
    descriptionEn: z.string().trim().max(500).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one updatable field is required',
  })

export const assignRoleIdsSchema = z.object({
  roleIds: z.array(z.uuid()).max(50),
})

export const assignPermissionIdsSchema = z.object({
  permissionIds: z.array(z.uuid()).max(200),
})

export type StaffCreateInput = z.infer<typeof staffCreateSchema>
export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>
export type StaffListQuery = z.infer<typeof staffListQuerySchema>
export type RoleCreateInput = z.infer<typeof roleCreateSchema>
export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>
export type PermissionCreateInput = z.infer<typeof permissionCreateSchema>
export type PermissionUpdateInput = z.infer<typeof permissionUpdateSchema>
