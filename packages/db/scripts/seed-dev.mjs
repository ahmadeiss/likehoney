/**
 * DEVELOPMENT-ONLY fixture bootstrap: RBAC identities.
 *
 * This seeds the permission/role/staff rows required for the Phase 3B
 * `requirePermission` middleware to resolve identities during local
 * development on the Development Neon branch. It refuses to run against any
 * unverified target, never prints the connection secret, and is idempotent
 * (ON CONFLICT DO NOTHING).
 *
 * Every fixture is clearly synthetic; nothing here represents a real customer
 * or a real person. Staff/role/permission labels are bilingual (Arabic-first,
 * English follows) while codes stay technical ASCII (Type D).
 *
 * Usage: pnpm --filter @likehoney/db db:seed:dev
 */
import fs from 'node:fs'
import { neon } from '@neondatabase/serverless'

import {
  ADMIN_ROLE_PERMISSIONS,
  EMPLOYEE_DEFAULT_PERMISSIONS,
  PERMISSION_LABELS,
} from './rbac-defaults.mjs'

const envPath = new URL('../.env', import.meta.url)
const m = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)
if (!m) {
  throw new Error('DATABASE_URL missing from packages/db/.env — refusing to seed')
}
const url = m[1].trim()
if (!/^postgres(ql)?:\/\/.+@.+\.neon\.tech\/likehoneydb/.test(url)) {
  throw new Error('Target does not match the expected Development Neon branch — refusing to seed')
}

const sql = neon(url)
const q = (v) => `'${String(v).replace(/'/g, "''")}'`
const run = async (stmt) => {
  // unsafe() interpolates raw SQL into the tagged template (it does not
  // execute standalone), so it is embedded here and the template is awaited.
  return await sql`${sql.unsafe(stmt)}`
}

// Permissions + built-in role sets come from the canonical ./rbac-defaults.mjs
// (shared with bootstrap-admin.mjs) — no duplicated arrays.
const PERMISSIONS = Object.entries(PERMISSION_LABELS).map(([code, [ar, en]]) => [code, ar, en])
const ROLES = [
  // Dev "owner" identity — mirrors the production `admin` role's grant set.
  ['catalog-admin', 'مدير الكتالوج', 'Catalog admin', ADMIN_ROLE_PERMISSIONS],
  // Dev "employee" identity — the canonical default employee permission set.
  ['inventory-viewer', 'متابع المخزون', 'Inventory viewer', EMPLOYEE_DEFAULT_PERMISSIONS],
]
const STAFF = [
  [
    '00000000-0000-4000-8000-000000000001',
    'مدير المتجر',
    'Store Manager',
    '+970599111111',
    'admin@dev.local',
    'catalog-admin',
  ],
  [
    '00000000-0000-4000-8000-000000000002',
    'موظف المخزون',
    'Inventory Clerk',
    '+970599222222',
    'inventory@dev.local',
    'inventory-viewer',
  ],
]

await run(
  `INSERT INTO permissions (code, name_ar, name_en) VALUES
    ${PERMISSIONS.map((p) => `(${q(p[0])}, ${q(p[1])}, ${q(p[2])})`).join(',\n    ')}
   ON CONFLICT (code) DO NOTHING`,
)
console.log(`seeded ${PERMISSIONS.length} permissions`)

await run(
  `INSERT INTO roles (code, name_ar, name_en) VALUES
    ${ROLES.map((r) => `(${q(r[0])}, ${q(r[1])}, ${q(r[2])})`).join(',\n    ')}
   ON CONFLICT (code) DO NOTHING`,
)

let roleLinks = 0
for (const role of ROLES) {
  const whereCodes = role[3].map(q).join(', ')
  await run(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT r.id, p.id FROM roles r, permissions p
     WHERE r.code = ${q(role[0])} AND p.code IN (${whereCodes})
     ON CONFLICT DO NOTHING`,
  )
  roleLinks += role[3].length
}
console.log(`seeded ${ROLES.length} roles + ${roleLinks} role→permission links`)

for (const [id, nameAr, nameEn, phone, email, roleCode] of STAFF) {
  await run(
    `INSERT INTO staff_users (id, name_ar, name_en, phone_normalized, email)
     VALUES (${q(id)}, ${q(nameAr)}, ${q(nameEn)}, ${q(phone)}, ${q(email)})
     ON CONFLICT (id) DO NOTHING`,
  )
  await run(
    `INSERT INTO staff_roles (staff_id, role_id)
     SELECT s.id, r.id FROM staff_users s, roles r
     WHERE s.id = ${q(id)} AND r.code = ${q(roleCode)}
     ON CONFLICT DO NOTHING`,
  )
}
console.log(`seeded ${STAFF.length} synthetic staff users + role links`)

const summary = await run(`SELECT
  (SELECT count(*) FROM permissions)     AS permissions,
  (SELECT count(*) FROM roles)           AS roles,
  (SELECT count(*) FROM role_permissions) AS role_links,
  (SELECT count(*) FROM staff_users)     AS staff,
  (SELECT count(*) FROM staff_roles)     AS staff_links`)
console.log('result:', JSON.stringify(summary[0]))
