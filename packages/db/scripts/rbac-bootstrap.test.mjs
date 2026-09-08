/**
 * Tests for the PRODUCTION-ONLY RBAC bootstrap.
 *
 * Runs against pure statement builders (`lib/rbac-bootstrap.mjs`) — no
 * database required. Covers the production-safety contract:
 *   - connection production guard is reused (the script imports it)
 *   - the canonical permission list has no duplicates and full bilingual labels
 *   - the admin role receives every canonical permission
 *   - repeated bootstrap is idempotent (ON CONFLICT DO NOTHING, no UPDATE)
 *   - existing permissions and the existing admin role are reused, never
 *     rewritten, deleted, or dropped
 *   - no staff users / dev fixtures are created; verification is read-only
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { validateProductionTarget } from './lib/connection-target.mjs'
import {
  ADMIN_ROLE_CODE,
  ADMIN_ROLE_NAME_AR,
  ADMIN_ROLE_NAME_EN,
  canonicalPermissionCodes,
  rbacBootstrapStatements,
  rbacVerificationQueries,
  validateCanonicalIntegrity,
} from './lib/rbac-bootstrap.mjs'
import { ADMIN_ROLE_PERMISSIONS, PERMISSION_LABELS } from './rbac-defaults.mjs'

function readScript(name) {
  return readFileSync(new URL(name, import.meta.url), 'utf8')
}

function collectAllSql(statements) {
  return statements.map(({ sql }) => sql).join('\n')
}

/**
 * The highest `$n` placeholder position referenced by a statement. PostgreSQL
 * binds parameters by position: a query referencing `$1..$K` must receive
 * EXACTLY K bind values. A reused `$1` does NOT create an extra slot — it keeps
 * the max at 1 while two params might be supplied. This is the invariant that
 * caught the production `adminPermissions` bug (18 params, max placeholder 17).
 */
function maxPlaceholder(sql) {
  const positions = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]))
  return positions.length === 0 ? 0 : Math.max(...positions)
}

test('every statement binds exactly as many params as SQL placeholders', () => {
  const mustMatch = (stmt, label) => {
    const max = maxPlaceholder(stmt.sql)
    assert.equal(
      stmt.params.length,
      max,
      `${label}: expected ${max} bind values for $1..$${max}, got ${stmt.params.length}`,
    )
  }

  for (const stmt of rbacBootstrapStatements()) mustMatch(stmt, 'bootstrap statement')
  for (const query of rbacVerificationQueries())
    mustMatch(query, `verification query ${query.name}`)
})

test('verification adminPermissions binds role code + every canonical code', () => {
  const codes = canonicalPermissionCodes()
  const adminPermissions = rbacVerificationQueries().find((q) => q.name === 'adminPermissions')
  assert.ok(adminPermissions, 'adminPermissions query exists')
  // Placeholders must cover $1 (role) + $2..$N+1 (codes) — 18 slots for 17
  // canonical codes, derived from the canonical list (never a hardcoded count).
  assert.equal(
    maxPlaceholder(adminPermissions.sql),
    codes.length + 1,
    'adminPermissions SQL must have one slot per permission code plus the role',
  )
  assert.equal(adminPermissions.params.length, codes.length + 1)
  assert.equal(adminPermissions.params[0], ADMIN_ROLE_CODE)
  assert.deepEqual(
    adminPermissions.params.slice(1),
    codes,
    'adminPermissions binds exactly the canonical permission codes after the role',
  )
})

test('bootstrap script reuses the connection production guard', () => {
  const source = readScript('bootstrap-production-rbac.mjs')
  assert.match(source, /from '\.\/lib\/connection-target\.mjs'/)
  assert.match(source, /validateProductionTarget\(/)
  // The guard rejects obvious localhost targets (also covered in
  // connection-target.test.mjs) — proves the shared helper stays in charge.
  assert.deepEqual(validateProductionTarget('postgres://u:p@localhost/db'), {
    ok: false,
    reason: 'Refusing a localhost database target',
  })
})

test('canonical permission list has no duplicates and is fully labelled', () => {
  validateCanonicalIntegrity() // throws on any violation
  const codes = canonicalPermissionCodes()
  assert.equal(new Set(codes).size, codes.length)
  assert.ok(codes.length > 0)
  assert.deepEqual(codes, ADMIN_ROLE_PERMISSIONS)
  for (const code of codes) {
    const [nameAr, nameEn] = PERMISSION_LABELS[code]
    assert.ok(nameAr && nameAr.length > 0, `Arabic label required for ${code}`)
    assert.ok(nameEn && nameEn.length > 0, `English label required for ${code}`)
  }
})

test('admin role receives every canonical permission', () => {
  const statements = rbacBootstrapStatements()
  assert.equal(statements.length, 3)
  const linking = statements[2].sql
  const codes = canonicalPermissionCodes()
  // The link statement targets the admin role code and lists every code.
  assert.match(linking, /FROM roles r, permissions p/)
  assert.match(linking, /r\.code = \$\d+/)
  const lastParam = statements[2].params.at(-1)
  assert.equal(lastParam, ADMIN_ROLE_CODE)
  // Every canonical code appears as a link parameter.
  for (const code of codes) assert.ok(statements[2].params.includes(code))
  // The role statement creates the canonical admin role with bilingual labels.
  const roleStmt = statements[1]
  assert.equal(roleStmt.params[0], ADMIN_ROLE_CODE)
  assert.equal(roleStmt.params[1], ADMIN_ROLE_NAME_AR)
  assert.equal(roleStmt.params[2], ADMIN_ROLE_NAME_EN)
})

test('bootstrap is idempotent (insert-only, no updates)', () => {
  const statements = rbacBootstrapStatements()
  // Permission rows: INSERT ... ON CONFLICT (code) DO NOTHING.
  assert.match(statements[0].sql, /^INSERT INTO permissions/)
  assert.match(statements[0].sql, /ON CONFLICT \(code\) DO NOTHING$/)
  assert.doesNotMatch(statements[0].sql, /\bUPDATE\b/)
  assert.doesNotMatch(statements[0].sql, /\bupsert\b/i)
  // Admin role row: INSERT ... ON CONFLICT (code) DO NOTHING.
  assert.match(statements[1].sql, /^INSERT INTO roles/)
  assert.match(statements[1].sql, /ON CONFLICT \(code\) DO NOTHING$/)
  assert.doesNotMatch(statements[1].sql, /\bUPDATE\b/)
  // Links: INSERT ... SELECT ... ON CONFLICT DO NOTHING.
  assert.match(statements[2].sql, /^INSERT INTO role_permissions/)
  assert.match(statements[2].sql, /ON CONFLICT DO NOTHING$/)
  assert.doesNotMatch(statements[2].sql, /\bUPDATE\b/)
})

test('existing permissions and the existing admin role are reused', () => {
  const statements = rbacBootstrapStatements()
  const allSql = collectAllSql(statements)
  // On conflict, existing rows are left untouched: no SET clause, no WHERE
  // DELETE, no re-insert of rows that could violate the unique constraints.
  assert.doesNotMatch(allSql, /\bUPDATE\b/)
  assert.doesNotMatch(allSql, /\bDELETE\b/)
  assert.doesNotMatch(allSql, /\bDROP\b/)
  assert.doesNotMatch(allSql, /\bTRUNCATE\b/)
  assert.doesNotMatch(allSql, /\bALTER\b/)
  assert.doesNotMatch(allSql, /\bCREATE\b/)
})

test('bootstrap never creates staff users and touches only RBAC tables', () => {
  const statements = rbacBootstrapStatements()
  const allSql = collectAllSql(statements)
  assert.doesNotMatch(allSql, /staff_users/)
  assert.doesNotMatch(allSql, /staff_roles/)
  // Only the three canonical RBAC tables are referenced.
  for (const { sql } of statements) {
    const referenced = [...sql.matchAll(/INSERT INTO (\w+)|FROM (\w+)/g)].map((m) => m[1] ?? m[2])
    for (const table of referenced) {
      assert.ok(
        ['permissions', 'roles', 'role_permissions'].includes(table),
        `${table} must not be referenced by a bootstrap statement`,
      )
    }
  }
})

test('verification queries are read-only SELECTs over RBAC tables only', () => {
  const queries = rbacVerificationQueries()
  assert.equal(queries.length, 3)
  for (const { sql, params } of queries) {
    assert.match(sql, /^SELECT/)
    assert.doesNotMatch(sql, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i)
    assert.ok(Array.isArray(params) && params.length > 0)
  }
  // Every canonical permission is allowed to be present/posted.
  const permissionParams = queries[0].params
  assert.deepEqual(
    permissionParams,
    canonicalPermissionCodes(),
    'verification checks exactly the canonical permission set',
  )
})

test('bootstrap script is wired as a package script', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(pkg.scripts['db:bootstrap:production-rbac'], /bootstrap-production-rbac\.mjs/)
  assert.match(pkg.scripts['test'], /rbac-bootstrap\.test\.mjs/)
})

test('bootstrap script guards the confirm flag and target in source', () => {
  const source = readScript('bootstrap-production-rbac.mjs')
  assert.match(source, /CONFIRM_PRODUCTION_RBAC_BOOTSTRAP must be exactly "YES"/)
  assert.match(source, /PRODUCTION_DATABASE_URL is required/)
  assert.match(source, /--verify/)
})
