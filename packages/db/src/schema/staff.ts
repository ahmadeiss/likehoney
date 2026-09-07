/**
 * Staff and role-based access control.
 *
 * Staff are employees only — NO customer roles. This schema models staff
 * identity, credential fields (server-side password hash) for real
 * authentication, session lifecycle (granted via the `staff_sessions` table),
 * and flexible RBAC permission assignments. The API resolves the authenticated
 * staff member from a session in `staff_sessions` and authorizes against the
 * `role_permissions` graph on every request.
 */
import { index, pgTable, primaryKey, uniqueIndex } from 'drizzle-orm/pg-core'

import { entityStatus } from './enums'

export const staffUsers = pgTable(
  'staff_users',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    /** Arabic is required (default operational language); English is optional. */
    nameAr: t.text('name_ar').notNull(),
    nameEn: t.text('name_en'),
    phoneNormalized: t.text('phone_normalized').notNull().unique(),
    email: t.text('email').unique(),
    status: entityStatus('status').notNull().default('active'),
    /**
     * Server-side password hash. PBKDF2-SHA256, stored as a self-describing
     * string (`pbkdf2$<iterations>$<saltB64>$<hashB64>`). Never plaintext.
     * Nullable: a staff member without a set password cannot sign in until an
     * Admin (or bootstrap) assigns one.
     */
    passwordHash: t.text('password_hash'),
    /** When true the next successful sign-in must change the password. */
    mustChangePassword: t.boolean('must_change_password').notNull().default(false),
    /** When the last successful sign-in completed. */
    lastLoginAt: t.timestamp('last_login_at', { withTimezone: true }),
    notes: t.text('notes'),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [index('staff_users_status_idx').on(t.status)],
)

export const roles = pgTable(
  'roles',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    /** Stable machine code, e.g. `owner`, `manager`, `staff`. */
    code: t.varchar('code', { length: 32 }).notNull().unique(),
    /** Arabic is required (staff-facing); English is optional. */
    nameAr: t.text('name_ar').notNull(),
    nameEn: t.text('name_en'),
    descriptionAr: t.text('description_ar'),
    descriptionEn: t.text('description_en'),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [index('roles_code_idx').on(t.code)],
)

export const permissions = pgTable(
  'permissions',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    /** Stable machine code, e.g. `products:write`, `orders:read`. */
    code: t.varchar('code', { length: 64 }).notNull().unique(),
    /** Arabic is required (staff-facing); English is optional. */
    nameAr: t.text('name_ar').notNull(),
    nameEn: t.text('name_en'),
    descriptionAr: t.text('description_ar'),
    descriptionEn: t.text('description_en'),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [index('permissions_code_idx').on(t.code)],
)

/** Many-to-many: staff ↔ roles. */
export const staffRoles = pgTable(
  'staff_roles',
  (t) => ({
    staffId: t
      .uuid('staff_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'restrict' }),
    roleId: t
      .uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
  }),
  (t) => [primaryKey({ columns: [t.staffId, t.roleId] })],
)

/**
 * Staff sign-in sessions. Only a hash of the random bearer token is stored
 * server-side; the raw token is delivered to the browser once, in an
 * HttpOnly/Secure/SameSite cookie. Server-authoritative lifecycle:
 *
 * - expiry enforced by `expires_at`
 * - logout revokes the current session (`revoked_at`)
 * - disabling an account revokes ALL of its sessions
 * - changing/resetting a password revokes prior sessions
 */
export const staffSessions = pgTable(
  'staff_sessions',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    staffId: t
      .uuid('staff_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'cascade' }),
    /** SHA-256 of the bearer token. Unique, so a stolen cookie can be revoked. */
    tokenHash: t.text('token_hash').notNull(),
    expiresAt: t.timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Non-null when the session was explicitly revoked (logout/admin). */
    revokedAt: t.timestamp('revoked_at', { withTimezone: true }),
    /** Best-effort request fingerprint (never treated as a security boundary). */
    ip: t.text('ip'),
    userAgent: t.text('user_agent'),
  }),
  (t) => [
    uniqueIndex('staff_sessions_token_hash_idx').on(t.tokenHash),
    index('staff_sessions_staff_id_idx').on(t.staffId),
    index('staff_sessions_expires_at_idx').on(t.expiresAt),
  ],
)

/** Many-to-many: roles ↔ permissions. */
export const rolePermissions = pgTable(
  'role_permissions',
  (t) => ({
    roleId: t
      .uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    permissionId: t
      .uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'restrict' }),
  }),
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
)
