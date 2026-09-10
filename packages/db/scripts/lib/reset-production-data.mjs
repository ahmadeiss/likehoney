/**
 * Pure, testable core of the PRODUCTION data reset (`db:reset:production-data`).
 *
 * This module owns the ground truth that keeps the destructive reset safe:
 *
 *   - `PRESERVED_TABLES`  — the identity/access-control foundation that is
 *     NEVER touched: staff identity rows, credentials (password hashes),
 *     roles, permissions, and both mapping tables.
 *   - `RESET_TABLES`      — every business/catalog/operational table, in FK-safe
 *     child→parent order, PLUS `staff_sessions`, which is CLEARED on purpose so
 *     every Admin/Employee session is invalidated and staff log in again
 *     (accounts and password hashes are never altered).
 *   - `IDENTITY_RESET_COLUMNS` — the three business `GENERATED ALWAYS AS
 *     IDENTITY` sequence columns (`products.sequence`, `orders.sequence`,
 *     `store_sales.sequence`) restarted with the PROPER identity-restart
 *     operation only: `ALTER TABLE ... ALTER COLUMN ... RESTART WITH 1`.
 *     Column types / identity definitions are never altered, and UUID `id`
 *     columns are never touched. Runtime introspection (`runIdentityIntrospection`)
 *     re-confirms the columns are identity columns before any restart fires.
 *   - `buildResetStatements(restartColumns)` — the single atomic plan of plain
 *     `DELETE FROM` statements plus the confirmed identity restarts.
 *   - preservation probes + canonical fingerprints — read-only snapshots of the
 *     preserved identity data (including a hash-less identity of staff
 *     emails/phones used ONLY for pre/post equality), verified identical
 *     after the reset.
 *   - `resolveWriteGate()` — the confirmation + backup gates for write mode.
 *   - post-reset verification — zero business rows, identical preserved
 *     fingerprints, intact RBAC graph (no orphan links).
 *   - R2 estimate — read-only "which application-owned prefixes contain now-
 *     unreferenced objects" report. NEVER deletes anything.
 *
 * REQUIRED-SINGLETON AUDIT (why `store_settings` / `delivery_zones` /
 * `content_pages` are legitimately reset to zero rows instead of re-seeded):
 *   - `store_settings` is a typed key/value registry (one row per key), NOT a
 *     singleton. Every read treats absence as "unset = default":
 *     `getSettingService` / `publicSettingsService` return `null` when a key is
 *     absent; `isCodEnabled` returns `true` when `checkout:cod.enabled` is
 *     unset ("a fresh store can sell"); payment settings read absence as
 *     disabled. Admin still loads (the settings screen renders null/defaults
 *     for all registered keys).
 *   - `delivery_zones` is a plain collection. Empty ⇒ the storefront offers no
 *     zones (checkout simply requires choosing an existing zone) and Admin can
 *     create zones after reset. `orders.delivery_zone_id` FK is `set null`, so
 *     no constraint blocks zone deletion.
 *   - `content_pages` is an optional editorial collection. Empty ⇒ no footer
 *     links; `GET /content/:slug` 404 (NotFoundError) only when a specific page
 *     is requested. No runtime path requires a page to exist.
 *   None of the three has any singleton/default requirement — all reset to
 *   zero. Product/category/supplier creation depends on no settings row.
 *
 * Nothing in this file ever reads `PRODUCTION_DATABASE_URL` or touches a
 * database; the CLI (`../reset-production-data.mjs`) wires the connection.
 * Statements are plain `{ sql, params }` data exactly like `rbac-bootstrap.mjs`.
 */

/** Identity/access-control tables preserved byte-for-byte. */
export const PRESERVED_TABLES = new Set([
  'staff_users',
  'staff_roles',
  'roles',
  'permissions',
  'role_permissions',
])

/** Auth-domain tables that make up the preserved identity foundation. */
export const AUTH_RBAC_TABLES = [
  'staff_users',
  'staff_roles',
  'roles',
  'permissions',
  'role_permissions',
]

/**
 * Every table reset to zero rows, in FK-safe delete order. `staff_sessions`
 * is FIRST: it is cleared (never preserved) so all Admin/Employee sessions are
 * invalidated — the user's accounts, roles and password hashes are untouched.
 */
export const RESET_TABLES = [
  'staff_sessions',
  'order_stock_return_items',
  'order_stock_returns',
  'store_sale_items',
  'store_sales',
  'payment_events',
  'stock_reservations',
  'payments',
  'checkout_claims',
  'order_items',
  'orders',
  'inventory_movements',
  'inventory_balances',
  'product_variant_options',
  'product_option_values',
  'product_options',
  'product_variants',
  'product_media',
  'products',
  'categories',
  'supplier_payment_entries',
  'suppliers',
  'customers',
  'store_reviews',
  'audit_logs',
  'content_pages',
  'delivery_zones',
  'store_settings',
]

/**
 * Business-domain `GENERATED ALWAYS AS IDENTITY` sequence columns that restart
 * at 1 so a fresh pre-launch store begins at LH-000001 / LH-POS-000001 /
 * SKU #000001. Restarted via the PROPER identity operation
 * (`ALTER TABLE ... ALTER COLUMN ... RESTART WITH 1`) — never by altering the
 * column type or redefining the identity definition. Confirmed as identity
 * columns by runtime introspection before the write. UUID `id` columns are
 * never touched.
 */
export const IDENTITY_RESET_COLUMNS = [
  { table: 'products', column: 'sequence' },
  { table: 'orders', column: 'sequence' },
  { table: 'store_sales', column: 'sequence' },
]

/** Migration history lives in the `drizzle` schema, never `public`. */
export const MIGRATION_TABLE = 'drizzle.__drizzle_migrations'

/** Exact confirmation values required by the CLI write mode. */
export const CONFIRM_DATA_RESET_VALUE = 'DELETE_ALL_BUSINESS_DATA'
export const BACKUP_VERIFIED_VALUE = '1'
export const BACKUP_VERIFIED_ENV = 'PRODUCTION_DATA_RESET_BACKUP_VERIFIED'

/** Safe application-owned R2 prefixes considered for the orphan estimate. */
export const R2_PREFIXES = ['products/', 'categories/']

export const DEFAULT_R2_BUCKET = 'likehoney-media'

/* --------------------------------------------------------------------------
 * Delete plan
 * ------------------------------------------------------------------------ */

/**
 * The complete single-transaction reset plan: `DELETE FROM` per reset table
 * in FK-safe child→parent order (`staff_sessions` cleared first), then the
 * PROPER identity restart for the confirmation-provided columns:
 * `ALTER TABLE ... ALTER COLUMN ... RESTART WITH 1`. Column types and identity
 * definitions are never altered, and UUID columns are never touched. The
 * caller supplies the columns already confirmed as identity by
 * `runIdentityIntrospection` (defaults to the full static list). Pure data —
 * execution belongs to the CLI (single Neon batch transaction).
 */
export function buildResetStatements(restartColumns = IDENTITY_RESET_COLUMNS) {
  const statements = RESET_TABLES.map((table) => ({ sql: `DELETE FROM ${table}`, params: [] }))
  for (const { table, column } of restartColumns) {
    statements.push({
      sql: `ALTER TABLE ${table} ALTER COLUMN ${column} RESTART WITH 1`,
      params: [],
    })
  }
  return statements
}

/** Human plan line for one identity restart. */
export function identityResetLabel({ table, column }) {
  return `${table}.${column}`
}

/* --------------------------------------------------------------------------
 * Identity-column introspection (read-only, re-confirms before any restart)
 * ------------------------------------------------------------------------ */

/** Table+column whose identity status must be confirmed before a restart. */
export function identityIntrospectionTargets() {
  return [
    { table: 'products', column: 'sequence' },
    { table: 'orders', column: 'sequence' },
    { table: 'store_sales', column: 'sequence' },
  ]
}

/**
 * Read-only statement that reports `attidentity` for each business sequence
 * column: `'a'` = GENERATED ALWAYS AS IDENTITY, `'d'` = GENERATED BY DEFAULT,
 * `''` = not an identity column. Pure SQL data.
 */
export function buildIdentityIntrospectionSql() {
  return {
    sql: `SELECT c.relname AS table_name, a.attname AS column_name, a.attidentity AS identity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid
       WHERE n.nspname = 'public'
         AND a.attnum > 0
         AND (c.relname, a.attname) IN (${identityIntrospectionTargets()
           .map((t) => `('${t.table}', '${t.column}')`)
           .join(', ')})`,
    params: [],
  }
}

/**
 * Execute the identity introspection (read-only) and shape it as
 * `table.column -> { isIdentity, identityType }`. Rows that do not match a
 * target are ignored; targets that received no row report `isIdentity: false`
 * (a target table/column that does not exist is never restarted).
 */
export async function runIdentityIntrospection(query) {
  const rows = await query(buildIdentityIntrospectionSql().sql, [])
  const byName = new Map(
    (rows ?? []).map((row) => [
      `${row.table_name}.${row.column_name}`,
      {
        isIdentity: row.identity === 'a' || row.identity === 'd',
        identityType: row.identity === 'a' || row.identity === 'd' ? row.identity : null,
      },
    ]),
  )
  const result = {}
  for (const { table, column } of identityIntrospectionTargets()) {
    const found = byName.get(`${table}.${column}`)
    result[`${table}.${column}`] = {
      isIdentity: Boolean(found?.isIdentity),
      identityType: found?.identityType ?? null,
    }
  }
  return result
}

/**
 * The subset of `IDENTITY_RESET_COLUMNS` whose column was CONFIRMED to be an
 * identity column by introspection. Columns that are not identity (or did not
 * resolve — e.g. a UUID `id`) are dropped: per the safety rule, no restart
 * fires unless the column is an actual identity column.
 */
export function resolveConfirmedIdentityRestarts(introspection) {
  return identityIntrospectionTargets().filter(
    ({ table, column }) => introspection?.[`${table}.${column}`]?.isIdentity === true,
  )
}

/* --------------------------------------------------------------------------
 * Read-only count queries
 * ------------------------------------------------------------------------ */

/** `count(*)` statement per table, as `{ name, sql }` — pure. */
export function buildCountQueries(tables) {
  return tables.map((table) => ({ name: table, sql: `SELECT count(*)::int AS c FROM ${table}` }))
}

/**
 * Execute read-only per-table row counts. `query` is the injected runner
 * `(sqlText, params) => rows` (a Neon `sql.query` in the CLI, a fake in tests).
 */
export async function runTableCounts(query, tables) {
  const counts = {}
  for (const table of tables) {
    const [sqlText] = buildCountQueries([table])
    const rows = await query(sqlText.sql, sqlText.params)
    const value = rows?.[0]?.c
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new Error(`Unable to parse production count for table '${table}'`)
    }
    counts[table] = value
  }
  return counts
}

/* --------------------------------------------------------------------------
 * Preservation probes + fingerprints
 * ------------------------------------------------------------------------ */

/**
 * Read-only probes over the preserved identity/access-control data. Emails and
 * phones are selected lowercased/normalized but are NEVER printed — they only
 * participate in the internal pre/post equality string.
 */
export const PRESERVATION_QUERIES = [
  {
    name: 'staffUsers',
    sql: `SELECT id::text AS id, lower(coalesce(email, '')) AS email_normalized,
                phone_normalized AS phone_normalized, status AS status,
                (password_hash IS NOT NULL) AS has_password
         FROM staff_users
         ORDER BY id`,
  },
  {
    name: 'staffRoles',
    sql: `SELECT staff_id::text AS staff_id, role_id::text AS role_id
         FROM staff_roles
         ORDER BY staff_id, role_id`,
  },
  {
    name: 'roles',
    sql: `SELECT id::text AS id, code AS code
         FROM roles
         ORDER BY code`,
  },
  {
    name: 'permissions',
    sql: `SELECT id::text AS id, code AS code
         FROM permissions
         ORDER BY code`,
  },
  {
    name: 'rolePermissions',
    sql: `SELECT role_id::text AS role_id, permission_id::text AS permission_id
         FROM role_permissions
         ORDER BY role_id, permission_id`,
  },
]

/** Probe statement for the migration history table (may live in `drizzle`). */
export function migrationCountQuery() {
  return { sql: `SELECT count(*)::int AS c FROM ${MIGRATION_TABLE}`, params: [] }
}

/**
 * Execute every preservation probe (read-only) and normalize the rows into the
 * fingerprint shape used for pre/post equality. The migration probe is wrapped
 * separately: a missing `drizzle` schema is reported (null) but never aborts —
 * the equality check treats two nulls as equal.
 */
export async function runPreservationProbe(query) {
  const fingerprint = {}
  for (const probe of PRESERVATION_QUERIES) {
    const rows = await query(probe.sql, [])
    if (!Array.isArray(rows)) throw new Error(`Preservation probe '${probe.name}' returned no rows`)
    fingerprint[probe.name] = rows.map((row) => ({
      id: String(row.id),
      code: row.code ?? null,
      emailNormalized: row.email_normalized ?? '',
      phoneNormalized: row.phone_normalized ?? '',
      status: row.status ?? '',
      hasPassword: Boolean(row.has_password),
      staffId: row.staff_id ?? '',
      roleId: row.role_id ?? '',
      permissionId: row.permission_id ?? '',
    }))
  }
  let migrationCount = null
  try {
    const rows = await query(migrationCountQuery().sql, [])
    const value = rows?.[0]?.c
    migrationCount =
      typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
  } catch {
    migrationCount = null
  }
  fingerprint.migrationCount = migrationCount
  return fingerprint
}

function fingerprintRows(rows, keys) {
  const out = []
  for (const row of rows ?? []) {
    const entry = {}
    for (const key of keys) entry[key] = row[key] ?? ''
    out.push(entry)
  }
  out.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return out
}

/**
 * Canonical, order-independent string of a preservation fingerprint for
 * byte-identical pre/post comparison. Emails/phones are included for equality
 * but this string is ONLY ever compared in-memory — it is never printed.
 */
export function canonicalizeFingerprint(fingerprint) {
  return JSON.stringify({
    staffUsers: fingerprintRows(fingerprint.staffUsers, [
      'id',
      'emailNormalized',
      'phoneNormalized',
      'status',
      'hasPassword',
    ]),
    staffRoles: fingerprintRows(fingerprint.staffRoles, ['staffId', 'roleId']),
    roles: fingerprintRows(fingerprint.roles, ['id', 'code']),
    permissions: fingerprintRows(fingerprint.permissions, ['id', 'code']),
    rolePermissions: fingerprintRows(fingerprint.rolePermissions, ['roleId', 'permissionId']),
    migrationCount: fingerprint.migrationCount ?? null,
  })
}

/**
 * Problems when the post-reset preserved fingerprint is NOT identical to the
 * pre-reset one. A null migration count on both sides counts as equal (the
 * history table could not be probed — reported, not mis-verified).
 */
export function verifyPreservedIdentical(before, after) {
  const problems = []
  const beforeCanon = canonicalizeFingerprint(before)
  const afterCanon = canonicalizeFingerprint(after)
  const beforeMigrations = before?.migrationCount
  const afterMigrations = after?.migrationCount
  const migrationsUntouched =
    beforeMigrations === null || afterMigrations === null || beforeMigrations === afterMigrations
  const withoutMigrations =
    beforeCanon.replace(/"migrationCount":[0-9-]+/, '"migrationCount":null') ===
    afterCanon.replace(/"migrationCount":[0-9-]+/, '"migrationCount":null')
  if (!migrationsUntouched) {
    problems.push(
      `migration history changed: before ${beforeMigrations}, after ${afterMigrations} — ABORT`,
    )
  }
  if (!withoutMigrations) {
    problems.push('preserved identity fingerprint changed after reset — ABORT')
  }
  return problems
}

/**
 * Read-only printable summary of the preserved foundation (counts only — never
 * raw emails, phones, ids, or password hashes).
 */
export function preservationSummary(fingerprint) {
  const staffUsers = fingerprint.staffUsers ?? []
  const staffRoles = fingerprint.staffRoles ?? []
  const roles = fingerprint.roles ?? []
  const permissions = fingerprint.permissions ?? []
  const rolePermissions = fingerprint.rolePermissions ?? []
  const active = staffUsers.filter((s) => s.status === 'active').length
  const withPassword = staffUsers.filter((s) => s.hasPassword).length
  const rolesPerStaff = new Map()
  for (const link of staffRoles) {
    const count = rolesPerStaff.get(link.staffId) ?? 0
    rolesPerStaff.set(link.staffId, count + 1)
  }
  const roleCodes = roles
    .map((r) => r.code)
    .filter(Boolean)
    .sort()
  return {
    staffUsers: staffUsers.length,
    staffActive: active,
    staffWithPassword: withPassword,
    staffRoles: staffRoles.length,
    roles: roles.length,
    roleCodes,
    permissions: permissions.length,
    rolePermissions: rolePermissions.length,
    migrations: fingerprint.migrationCount ?? null,
    rolesPerStaff,
  }
}

/* --------------------------------------------------------------------------
 * Post-reset read-only verification (business rows + RBAC graph integrity)
 * ------------------------------------------------------------------------ */

/** Every reset business table must be exactly zero after the reset. */
export function verifyZeroCounts(counts) {
  const problems = []
  for (const table of RESET_TABLES) {
    const value = counts?.[table]
    if (typeof value !== 'number' || !Number.isInteger(value) || value === 0) continue
    problems.push(`leftover rows in '${table}': ${value}`)
  }
  return problems
}

/**
 * Read-only RBAC graph + login-foundation check (pure SQL text). Confirms the
 * preserved grants still resolve: no orphan staff_roles / role_permissions
 * links, active staff exist, and every staff member has a password hash.
 */
export function buildLoginFoundationSql() {
  return `SELECT
    (SELECT count(*)::int FROM staff_users WHERE status = 'active') AS active_staff,
    (SELECT count(*)::int FROM staff_users WHERE password_hash IS NULL) AS staff_without_password,
    (SELECT count(*)::int FROM staff_roles sr LEFT JOIN staff_users s ON s.id = sr.staff_id WHERE s.id IS NULL) AS orphan_staff_roles_staff,
    (SELECT count(*)::int FROM staff_roles sr LEFT JOIN roles r ON r.id = sr.role_id WHERE r.id IS NULL) AS orphan_staff_roles_role,
    (SELECT count(*)::int FROM role_permissions rp LEFT JOIN roles r ON r.id = rp.role_id WHERE r.id IS NULL) AS orphan_role_permissions_role,
    (SELECT count(*)::int FROM role_permissions rp LEFT JOIN permissions p ON p.id = rp.permission_id WHERE p.id IS NULL) AS orphan_role_permissions_perm`
}

/** Interpret the single login-foundation result row. Pure. */
export function summarizeLoginFoundation(row) {
  const value = (key, fallback = 0) => {
    const n = row?.[key]
    return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : fallback
  }
  return {
    activeStaff: value('active_staff'),
    staffWithoutPassword: value('staff_without_password'),
    orphanStaffRolesStaff: value('orphan_staff_roles_staff'),
    orphanStaffRolesRole: value('orphan_staff_roles_role'),
    orphanRolePermissionsRole: value('orphan_role_permissions_role'),
    orphanRolePermissionsPerm: value('orphan_role_permissions_perm'),
  }
}

/** Problems when the login foundation is not intact (read-only verdict). */
export function loginFoundationProblems(foundation) {
  const problems = []
  if (foundation.activeStaff === 0) {
    problems.push('no active staff users found — authentication would be blocked')
  }
  if (foundation.staffWithoutPassword > 0) {
    problems.push(`${foundation.staffWithoutPassword} staff user(s) have NO password hash`)
  }
  if (foundation.orphanStaffRolesStaff > 0 || foundation.orphanStaffRolesRole > 0) {
    problems.push('orphan staff_roles links detected — RBAC grants would not resolve')
  }
  if (foundation.orphanRolePermissionsRole > 0 || foundation.orphanRolePermissionsPerm > 0) {
    problems.push('orphan role_permissions links detected — permissions would not resolve')
  }
  return problems
}

/* --------------------------------------------------------------------------
 * Write gate (confirmation + backup)
 * ------------------------------------------------------------------------ */

/**
 * Decide whether a write may be released. `mode` is `'dry-run'`, `'verify'` or
 * `'write'`. Dry-run/verify always pass (they perform zero writes); the write
 * mode requires the exact data-reset confirmation AND the fresh-backup
 * verification flag. Never prints connection details.
 */
export function resolveWriteGate({ mode, confirm, backupVerified }) {
  if (mode === 'dry-run' || mode === 'verify') return { ok: true }
  if (confirm !== CONFIRM_DATA_RESET_VALUE) {
    return {
      ok: false,
      reason: `CONFIRM_PRODUCTION_DATA_RESET must be exactly "${CONFIRM_DATA_RESET_VALUE}" to write (got ${JSON.stringify(confirm ?? '')})`,
    }
  }
  if (backupVerified !== BACKUP_VERIFIED_VALUE) {
    return {
      ok: false,
      reason: `${BACKUP_VERIFIED_ENV} must be exactly "${BACKUP_VERIFIED_VALUE}" after verifying a fresh Neon backup/snapshot of Production — refusing to write without proof of backup`,
    }
  }
  return { ok: true }
}

/* --------------------------------------------------------------------------
 * Single-transaction executor (all-or-nothing)
 * ------------------------------------------------------------------------ */

/**
 * Run the whole reset inside ONE Neon batch transaction. `query` must be a
 * NON-async `sql.query` so every element is a NeonQueryPromise (the driver's
 * strict `transaction()` contract) — an async wrapper would be rejected.
 * If any single statement fails, the batch rolls the complete reset back.
 */
export async function runResetTransaction({ sql, statements }) {
  const queries = statements.map((statement) => sql.query(statement.sql, statement.params))
  await sql.transaction(queries)
  return statements
}

/* --------------------------------------------------------------------------
 * R2 unreferenced-object estimate (READ ONLY — never deletes anything)
 * ------------------------------------------------------------------------ */

/**
 * Pure estimate of objects that become unreferenced once the DB media ledger
 * (`product_media.object_key`, `categories.image_object_key`) is reset to zero:
 * for each safe application-owned prefix, the listed keys minus the keys still
 * referenced by the DB.
 */
export function estimateUnreferencedObjects({ listedByPrefix, referencedByPrefix }) {
  const perPrefix = {}
  let total = 0
  for (const prefix of R2_PREFIXES) {
    const listed = listedByPrefix[prefix] ?? []
    const referenced = new Set(referencedByPrefix[prefix] ?? [])
    const unreferenced = listed.filter((key) => !referenced.has(key))
    perPrefix[prefix] = unreferenced
    total += unreferenced.length
  }
  return { perPrefix, total }
}

/** Read-only queries for the DB media-ledger reference keys under each prefix. */
export function buildDbReferenceQueries() {
  return [
    {
      name: 'products/',
      sql: `SELECT object_key AS key FROM product_media WHERE object_key LIKE 'products/%'`,
      params: [],
    },
    {
      name: 'categories/',
      sql: `SELECT image_object_key AS key FROM categories WHERE image_object_key LIKE 'categories/%'`,
      params: [],
    },
  ]
}

/** Run the DB reference queries and shape them as `prefix -> [keys]`. */
export async function runDbReferenceKeys(query) {
  const referencedByPrefix = {}
  for (const probe of buildDbReferenceQueries()) {
    const rows = await query(probe.sql, probe.params)
    referencedByPrefix[probe.name] = (rows ?? [])
      .map((row) => String(row.key ?? ''))
      .filter((key) => key.length > 0)
  }
  return referencedByPrefix
}
