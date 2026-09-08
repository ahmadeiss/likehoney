/**
 * Canonical RBAC bootstrap data + SQL builders (production).
 *
 * ONE source of truth for the production bootstrap, derived from
 * `./rbac-defaults.mjs` (`ADMIN_ROLE_PERMISSIONS` / `PERMISSION_LABELS`), whose
 * codes MUST equal `PERMISSION_CODES` in `@likehoney/shared`.
 *
 * Production policy (matches `bootstrap-admin.mjs` and `rbac-defaults.mjs`):
 *   - bootstrap ONLY the built-in `admin` role, granted every canonical
 *     permission — idempotently, reusing existing rows.
 *   - employee roles are NOT created here; an Admin provisions them via staff
 *     management (`EMPLOYEE_DEFAULT_PERMISSIONS` is the documented default set).
 *   - no staff users, no fixtures, no deletions — ever.
 *
 * The statement builders are pure (no db connection) so the exact SQL can be
 * unit-tested without touching a database.
 */
import { ADMIN_ROLE_PERMISSIONS, PERMISSION_LABELS } from '../rbac-defaults.mjs'

export const ADMIN_ROLE_CODE = 'admin'
export const ADMIN_ROLE_NAME_AR = 'مدير'
export const ADMIN_ROLE_NAME_EN = 'Admin'
export const ADMIN_ROLE_DESCRIPTION_AR = 'مدير النظام الكامل'
export const ADMIN_ROLE_DESCRIPTION_EN = 'Full system administrator'

/** Ordered canonical permission codes (owner/admin tier). */
export function canonicalPermissionCodes() {
  return [...ADMIN_ROLE_PERMISSIONS]
}

/** Throws unless the canonical list is duplicates-free and fully labelled. */
export function validateCanonicalIntegrity() {
  const codes = canonicalPermissionCodes()
  const seen = new Set()
  for (const code of codes) {
    if (seen.has(code)) throw new Error(`Duplicate canonical permission code: '${code}'`)
    seen.add(code)
    const labels = PERMISSION_LABELS[code]
    if (!labels || labels.length !== 2 || !labels[0] || !labels[1]) {
      throw new Error(`Missing bilingual labels for permission code '${code}'`)
    }
  }
  if (codes.length === 0) throw new Error('Canonical permission list is empty')
}

/**
 * The three idempotent bootstrap statements as `{ sql, params }` (plain data,
 * no db). Insert-only + `ON CONFLICT DO NOTHING`: existing rows are reused,
 * nothing is ever updated, deleted, or dropped, and reruns insert zero rows.
 */
export function rbacBootstrapStatements() {
  validateCanonicalIntegrity()
  const codes = canonicalPermissionCodes()

  // 1) Permissions — one INSERT with parameterized tuples.
  const permissionParams = []
  let permissionsSql = 'INSERT INTO permissions (code, name_ar, name_en) VALUES\n'
  codes.forEach((code, i) => {
    const [nameAr, nameEn] = PERMISSION_LABELS[code]
    if (i > 0) permissionsSql += ',\n'
    permissionsSql += `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`
    permissionParams.push(code, nameAr, nameEn)
  })
  permissionsSql += '\nON CONFLICT (code) DO NOTHING'

  // 2) Admin role — insert only if the canonical code is absent.
  const roleSql = `INSERT INTO roles (code, name_ar, name_en, description_ar, description_en)\nVALUES ($1, $2, $3, $4, $5)\nON CONFLICT (code) DO NOTHING`
  const roleParams = [
    ADMIN_ROLE_CODE,
    ADMIN_ROLE_NAME_AR,
    ADMIN_ROLE_NAME_EN,
    ADMIN_ROLE_DESCRIPTION_AR,
    ADMIN_ROLE_DESCRIPTION_EN,
  ]

  // 3) Admin → permissions links (idempotent, additive only).
  const inClause = codes.map((_, i) => `$${i + 1}`).join(', ')
  const rolePermissionsSql = `INSERT INTO role_permissions (role_id, permission_id)\nSELECT r.id, p.id\nFROM roles r, permissions p\nWHERE r.code = $${codes.length + 1}\n  AND p.code IN (${inClause})\nON CONFLICT DO NOTHING`
  const rolePermissionsParams = [...codes, ADMIN_ROLE_CODE]

  return [
    { sql: permissionsSql, params: permissionParams },
    { sql: roleSql, params: roleParams },
    { sql: rolePermissionsSql, params: rolePermissionsParams },
  ]
}

/**
 * Builds `$1..$n` placeholder slots and the bound params from ONE array, so the
 * SQL placeholder count can never diverge from the bind-parameter count. The
 * order of `slots` matches the order of `params` 1:1.
 */
function placeholderSlots(values) {
  return {
    slots: values.map((_, i) => `$${i + 1}`),
    params: values,
  }
}

/**
 * Read-only verification queries as `{ name, sql, params }`. Do NOT execute
 * against production here — callers decide.
 *
 * Every query derives its `$n` placeholders AND its bind params from the same
 * array, so a placeholder/bind mismatch of the kind that previously made
 * `adminPermissions` supply 18 params to 17 placeholders is structurally
 * impossible here.
 */
export function rbacVerificationQueries() {
  const codes = canonicalPermissionCodes()
  const adminRolePresent = placeholderSlots([ADMIN_ROLE_CODE])
  // Admin role code FIRST (`$1`), then every canonical code (`$2..$N+1`).
  const adminPermissions = placeholderSlots([ADMIN_ROLE_CODE, ...codes])
  const permissionsPresent = placeholderSlots(codes)

  return [
    {
      name: 'permissionsPresent',
      sql: `SELECT count(*)::int AS n FROM permissions WHERE code IN (${permissionsPresent.slots.join(', ')})`,
      params: permissionsPresent.params,
    },
    {
      name: 'adminRolePresent',
      sql: `SELECT count(*)::int AS n FROM roles WHERE code = ${adminRolePresent.slots[0]}`,
      params: adminRolePresent.params,
    },
    {
      name: 'adminPermissions',
      sql: `SELECT count(*)::int AS n FROM role_permissions rp\nJOIN roles r ON r.id = rp.role_id\nWHERE r.code = ${adminPermissions.slots[0]}\n  AND rp.permission_id IN (SELECT id FROM permissions WHERE code IN (${adminPermissions.slots.slice(1).join(', ')}))`,
      params: adminPermissions.params,
    },
  ]
}

/** All tables the bootstrap and verification touch — used by the safety tests. */
export const RBAC_BOOTSTRAP_TABLES = new Set(['permissions', 'roles', 'role_permissions'])

export const RBAC_FORBIDDEN_TABLES = new Set(['staff_users', 'staff_roles'])
