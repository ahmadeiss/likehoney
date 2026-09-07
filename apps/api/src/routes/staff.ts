import { Hono } from 'hono'
import {
  assignPermissionIdsSchema,
  assignRoleIdsSchema,
  permissionCreateSchema,
  permissionUuidParamSchema,
  permissionUpdateSchema,
  roleCreateSchema,
  roleUuidParamSchema,
  roleUpdateSchema,
  staffCreateSchema,
  staffListQuerySchema,
  staffSetPasswordSchema,
  staffUpdateSchema,
  uuidParamSchema,
} from '@likehoney/shared'

import { listStaffUsers } from '@likehoney/db'

import type { AppEnv } from '../env'
import { requirePermission, currentStaffId } from '../http/auth'
import { parseBody, parseParams, parseQuery } from '../http/request'
import { setStaffPassword } from '../services/auth'
import { getDatabase } from '../services/db'
import {
  createPermissionService,
  createRoleService,
  createStaffService,
  getStaffService,
  listPermissionsService,
  listRolesService,
  listStaffService,
  setRolePermissionsService,
  setStaffRolesService,
  updatePermissionService,
  updateRoleService,
  updateStaffService,
} from '../services/staff'
import { auditActor, recordAudit } from '../services/audit'

export const staffRouter = new Hono<AppEnv>()

// ---------------------------------------------------------------------------
// Development identity bootstrap (DEV-ONLY)
//
// The admin "switch identity" picker lists real staff so the developer can
// select a valid `X-Staff-Id` on first use â€” before any identity has been
// chosen. Normal staff listing requires `staff:write`, which is circular for
// a bootstrap, so this endpoint returns ONLY the minimal, non-secret identity
// options (id + display names) for active staff.
//
// It is gated twice:
//   1. AUTHORITATIVE: `APP_ENV` must be exactly `development`. The marker is set
//      only in the git-ignored local `.dev.vars`. Production deploys never set
//      it, so the route returns 404 there (fail-closed). It is never authorized
//      on the protected `/staff` RBAC routes and does not weaken them.
//   2. DEFENSE-IN-DEPTH: the request must come from a loopback host, so even a
//      mismatched local deploy cannot expose staff options over a network.
// 404 (not 401/403) is returned so the development-only route is not advertised
// in non-development.
// ---------------------------------------------------------------------------
const DEV_APP_ENV = 'development'

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

staffRouter.get('/dev-options', async (c) => {
  if (c.env.APP_ENV !== DEV_APP_ENV) return c.notFound()
  const host = new URL(c.req.url).hostname
  if (!isLoopbackHost(host)) return c.notFound()

  const { rows } = await listStaffUsers(getDatabase(c.env), {
    status: 'active',
    page: 1,
    pageSize: 100,
  })
  return c.json({
    data: rows.map((staff) => ({ id: staff.id, nameAr: staff.nameAr, nameEn: staff.nameEn })),
  })
})

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
//
// IMPORTANT: static / specific routes (list, roles, permissions, …) must be
// registered BEFORE the parameterized `/:id` routes. Hono matches in
// registration order, so a dynamic route like `GET /:id` would otherwise
// capture `GET /roles` / `GET /permissions` (treating them as staff ids) and
// fail UUID validation.

staffRouter.get('/', requirePermission('staff:write'), async (c) => {
  const query = parseQuery(c, staffListQuerySchema)
  return c.json(await listStaffService(getDatabase(c.env), query))
})

staffRouter.post('/', requirePermission('staff:write'), async (c) => {
  const input = await parseBody(c, staffCreateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const staff = await createStaffService(db, input, actor)
  return c.json(staff, 201)
})

// ---------------------------------------------------------------------------
// Roles (static — registered before /:id)
// ---------------------------------------------------------------------------

staffRouter.get('/roles', requirePermission('staff:write'), async (c) => {
  return c.json(await listRolesService(getDatabase(c.env)))
})

staffRouter.post('/roles', requirePermission('staff:write'), async (c) => {
  const input = await parseBody(c, roleCreateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const role = await createRoleService(db, input, actor)
  return c.json(role, 201)
})

staffRouter.patch('/roles/:roleId', requirePermission('staff:write'), async (c) => {
  const { roleId } = parseParams(c, roleUuidParamSchema)
  const input = await parseBody(c, roleUpdateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const role = await updateRoleService(db, roleId, input, actor)
  return c.json(role)
})

staffRouter.put('/roles/:roleId/permissions', requirePermission('staff:write'), async (c) => {
  const { roleId } = parseParams(c, roleUuidParamSchema)
  const input = await parseBody(c, assignPermissionIdsSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const result = await setRolePermissionsService(db, roleId, input.permissionIds, actor)
  return c.json(result)
})

// ---------------------------------------------------------------------------
// Permissions (static — registered before /:id)
// ---------------------------------------------------------------------------

staffRouter.get('/permissions', requirePermission('staff:write'), async (c) => {
  return c.json(await listPermissionsService(getDatabase(c.env)))
})

staffRouter.post('/permissions', requirePermission('staff:write'), async (c) => {
  const input = await parseBody(c, permissionCreateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const permission = await createPermissionService(db, input, actor)
  return c.json(permission, 201)
})

staffRouter.patch('/permissions/:permissionId', requirePermission('staff:write'), async (c) => {
  const { permissionId } = parseParams(c, permissionUuidParamSchema)
  const input = await parseBody(c, permissionUpdateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const permission = await updatePermissionService(db, permissionId, input, actor)
  return c.json(permission)
})

// ---------------------------------------------------------------------------
// Staff by id (parameterized — registered last)
// ---------------------------------------------------------------------------

staffRouter.get('/:id', requirePermission('staff:write'), async (c) => {
  const { id } = parseParams(c, uuidParamSchema)
  return c.json(await getStaffService(getDatabase(c.env), id))
})

staffRouter.patch('/:id', requirePermission('staff:write'), async (c) => {
  const { id } = parseParams(c, uuidParamSchema)
  const input = await parseBody(c, staffUpdateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const staff = await updateStaffService(db, id, input, actor)
  return c.json(staff)
})

staffRouter.put('/:id/roles', requirePermission('staff:write'), async (c) => {
  const { id } = parseParams(c, uuidParamSchema)
  const input = await parseBody(c, assignRoleIdsSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const result = await setStaffRolesService(db, id, input.roleIds, actor)
  return c.json(result)
})

/** Admin sets/resets a staff member's password. Revokes all their sessions. */
staffRouter.put('/:id/password', requirePermission('staff:write'), async (c) => {
  const { id } = parseParams(c, uuidParamSchema)
  const input = await parseBody(c, staffSetPasswordSchema)
  const db = getDatabase(c.env)
  await setStaffPassword(db, id, input.password, true)
  await recordAudit(db, auditActor(await currentStaffId(c)), 'staff.password.reset', 'staff', id)
  return c.json({ ok: true })
})
