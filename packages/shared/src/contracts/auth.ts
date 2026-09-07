/**
 * Staff authentication wire contracts (real sign-in, session lifecycle).
 *
 * Staff sign in with an identifier (phone or email) + password. Passwords are
 * never transmitted beyond TLS and never stored; the server stores only a
 * PBKDF2 hash. Minimum password length is enforced server-side (8+ chars).
 */
import { z } from 'zod'

/** Identifier may be a normalized phone or an email; keep it bounded. */
export const staffLoginSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200),
})

/** A staff member changing their own password. */
export const staffChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(8).max(200),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'new password must differ from the current password',
    path: ['newPassword'],
  })

/** An Admin (or bootstrap) setting/resetting a staff password. */
export const staffSetPasswordSchema = z.object({
  password: z.string().min(8).max(200),
})

export type StaffLoginInput = z.infer<typeof staffLoginSchema>
export type StaffChangePasswordInput = z.infer<typeof staffChangePasswordSchema>
export type StaffSetPasswordInput = z.infer<typeof staffSetPasswordSchema>
