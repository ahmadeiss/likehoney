/**
 * Staff + RBAC service. Models identity and role/permission assignments only —
 * V1 has no authentication (a separately approved phase). Permission codes
 * must come from the approved `PERMISSION_CODES` set so guards and grants can
 * never drift apart.
 */
import {
  ConflictError,
  isPermissionCode,
  normalizePhone,
  NotFoundError,
  ValidationError,
  type PermissionCreateInput,
  type PermissionUpdateInput,
  type RoleCreateInput,
  type RoleUpdateInput,
  type StaffCreateInput,
  type StaffListQuery,
  type StaffUpdateInput,
} from '@likehoney/shared'
import {
  createPermission,
  createRole,
  createStaffUser,
  getPermission,
  getPermissionByCode,
  getRole,
  getRoleByCode,
  getRolePermissionIds,
  getStaffRoleIds,
  getStaffUser,
  getStaffUserByEmail,
  getStaffUserByPhone,
  listPermissions,
  listRoles,
  listStaffUsers,
  revokeAllStaffSessions,
  setRolePermissions,
  setStaffRoles,
  updatePermission,
  updateRole,
  updateStaffUser,
  type DbClient,
  type StaffUserRow,
} from '@likehoney/db'

import { recordAudit, type AuditActor } from './audit'

/**
 * Safe projection of a staff row for API responses. Whitelists only the fields
 * in the client `StaffDoc` contract — the password hash never leaves the
 * server. The signed-in `/auth/me` payload uses its own separate whitelist.
 */
function staffDoc(staff: StaffUserRow) {
  return {
    id: staff.id,
    nameAr: staff.nameAr,
    nameEn: staff.nameEn,
    phoneNormalized: staff.phoneNormalized,
    email: staff.email,
    notes: staff.notes,
    status: staff.status,
    createdAt: staff.createdAt,
    updatedAt: staff.updatedAt,
  }
}

export async function listStaffService(db: DbClient, query: StaffListQuery) {
  const { rows, total } = await listStaffUsers(db, query)
  return { data: rows.map(staffDoc), meta: { page: query.page, pageSize: query.pageSize, total } }
}

export async function getStaffService(db: DbClient, staffId: string) {
  const staff = await getStaffUser(db, staffId)
  if (staff === undefined) throw new NotFoundError('staff member not found')
  const roleIds = await getStaffRoleIds(db, staffId)
  return { ...staffDoc(staff), roleIds }
}

export async function createStaffService(db: DbClient, input: StaffCreateInput, actor: AuditActor) {
  const phone = normalizePhone(input.phoneNormalized)
  const byPhone = await getStaffUserByPhone(db, phone)
  if (byPhone !== undefined) {
    throw new ConflictError('a staff member with this phone already exists')
  }
  if (input.email !== undefined) {
    const email = await getStaffUserByEmail(db, input.email)
    if (email !== undefined) {
      throw new ConflictError('a staff member with this email already exists')
    }
  }

  const staff = await createStaffUser(db, {
    nameAr: input.nameAr,
    nameEn: input.nameEn ?? null,
    phoneNormalized: phone,
    email: input.email ?? null,
    notes: input.notes ?? null,
  })
  await recordAudit(db, actor, 'staff.created', 'staff', staff.id)
  return staffDoc(staff)
}

export async function updateStaffService(
  db: DbClient,
  staffId: string,
  input: StaffUpdateInput,
  actor: AuditActor,
) {
  const existing = await getStaffUser(db, staffId)
  if (existing === undefined) throw new NotFoundError('staff member not found')

  const phone =
    input.phoneNormalized !== undefined ? normalizePhone(input.phoneNormalized) : undefined
  if (phone !== undefined && phone !== existing.phoneNormalized) {
    const byPhone = await getStaffUserByPhone(db, phone)
    if (byPhone !== undefined) {
      throw new ConflictError('a staff member with this phone already exists')
    }
  }
  if (input.email !== undefined && input.email !== null && input.email !== existing.email) {
    const email = await getStaffUserByEmail(db, input.email)
    if (email !== undefined) {
      throw new ConflictError('a staff member with this email already exists')
    }
  }

  const staff = await updateStaffUser(db, staffId, {
    nameAr: input.nameAr,
    nameEn: input.nameEn,
    phoneNormalized: phone,
    email: input.email,
    notes: input.notes,
    status: input.status,
  })
  if (staff === undefined) throw new NotFoundError('staff member not found')

  // Disabling an account immediately revokes every active session.
  if (input.status === 'inactive') {
    await revokeAllStaffSessions(db, staffId)
  }

  await recordAudit(db, actor, 'staff.updated', 'staff', staff.id)
  return staffDoc(staff)
}

export async function listRolesService(db: DbClient) {
  const roles = await listRoles(db)
  return Promise.all(
    roles.map(async (role) => ({
      ...role,
      permissionIds: await getRolePermissionIds(db, role.id),
    })),
  )
}

export async function createRoleService(db: DbClient, input: RoleCreateInput, actor: AuditActor) {
  const existing = await getRoleByCode(db, input.code)
  if (existing !== undefined) {
    throw new ConflictError('role code is already in use', { code: input.code })
  }
  const role = await createRole(db, {
    code: input.code,
    nameAr: input.nameAr,
    nameEn: input.nameEn ?? null,
    descriptionAr: input.descriptionAr ?? null,
    descriptionEn: input.descriptionEn ?? null,
  })
  await recordAudit(db, actor, 'role.created', 'role', role.id)
  return role
}

export async function updateRoleService(
  db: DbClient,
  roleId: string,
  input: RoleUpdateInput,
  actor: AuditActor,
) {
  const existing = await getRole(db, roleId)
  if (existing === undefined) throw new NotFoundError('role not found')
  const role = await updateRole(db, roleId, {
    nameAr: input.nameAr,
    nameEn: input.nameEn,
    descriptionAr: input.descriptionAr,
    descriptionEn: input.descriptionEn,
  })
  if (role === undefined) throw new NotFoundError('role not found')
  await recordAudit(db, actor, 'role.updated', 'role', role.id)
  return role
}

export async function listPermissionsService(db: DbClient) {
  return listPermissions(db)
}

export async function createPermissionService(
  db: DbClient,
  input: PermissionCreateInput,
  actor: AuditActor,
) {
  if (!isPermissionCode(input.code)) {
    throw new ValidationError('permission code is not in the approved PERMISSION_CODES set', {
      code: input.code,
    })
  }
  const existing = await getPermissionByCode(db, input.code)
  if (existing !== undefined) {
    throw new ConflictError('permission code is already in use', { code: input.code })
  }
  const permission = await createPermission(db, {
    code: input.code,
    nameAr: input.nameAr,
    nameEn: input.nameEn ?? null,
    descriptionAr: input.descriptionAr ?? null,
    descriptionEn: input.descriptionEn ?? null,
  })
  await recordAudit(db, actor, 'permission.created', 'permission', permission.id)
  return permission
}

export async function updatePermissionService(
  db: DbClient,
  permissionId: string,
  input: PermissionUpdateInput,
  actor: AuditActor,
) {
  const existing = await getPermission(db, permissionId)
  if (existing === undefined) throw new NotFoundError('permission not found')
  const permission = await updatePermission(db, permissionId, {
    nameAr: input.nameAr,
    nameEn: input.nameEn,
    descriptionAr: input.descriptionAr,
    descriptionEn: input.descriptionEn,
  })
  if (permission === undefined) throw new NotFoundError('permission not found')
  await recordAudit(db, actor, 'permission.updated', 'permission', permission.id)
  return permission
}

export async function setStaffRolesService(
  db: DbClient,
  staffId: string,
  roleIds: string[],
  actor: AuditActor,
) {
  const staff = await getStaffUser(db, staffId)
  if (staff === undefined) throw new NotFoundError('staff member not found')
  await validateRoleIds(db, roleIds)
  await setStaffRoles(db, staffId, roleIds)
  await recordAudit(
    db,
    actor,
    'staff.roles.assigned',
    'staff',
    staffId,
    JSON.stringify({ roleIds }),
  )
  return { roleIds }
}

export async function setRolePermissionsService(
  db: DbClient,
  roleId: string,
  permissionIds: string[],
  actor: AuditActor,
) {
  const role = await getRole(db, roleId)
  if (role === undefined) throw new NotFoundError('role not found')
  await validatePermissionIds(db, permissionIds)
  await setRolePermissions(db, roleId, permissionIds)
  await recordAudit(
    db,
    actor,
    'role.permissions.assigned',
    'role',
    roleId,
    JSON.stringify({ permissionIds }),
  )
  return { permissionIds }
}

async function validateRoleIds(db: DbClient, roleIds: string[]) {
  for (const roleId of roleIds) {
    const role = await getRole(db, roleId)
    if (role === undefined) throw new NotFoundError('role not found', { roleId })
  }
}

async function validatePermissionIds(db: DbClient, permissionIds: string[]) {
  for (const permissionId of permissionIds) {
    const permission = await getPermission(db, permissionId)
    if (permission === undefined) throw new NotFoundError('permission not found', { permissionId })
  }
}
