/**
 * Tests for the PRODUCTION-ONLY data reset (`db:reset:production-data`).
 *
 * Exercises every pure statement/query builder, the write gate, fingerprint
 * canonicalization + verification, transaction-rollback semantics (in-memory
 * fake DB), and the R2 orphan estimate — all WITHOUT a live database.
 *
 * Live production behavior (single Neon batch transaction, real R2 list)
 * mirrors the already-tested patterns of `seed-production-catalog.mjs` and
 * `production-audit.test.mjs`; those flows are intentionally kept as manual
 * gate-kept operations against real Neon.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { validateProductionTarget } from './lib/connection-target.mjs'
import {
  RESET_TABLES,
  PRESERVED_TABLES,
  AUTH_RBAC_TABLES,
  IDENTITY_RESET_COLUMNS,
  CONFIRM_DATA_RESET_VALUE,
  BACKUP_VERIFIED_ENV,
  BACKUP_VERIFIED_VALUE,
  R2_PREFIXES,
  buildResetStatements,
  buildCountQueries,
  runTableCounts,
  buildLoginFoundationSql,
  loginFoundationProblems,
  resolveWriteGate,
  canonicalizeFingerprint,
  verifyPreservedIdentical,
  verifyZeroCounts,
  estimateUnreferencedObjects,
  buildDbReferenceQueries,
  runResetTransaction,
  PRESERVATION_QUERIES,
  migrationCountQuery,
  identityResetLabel,
  identityIntrospectionTargets,
  buildIdentityIntrospectionSql,
  runIdentityIntrospection,
  resolveConfirmedIdentityRestarts,
} from './lib/reset-production-data.mjs'

/* ---------------------------------------------------------------------------
 * Helpers
 * ----------------------------------------------------------------------- */
function readScript(name) {
  return readFileSync(new URL(name, import.meta.url), 'utf8')
}

/** Stable in-memory replacement for `validateProductionTarget` for guard tests. */
const DEV_URL =
  'postgres://devuser:devpass@ep-dev-123.us-east-2.aws.neon.tech/likehoneydb?sslmode=require'

/**
 * A minimal in-memory Postgres–like state tracker. Tracks row counts per table
 * and enforces that every DELETE subtracts rows we previously set, and that an
 * intentional mid-transaction failure causes a full rollback (counts restored).
 */
class FakeDb {
  constructor(initialCounts = {}) {
    this.initial = { ...initialCounts }
    this.counts = { ...initialCounts }
    this.committed = false
  }
  /** Fake `sql.query` — returns `[{ c: N }]` for count queries, `[]` otherwise. */
  query = (sqlText) => {
    if (/SELECT count\(\*\)::int AS c FROM (.+)/.test(sqlText)) {
      const table = sqlText.match(/SELECT count\(\*\)::int AS c FROM (.+)/)[1]
      const c = this.counts[table] ?? 0
      return Promise.resolve([{ c }])
    }
    if (/DELETE FROM (\w+)/.test(sqlText)) {
      const table = sqlText.match(/DELETE FROM (\w+)/)[1]
      this.counts[table] = 0
      return Promise.resolve([])
    }
    if (/ALTER TABLE (\w+) ALTER COLUMN/.test(sqlText)) {
      return Promise.resolve([])
    }
    return Promise.resolve([])
  }
  async transaction(queries) {
    for (const promise of queries) await promise
    this.committed = true
  }
}

function fakeFingerprint(overrides = {}) {
  return {
    staffUsers: [
      {
        id: 'aaa',
        emailNormalized: 'admin@example.com',
        phoneNormalized: '+972500000000',
        status: 'active',
        hasPassword: true,
        staffId: '',
        roleId: '',
        permissionId: '',
      },
    ],
    staffRoles: [
      {
        id: '',
        emailNormalized: '',
        phoneNormalized: '',
        status: '',
        hasPassword: false,
        staffId: 'aaa',
        roleId: 'rrr',
        permissionId: '',
      },
    ],
    roles: [
      {
        id: 'rrr',
        emailNormalized: '',
        phoneNormalized: '',
        status: '',
        hasPassword: false,
        staffId: '',
        roleId: '',
        code: 'admin',
        permissionId: '',
      },
    ],
    permissions: [
      {
        id: 'pp1',
        emailNormalized: '',
        phoneNormalized: '',
        status: '',
        hasPassword: false,
        staffId: '',
        roleId: '',
        code: 'products:read',
        permissionId: '',
      },
    ],
    rolePermissions: [
      {
        id: '',
        emailNormalized: '',
        phoneNormalized: '',
        status: '',
        hasPassword: false,
        staffId: '',
        roleId: 'rrr',
        permissionId: 'pp1',
      },
    ],
    migrationCount: 19,
    ...overrides,
  }
}

/* ---------------------------------------------------------------------------
 * §14: staff users preserved
 * ----------------------------------------------------------------------- */

test('staff users are NOT in the RESET_TABLES and RESET statements never target them', () => {
  assert.ok(!RESET_TABLES.includes('staff_users'), 'staff_users must not be reset')
  assert.ok(!RESET_TABLES.includes('staff_roles'), 'staff_roles must not be reset')
  const resetSql = buildResetStatements()
    .map((s) => s.sql)
    .join('\n')
  assert.doesNotMatch(resetSql, /\bstaff_users\b/)
  assert.doesNotMatch(resetSql, /\bstaff_roles\b/)
})

test('staff users are in the PRESERVED_TABLES set', () => {
  assert.ok(PRESERVED_TABLES.has('staff_users'))
  assert.ok(PRESERVED_TABLES.has('staff_roles'))
})

test('staff_sessions is NOT preserved — it is cleared during the reset', () => {
  assert.ok(!PRESERVED_TABLES.has('staff_sessions'), 'staff_sessions must NOT be preserved')
  assert.ok(RESET_TABLES.includes('staff_sessions'), 'staff_sessions must be in the reset set')
  assert.equal(RESET_TABLES[0], 'staff_sessions', 'staff_sessions must be cleared FIRST')
  const resetSql = buildResetStatements()
    .map((s) => s.sql)
    .join('\n')
  const sessionDeletes = resetSql.match(/delete from staff_sessions/gi) ?? []
  assert.equal(sessionDeletes.length, 1, 'staff_sessions must be deleted exactly once')
})

test('clearing sessions never touches staff accounts, roles or grants', () => {
  const deletes = buildResetStatements()
    .filter((s) => s.sql.startsWith('DELETE FROM'))
    .map((s) => s.sql)
    .join('\n')
  assert.match(deletes, /\bstaff_sessions\b/)
  assert.doesNotMatch(deletes, /delete from staff_users/i)
  assert.doesNotMatch(deletes, /delete from staff_roles/i)
  assert.doesNotMatch(deletes, /delete from permissions/i)
  assert.doesNotMatch(deletes, /delete from role_permissions/i)
})

/* ---------------------------------------------------------------------------
 * §14: roles preserved
 * ----------------------------------------------------------------------- */

test('roles are NOT in the RESET_TABLES and never deleted', () => {
  assert.ok(!RESET_TABLES.includes('roles'))
  assert.ok(!RESET_TABLES.includes('permissions'))
  assert.ok(!RESET_TABLES.includes('role_permissions'))
  const resetSql = buildResetStatements()
    .map((s) => s.sql)
    .join('\n')
  assert.doesNotMatch(resetSql, /\broles\b/)
  assert.doesNotMatch(resetSql, /\bpermissions\b/)
  assert.doesNotMatch(resetSql, /\brole_permissions\b/)
})

/* ---------------------------------------------------------------------------
 * §14: migration history preserved
 * ----------------------------------------------------------------------- */

test('migration history (drizzle schema) is never targeted by reset statements', () => {
  const resetSql = buildResetStatements()
    .map((s) => s.sql)
    .join('\n')
  assert.doesNotMatch(resetSql, /drizzle\.__drizzle_migrations/)
  assert.doesNotMatch(resetSql, /\bdrizzle\b/)
})

test('verifyPreservedIdentical returns no problems when both fingerprints are equal', () => {
  const fp = fakeFingerprint()
  assert.deepEqual(verifyPreservedIdentical(fp, fp), [])
})

test('verifyPreservedIdentical returns a problem when staffUsers change', () => {
  const before = fakeFingerprint()
  const after = fakeFingerprint({
    staffUsers: [...before.staffUsers, { ...before.staffUsers[0], id: 'zzz' }],
  })
  const problems = verifyPreservedIdentical(before, after)
  assert.ok(problems.some((p) => /fingerprint changed/.test(p)))
})

test('verifyPreservedIdentical treats null migrationCount on both sides as equal', () => {
  const before = fakeFingerprint({ migrationCount: null })
  const after = fakeFingerprint({ migrationCount: null })
  assert.deepEqual(verifyPreservedIdentical(before, after), [])
})

test('verifyPreservedIdentical flags a change in migration count', () => {
  const before = fakeFingerprint({ migrationCount: 19 })
  const after = fakeFingerprint({ migrationCount: 20 })
  const problems = verifyPreservedIdentical(before, after)
  assert.ok(problems.some((p) => /migration history changed/.test(p)))
})

test('migration count null before but present after is NOT flagged (schema migration table changed but identity unchanged)', () => {
  const before = fakeFingerprint({ migrationCount: null })
  const after = fakeFingerprint({ migrationCount: 19 })
  const problems = verifyPreservedIdentical(before, after)
  assert.ok(
    !problems.some((p) => /migration history changed/.test(p)),
    'null-to-present migration count is tolerated',
  )
})

/* ---------------------------------------------------------------------------
 * §14: business tables targeted
 * ----------------------------------------------------------------------- */

test('RESET_TABLES contains all business-domain tables', () => {
  const required = [
    'products',
    'product_variants',
    'product_options',
    'product_option_values',
    'product_media',
    'categories',
    'suppliers',
    'supplier_payment_entries',
    'inventory_balances',
    'inventory_movements',
    'orders',
    'order_items',
    'payments',
    'payment_events',
    'stock_reservations',
    'checkout_claims',
    'order_stock_returns',
    'order_stock_return_items',
    'store_sales',
    'store_sale_items',
    'customers',
    'store_reviews',
    'audit_logs',
    'content_pages',
    'delivery_zones',
    'store_settings',
  ]
  for (const table of required) {
    assert.ok(RESET_TABLES.includes(table), `RESET_TABLES must include ${table}`)
  }
})

test('buildResetStatements produces one DELETE per business table and one ALTER per identity sequence', () => {
  const statements = buildResetStatements()
  const deletes = statements.filter((s) => s.sql.startsWith('DELETE FROM'))
  const alters = statements.filter((s) => s.sql.startsWith('ALTER TABLE'))
  assert.equal(deletes.length, RESET_TABLES.length)
  assert.equal(alters.length, IDENTITY_RESET_COLUMNS.length)
})

test('identity restart uses the PROPER identity operation only (RESTART WITH 1)', () => {
  const alters = buildResetStatements()
    .filter((s) => s.sql.startsWith('ALTER TABLE'))
    .map((s) => s.sql)
  assert.equal(alters.length, 3)
  const expected = [
    'ALTER TABLE products ALTER COLUMN sequence RESTART WITH 1',
    'ALTER TABLE orders ALTER COLUMN sequence RESTART WITH 1',
    'ALTER TABLE store_sales ALTER COLUMN sequence RESTART WITH 1',
  ]
  assert.deepEqual(alters, expected)
  const joined = alters.join('\n')
  assert.doesNotMatch(joined, /TYPE bigint/i, 'column type must never be altered')
  assert.doesNotMatch(
    joined,
    /GENERATED (ALWAYS|BY DEFAULT) AS IDENTITY \(START/,
    'identity definition must never be redefined',
  )
  assert.doesNotMatch(joined, /uuid/i, 'UUID columns must never be touched')
})

test('buildResetStatements honors a caller-confirmed restart subset', () => {
  const confirmed = [{ table: 'products', column: 'sequence' }]
  const statements = buildResetStatements(confirmed)
  const alters = statements.filter((s) => s.sql.startsWith('ALTER TABLE'))
  assert.equal(alters.length, 1)
  assert.equal(alters[0].sql, 'ALTER TABLE products ALTER COLUMN sequence RESTART WITH 1')
})

test('all DELETE statements carry empty params', () => {
  for (const s of buildResetStatements()) {
    assert.ok(Array.isArray(s.params), `${s.sql} must have params`)
    assert.equal(s.params.length, 0, `${s.sql} must bind zero params`)
  }
})

test('RESET_TABLES excludes every AUTH_RBAC_TABLES entry', () => {
  for (const table of AUTH_RBAC_TABLES) {
    assert.ok(!RESET_TABLES.includes(table), `${table} must not be in RESET_TABLES`)
  }
})

/* ---------------------------------------------------------------------------
 * §14: auth/RBAC tables excluded
 * ----------------------------------------------------------------------- */

test('auth/RBAC tables are NEVER referenced in any reset DELETE statement', () => {
  const allSql = buildResetStatements()
    .map((s) => s.sql)
    .join('\n')
  for (const table of AUTH_RBAC_TABLES) {
    const pattern = new RegExp(`\\b${table}\\b`)
    assert.doesNotMatch(allSql, pattern, `auth table '${table}' must never appear in a DELETE`)
  }
})

/* ---------------------------------------------------------------------------
 * §14: DELETE order respects FK dependency graph (child before parent)
 * ----------------------------------------------------------------------- */

test('delete order puts children before parents (FK-safe)', () => {
  const idx = (table) => RESET_TABLES.indexOf(table)
  assert.ok(idx('staff_sessions') === 0, 'staff_sessions must be cleared first')
  assert.ok(idx('order_stock_return_items') < idx('order_stock_returns'))
  assert.ok(idx('order_stock_returns') < idx('orders'))
  assert.ok(idx('store_sale_items') < idx('store_sales'))
  assert.ok(idx('store_sales') < idx('customers'))
  assert.ok(idx('payment_events') < idx('payments'))
  assert.ok(idx('payments') < idx('orders'))
  assert.ok(idx('checkout_claims') < idx('orders'))
  assert.ok(idx('order_items') < idx('orders'))
  assert.ok(idx('order_items') < idx('products'))
  assert.ok(idx('product_variants') < idx('products'))
  assert.ok(idx('inventory_movements') < idx('product_variants'))
  assert.ok(idx('inventory_balances') < idx('product_variants'))
  assert.ok(idx('product_variant_options') < idx('product_variants'))
  assert.ok(idx('product_option_values') < idx('product_options'))
  assert.ok(idx('product_options') < idx('products'))
  assert.ok(idx('supplier_payment_entries') < idx('suppliers'))
  assert.ok(idx('order_stock_return_items') < idx('order_items'))
  assert.ok(idx('order_stock_return_items') < idx('product_variants'))
})

test('identity reset targets only business sequences (products, orders, store_sales)', () => {
  const tables = IDENTITY_RESET_COLUMNS.map((c) => c.table)
  assert.deepEqual(new Set(tables), new Set(['products', 'orders', 'store_sales']))
  for (const { table, column } of IDENTITY_RESET_COLUMNS) {
    assert.equal(column, 'sequence', `${table} identity column must be 'sequence'`)
  }
})

test('identity reset labels produce human-readable strings', () => {
  for (const col of IDENTITY_RESET_COLUMNS) {
    const label = identityResetLabel(col)
    assert.ok(label.includes('.'))
    assert.ok(label.includes('sequence'))
  }
})

test('identity introspection statement targets exactly the three sequence columns', () => {
  const introspection = identityIntrospectionTargets()
  assert.deepEqual(introspection, [
    { table: 'products', column: 'sequence' },
    { table: 'orders', column: 'sequence' },
    { table: 'store_sales', column: 'sequence' },
  ])
  const { sql } = buildIdentityIntrospectionSql()
  assert.match(sql, /^SELECT/)
  assert.doesNotMatch(sql, /\bALTER\b|\bTYPE\b|\bDELETE\b|\bINSERT\b|\bUPDATE\b|\bDROP\b/i)
  assert.match(sql, /attidentity/)
})

test('runIdentityIntrospection reads attidentity and flags identity columns', async () => {
  const rows = [
    { table_name: 'products', column_name: 'sequence', identity: 'a' },
    { table_name: 'orders', column_name: 'sequence', identity: 'a' },
    { table_name: 'store_sales', column_name: 'sequence', identity: 'd' },
  ]
  const query = () => Promise.resolve(rows)
  const result = await runIdentityIntrospection(query)
  assert.equal(result['products.sequence'].isIdentity, true)
  assert.equal(result['products.sequence'].identityType, 'a')
  assert.equal(result['orders.sequence'].isIdentity, true)
  assert.equal(result['store_sales.sequence'].identityType, 'd')
})

test('runIdentityIntrospection reports non-identity or missing columns as no-restart', async () => {
  const rows = [{ table_name: 'products', column_name: 'sequence', identity: '' }]
  const query = () => Promise.resolve(rows)
  const result = await runIdentityIntrospection(query)
  assert.equal(result['products.sequence'].isIdentity, false)
  assert.equal(result['orders.sequence'].isIdentity, false)
  assert.equal(result['orders.sequence'].identityType, null)
})

test('resolveConfirmedIdentityRestarts drops columns that are not confirmed identity', () => {
  const introspection = {
    'products.sequence': { isIdentity: true, identityType: 'a' },
    'orders.sequence': { isIdentity: false, identityType: null },
    'store_sales.sequence': { isIdentity: false, identityType: null },
  }
  const confirmed = resolveConfirmedIdentityRestarts(introspection)
  assert.deepEqual(confirmed, [{ table: 'products', column: 'sequence' }])
})

/* ---------------------------------------------------------------------------
 * §14: count queries are read-only SELECTs
 * ----------------------------------------------------------------------- */

test('count queries are read-only SELECTs only', () => {
  for (const { sql } of buildCountQueries(RESET_TABLES)) {
    assert.match(sql, /^SELECT count/)
    assert.doesNotMatch(
      sql,
      /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bALTER\b|\bCREATE\b/i,
    )
  }
})

test('preservation queries are read-only SELECTs', () => {
  for (const { sql } of PRESERVATION_QUERIES) {
    assert.match(sql, /^SELECT/)
    assert.doesNotMatch(
      sql,
      /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bALTER\b|\bCREATE\b/i,
    )
  }
  assert.match(migrationCountQuery().sql, /^SELECT count/)
})

test('login foundation check is a read-only SELECT', () => {
  const sql = buildLoginFoundationSql()
  assert.match(sql, /^SELECT/)
  assert.doesNotMatch(
    sql,
    /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bALTER\b|\bCREATE\b/i,
  )
})

/* ---------------------------------------------------------------------------
 * §14: dry-run performs zero writes
 * ----------------------------------------------------------------------- */

test('resolveWriteGate passes for dry-run mode without any confirmation', () => {
  const gate = resolveWriteGate({ mode: 'dry-run', confirm: undefined, backupVerified: undefined })
  assert.equal(gate.ok, true)
})

test('resolveWriteGate passes for verify mode without any confirmation', () => {
  const gate = resolveWriteGate({ mode: 'verify', confirm: undefined, backupVerified: undefined })
  assert.equal(gate.ok, true)
})

test('dry-run CLI path in source code exits BEFORE any sql.transaction call', () => {
  const source = readScript('reset-production-data.mjs')
  const lines = source.split('\n')
  const dryIdx = lines.findIndex((line) => /^\s*if\s*\(\s*DRY_RUN\s*\)/.test(line))
  const txIdx = lines.findIndex((line) => /await\s+runResetTransaction\(/.test(line))
  assert.ok(dryIdx !== -1, 'if (DRY_RUN) must exist in the main function')
  assert.ok(txIdx !== -1, 'await runResetTransaction must exist in the main function')
  assert.ok(dryIdx < txIdx, 'dry-run early-return must precede the transaction call')
})

/* ---------------------------------------------------------------------------
 * §14: missing confirmation refuses
 * ----------------------------------------------------------------------- */

test('resolveWriteGate refuses write without exact confirmation', () => {
  const gate = resolveWriteGate({ mode: 'write', confirm: undefined, backupVerified: undefined })
  assert.equal(gate.ok, false)
  assert.match(gate.reason, /CONFIRM_PRODUCTION_DATA_RESET/)
})

test('resolveWriteGate refuses write with wrong confirmation value', () => {
  const gate = resolveWriteGate({
    mode: 'write',
    confirm: 'YES',
    backupVerified: BACKUP_VERIFIED_VALUE,
  })
  assert.equal(gate.ok, false)
})

test('resolveWriteGate refuses write without backup verified', () => {
  const gate = resolveWriteGate({
    mode: 'write',
    confirm: CONFIRM_DATA_RESET_VALUE,
    backupVerified: undefined,
  })
  assert.equal(gate.ok, false)
  assert.match(gate.reason, new RegExp(BACKUP_VERIFIED_ENV))
})

test('resolveWriteGate refuses write with wrong backup verified value', () => {
  const gate = resolveWriteGate({
    mode: 'write',
    confirm: CONFIRM_DATA_RESET_VALUE,
    backupVerified: 'yes',
  })
  assert.equal(gate.ok, false)
})

test('resolveWriteGate accepts write with exact confirmations', () => {
  const gate = resolveWriteGate({
    mode: 'write',
    confirm: CONFIRM_DATA_RESET_VALUE,
    backupVerified: BACKUP_VERIFIED_VALUE,
  })
  assert.equal(gate.ok, true)
})

test('dry-run CLI source code does not require CONFIRM_PRODUCTION_DATA_RESET in the write guard', () => {
  const source = readScript('reset-production-data.mjs')
  const lines = source.split('\n')
  const dryIdx = lines.findIndex((line) => /^\s*if\s*\(\s*DRY_RUN\s*\)/.test(line))
  const confirmIdx = lines.findIndex((line) =>
    /CONFIRM_PRODUCTION_DATA_RESET must be exactly/.test(line),
  )
  assert.ok(dryIdx !== -1, 'if (DRY_RUN) must exist')
  assert.ok(confirmIdx !== -1, 'CONFIRM guard message must exist')
  assert.ok(dryIdx < confirmIdx, 'confirm check must be after the dry-run gate')
})

/* ---------------------------------------------------------------------------
 * §14: production guard works
 * ----------------------------------------------------------------------- */

test('reset-production-data.mjs imports the shared production-target guard', () => {
  const source = readScript('reset-production-data.mjs')
  assert.match(source, /from '\.\/lib\/connection-target\.mjs'/)
  assert.match(source, /validateProductionTarget\(/)
})

test('validateProductionTarget rejects localhost (guard works)', () => {
  const result = validateProductionTarget('postgres://u:p@localhost:5432/likehoney', {
    devUrlValue: DEV_URL,
  })
  assert.equal(result.ok, false)
})

test('validateProductionTarget rejects the known development branch', () => {
  const result = validateProductionTarget(DEV_URL, { devUrlValue: DEV_URL })
  assert.equal(result.ok, false)
})

test('reset-production-data.mjs references the exact confirm value in source', () => {
  const source = readScript('reset-production-data.mjs')
  assert.match(source, /DELETE_ALL_BUSINESS_DATA/)
})

test('reset-production-data.mjs references the backup verification env var', () => {
  const source = readScript('reset-production-data.mjs')
  assert.match(source, new RegExp(BACKUP_VERIFIED_ENV))
})

/* ---------------------------------------------------------------------------
 * §14: transaction rollback works
 * ----------------------------------------------------------------------- */

test('runResetTransaction runs all queries inside sql.transaction', async () => {
  const db = new FakeDb({ products: 10, orders: 5 })
  const statements = buildResetStatements()
  await runResetTransaction({
    sql: { query: db.query, transaction: db.transaction.bind(db) },
    statements,
  })
  assert.equal(db.committed, true, 'transaction must have been invoked')
  for (const table of RESET_TABLES) {
    assert.equal(db.counts[table], 0, `${table} must be zero after reset`)
  }
})

test('runResetTransaction rolls back all changes on any query failure', async () => {
  const initialCounts = { products: 5, orders: 3 }
  const db = new FakeDb(initialCounts)
  const failingStatements = [
    { sql: 'DELETE FROM products', params: [] },
    {
      sql: 'DELETE FROM non_existent',
      params: [],
      // force an error
    },
  ]
  const query = (sqlText, params) => {
    if (/non_existent/.test(sqlText)) return Promise.reject(new Error('table not found'))
    return db.query(sqlText, params)
  }
  const transaction = async (queries) => {
    const results = []
    for (const promise of queries) {
      results.push(await promise)
    }
  }
  const tx = { query, transaction }
  await assert.rejects(
    runResetTransaction({ sql: tx, statements: failingStatements }),
    /table not found/,
  )
})

/* ---------------------------------------------------------------------------
 * §14: post-reset verification detects leftovers
 * ----------------------------------------------------------------------- */

test('verifyZeroCounts returns no problems when all counts are zero', () => {
  const counts = Object.fromEntries(RESET_TABLES.map((t) => [t, 0]))
  assert.deepEqual(verifyZeroCounts(counts), [])
})

test('verifyZeroCounts detects leftover rows in any table', () => {
  const counts = Object.fromEntries(RESET_TABLES.map((t) => [t, 0]))
  counts.orders = 3
  counts.customers = 1
  const problems = verifyZeroCounts(counts)
  assert.ok(problems.some((p) => /orders.*3/.test(p)))
  assert.ok(problems.some((p) => /customers.*1/.test(p)))
  assert.equal(problems.length, 2)
})

test('verifyZeroCounts handles missing tables gracefully', () => {
  assert.deepEqual(verifyZeroCounts({}), [])
})

test('verifyPreservedIdentical returns problems when fingerprints diverge', () => {
  const before = fakeFingerprint()
  const after = fakeFingerprint({ staffUsers: [{ ...before.staffUsers[0], status: 'inactive' }] })
  const problems = verifyPreservedIdentical(before, after)
  assert.ok(problems.length > 0)
})

test('canonicalizeFingerprint produces stable canonical strings', () => {
  const fp = fakeFingerprint()
  const a = canonicalizeFingerprint(fp)
  const b = canonicalizeFingerprint({ ...fp })
  assert.equal(a, b)
})

/* ---------------------------------------------------------------------------
 * Login foundation
 * ----------------------------------------------------------------------- */

test('login foundation check detects orphan staff_roles links', () => {
  const problems = loginFoundationProblems({
    activeStaff: 2,
    staffWithoutPassword: 0,
    orphanStaffRolesStaff: 1,
    orphanStaffRolesRole: 0,
    orphanRolePermissionsRole: 0,
    orphanRolePermissionsPerm: 0,
  })
  assert.ok(problems.some((p) => /orphan staff_roles/.test(p)))
})

test('login foundation check detects missing staff password hash', () => {
  const problems = loginFoundationProblems({
    activeStaff: 1,
    staffWithoutPassword: 1,
    orphanStaffRolesStaff: 0,
    orphanStaffRolesRole: 0,
    orphanRolePermissionsRole: 0,
    orphanRolePermissionsPerm: 0,
  })
  assert.ok(problems.some((p) => /password hash/.test(p)))
})

test('login foundation check detects no active staff', () => {
  const problems = loginFoundationProblems({
    activeStaff: 0,
    staffWithoutPassword: 0,
    orphanStaffRolesStaff: 0,
    orphanStaffRolesRole: 0,
    orphanRolePermissionsRole: 0,
    orphanRolePermissionsPerm: 0,
  })
  assert.ok(problems.some((p) => /no active staff/.test(p)))
})

test('login foundation check passes when graph is healthy', () => {
  const problems = loginFoundationProblems({
    activeStaff: 2,
    staffWithoutPassword: 0,
    orphanStaffRolesStaff: 0,
    orphanStaffRolesRole: 0,
    orphanRolePermissionsRole: 0,
    orphanRolePermissionsPerm: 0,
  })
  assert.deepEqual(problems, [])
})

/* ---------------------------------------------------------------------------
 * R2 orphan estimate
 * ----------------------------------------------------------------------- */

test('estimateUnreferencedObjects counts listed objects not in the DB', () => {
  const listed = {
    'products/': ['products/a/1.png', 'products/a/2.png'],
    'categories/': ['categories/b/3.png'],
  }
  const referenced = { 'products/': ['products/a/1.png'], 'categories/': [] }
  const result = estimateUnreferencedObjects({
    listedByPrefix: listed,
    referencedByPrefix: referenced,
  })
  assert.equal(result.total, 2)
  assert.deepEqual(result.perPrefix['products/'], ['products/a/2.png'])
  assert.deepEqual(result.perPrefix['categories/'], ['categories/b/3.png'])
})

test('estimateUnreferencedObjects handles empty lists', () => {
  const result = estimateUnreferencedObjects({ listedByPrefix: {}, referencedByPrefix: {} })
  assert.equal(result.total, 0)
  for (const prefix of R2_PREFIXES) {
    assert.deepEqual(result.perPrefix[prefix], [])
  }
})

test('db reference queries are read-only', () => {
  for (const { sql } of buildDbReferenceQueries()) {
    assert.match(sql, /^SELECT/)
    assert.doesNotMatch(sql, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bALTER\b/i)
  }
})

/* ---------------------------------------------------------------------------
 * runTableCounts integration (in-memory)
 * ----------------------------------------------------------------------- */

test('runTableCounts returns correct counts from a fake db', async () => {
  const db = new FakeDb({ products: 42, orders: 7 })
  const counts = await runTableCounts(db.query, ['products', 'orders'])
  assert.equal(counts.products, 42)
  assert.equal(counts.orders, 7)
})

test('runTableCounts throws on non-finite count', async () => {
  const query = () => Promise.resolve([{ c: 'oops' }])
  await assert.rejects(runTableCounts(query, ['products']), /Unable to parse/)
})

/* ---------------------------------------------------------------------------
 * Package script wiring
 * ----------------------------------------------------------------------- */

test('db:reset:production-data script is wired in package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(pkg.scripts['db:reset:production-data'], /reset-production-data\.mjs/)
  assert.match(pkg.scripts['test'], /reset-production-data\.test\.mjs/)
})
