/**
 * Staff + RBAC foundation data access.
 *
 * No authentication in V1: this layer manages staff identity, roles and
 * permission assignments, and answers "does this staff member hold this
 * permission code?" — the authorization decision the future auth session feeds.
 */
import { and, asc, count, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'

import type { DbClient } from '../client'
import { permissions, rolePermissions, roles, staffRoles, staffUsers } from '../schema'
import type { EntityStatusValue } from './categories'

export type StaffUserRow = typeof staffUsers.$inferSelect
export type RoleRow = typeof roles.$inferSelect
export type PermissionRow = typeof permissions.$inferSelect

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export interface StaffListOptions {
  page: number
  pageSize: number
  status?: EntityStatusValue
  search?: string
}

export async function listStaffUsers(
  db: DbClient,
  options: StaffListOptions,
): Promise<{ rows: StaffUserRow[]; total: number }> {
  const conditions: (SQL | undefined)[] = []
  if (options.status !== undefined) {
    conditions.push(eq(staffUsers.status, options.status))
  }
  if (options.search !== undefined && options.search.length > 0) {
    const like = `%${options.search.toLowerCase()}%`
    conditions.push(or(ilike(staffUsers.nameAr, like), ilike(staffUsers.nameEn, like)))
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const totalRows = await db.select({ value: count() }).from(staffUsers).where(where)
  const total = totalRows[0]?.value ?? 0

  const rows = await db
    .select()
    .from(staffUsers)
    .where(where)
    .orderBy(asc(staffUsers.nameAr))
    .limit(options.pageSize)
    .offset((options.page - 1) * options.pageSize)

  return { rows, total }
}

export async function getStaffUser(
  db: DbClient,
  staffId: string,
): Promise<StaffUserRow | undefined> {
  const rows = await db.select().from(staffUsers).where(eq(staffUsers.id, staffId)).limit(1)
  return rows[0]
}

export async function getStaffUserByPhone(
  db: DbClient,
  phoneNormalized: string,
): Promise<StaffUserRow | undefined> {
  const rows = await db
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.phoneNormalized, phoneNormalized))
    .limit(1)
  return rows[0]
}

export async function getStaffUserByEmail(
  db: DbClient,
  email: string,
): Promise<StaffUserRow | undefined> {
  const rows = await db.select().from(staffUsers).where(eq(staffUsers.email, email)).limit(1)
  return rows[0]
}

/**
 * Finds a staff member by a login identifier, which may be either a
 * normalized phone number or a case-insensitive email. Used by sign-in; the
 * caller verifies the password and status.
 */
export async function getStaffUserByIdentifier(
  db: DbClient,
  identifier: string,
): Promise<StaffUserRow | undefined> {
  const rows = await db
    .select()
    .from(staffUsers)
    .where(
      or(
        eq(sql`lower(${staffUsers.email})`, identifier.toLowerCase()),
        eq(staffUsers.phoneNormalized, identifier),
      ),
    )
    .limit(1)
  return rows[0]
}

export async function createStaffUser(
  db: DbClient,
  values: typeof staffUsers.$inferInsert,
): Promise<StaffUserRow> {
  const rows = await db.insert(staffUsers).values(values).returning()
  return rows[0] as StaffUserRow
}

export async function updateStaffUser(
  db: DbClient,
  staffId: string,
  values: Partial<typeof staffUsers.$inferInsert>,
): Promise<StaffUserRow | undefined> {
  const rows = await db
    .update(staffUsers)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(staffUsers.id, staffId))
    .returning()
  return rows[0]
}

// ---------------------------------------------------------------------------
// Roles and permissions
// ---------------------------------------------------------------------------

export async function listRoles(db: DbClient): Promise<RoleRow[]> {
  return db.select().from(roles).orderBy(asc(roles.nameAr))
}

export async function getRole(db: DbClient, roleId: string): Promise<RoleRow | undefined> {
  const rows = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1)
  return rows[0]
}

export async function getRoleByCode(db: DbClient, code: string): Promise<RoleRow | undefined> {
  const rows = await db.select().from(roles).where(eq(roles.code, code)).limit(1)
  return rows[0]
}

export async function createRole(
  db: DbClient,
  values: typeof roles.$inferInsert,
): Promise<RoleRow> {
  const rows = await db.insert(roles).values(values).returning()
  return rows[0] as RoleRow
}

export async function updateRole(
  db: DbClient,
  roleId: string,
  values: Partial<typeof roles.$inferInsert>,
): Promise<RoleRow | undefined> {
  const rows = await db
    .update(roles)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(roles.id, roleId))
    .returning()
  return rows[0]
}

export async function listPermissions(db: DbClient): Promise<PermissionRow[]> {
  return db.select().from(permissions).orderBy(asc(permissions.code))
}

export async function getPermission(
  db: DbClient,
  permissionId: string,
): Promise<PermissionRow | undefined> {
  const rows = await db.select().from(permissions).where(eq(permissions.id, permissionId)).limit(1)
  return rows[0]
}

export async function getPermissionByCode(
  db: DbClient,
  code: string,
): Promise<PermissionRow | undefined> {
  const rows = await db.select().from(permissions).where(eq(permissions.code, code)).limit(1)
  return rows[0]
}

export async function createPermission(
  db: DbClient,
  values: typeof permissions.$inferInsert,
): Promise<PermissionRow> {
  const rows = await db.insert(permissions).values(values).returning()
  return rows[0] as PermissionRow
}

export async function updatePermission(
  db: DbClient,
  permissionId: string,
  values: Partial<typeof permissions.$inferInsert>,
): Promise<PermissionRow | undefined> {
  const rows = await db
    .update(permissions)
    .set(values)
    .where(eq(permissions.id, permissionId))
    .returning()
  return rows[0]
}

export async function setStaffRoles(
  db: DbClient,
  staffId: string,
  roleIds: string[],
): Promise<void> {
  await db.delete(staffRoles).where(eq(staffRoles.staffId, staffId))
  if (roleIds.length > 0) {
    await db.insert(staffRoles).values(roleIds.map((roleId) => ({ staffId, roleId })))
  }
}

export async function setRolePermissions(
  db: DbClient,
  roleId: string,
  permissionIds: string[],
): Promise<void> {
  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId))
  if (permissionIds.length > 0) {
    await db
      .insert(rolePermissions)
      .values(permissionIds.map((permissionId) => ({ roleId, permissionId })))
  }
}

export async function getStaffRoleIds(db: DbClient, staffId: string): Promise<string[]> {
  const rows = await db
    .select({ roleId: staffRoles.roleId })
    .from(staffRoles)
    .where(eq(staffRoles.staffId, staffId))
  return rows.map((row) => row.roleId)
}

export async function getRolePermissionIds(db: DbClient, roleId: string): Promise<string[]> {
  const rows = await db
    .select({ permissionId: rolePermissions.permissionId })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId))
  return rows.map((row) => row.permissionId)
}

/** Effective (role-derived) permission codes for a staff member. */
export async function effectivePermissionCodes(db: DbClient, staffId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ code: permissions.code })
    .from(staffRoles)
    .innerJoin(roles, eq(staffRoles.roleId, roles.id))
    .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(staffRoles.staffId, staffId))
  return rows.map((row) => row.code)
}

export async function countStaffInRoles(
  db: DbClient,
  roleIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (roleIds.length === 0) return out
  const rows = await db
    .select({ roleId: staffRoles.roleId })
    .from(staffRoles)
    .where(inArray(staffRoles.roleId, roleIds))
  for (const row of rows) {
    out.set(row.roleId, (out.get(row.roleId) ?? 0) + 1)
  }
  return out
}
