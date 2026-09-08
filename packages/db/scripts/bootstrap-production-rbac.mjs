/**
 * PRODUCTION-ONLY canonical RBAC bootstrap.
 *
 * The safe, idempotent way to ensure the production database has the canonical
 * `admin` role, every canonical permission code, and the full admin→permission
 * grant set — BEFORE the first production Admin staff user is created with
 * `db:create:production-admin`.
 *
 * Canonical source of truth: `./rbac-defaults.mjs` (admin role = ALL canonical
 * permissions). Production policy:
 *   - Bootstraps ONLY the built-in `admin` role.
 *   - DOES NOT create employee/staff roles — an Admin provisions those at
 *     runtime via staff management (`EMPLOYEE_DEFAULT_PERMISSIONS`).
 *   - Never creates staff users. Never seeds dev fixtures.
 *   - Idempotent: INSERT ... ON CONFLICT DO NOTHING only. Existing rows are
 *     reused, nothing is updated, deleted, dropped, or re-linked.
 *   - Runs the three statements in ONE atomic transaction (Neon HTTP batch —
 *     a single non-interactive round trip, so it either commits or rolls back
 *     as a unit).
 *
 * Required environment variables:
 *   PRODUCTION_DATABASE_URL            production Neon connection string
 *   CONFIRM_PRODUCTION_RBAC_BOOTSTRAP  must be exactly "YES" to write
 *
 * Optional:
 *   --verify                 read-only mode: report the current state without
 *                            writing anything (does NOT require the confirm var)
 *
 * Usage (PowerShell):
 *   $env:PRODUCTION_DATABASE_URL='postgres://user:pass@host/db' ; `
 *   $env:CONFIRM_PRODUCTION_RBAC_BOOTSTRAP='YES' ; `
 *   pnpm --filter @likehoney/db db:bootstrap:production-rbac
 *
 * Read-only verification:
 *   $env:PRODUCTION_DATABASE_URL='postgres://user:pass@host/db' ; `
 *   pnpm --filter @likehoney/db db:bootstrap:production-rbac --verify
 *
 * Do not run this casually. It writes to the production database.
 */
import fs from 'node:fs'
import { neon } from '@neondatabase/serverless'

import { validateProductionTarget } from './lib/connection-target.mjs'
import { rbacBootstrapStatements, rbacVerificationQueries } from './lib/rbac-bootstrap.mjs'

const VERIFY_MODE = process.argv.includes('--verify')

const url = process.env.PRODUCTION_DATABASE_URL?.trim()
const confirm = process.env.CONFIRM_PRODUCTION_RBAC_BOOTSTRAP?.trim()

if (!url) throw new Error('PRODUCTION_DATABASE_URL is required')
if (!VERIFY_MODE && confirm !== 'YES') {
  throw new Error('CONFIRM_PRODUCTION_RBAC_BOOTSTRAP must be exactly "YES" to write')
}

// Validate the production target by endpoint/host identity — never by the
// database name (Neon branches share `likehoneydb`). Fails closed against
// local targets and against the known Development connection.
const envPath = new URL('../.env', import.meta.url)
const devUrl = fs.existsSync(envPath)
  ? fs
      .readFileSync(envPath, 'utf8')
      .match(/^DATABASE_URL=(.+)$/m)?.[1]
      ?.trim()
  : undefined
const validation = validateProductionTarget(url, { devUrlValue: devUrl })
if (!validation.ok) throw new Error(validation.reason)

// Redacted target for logging: host + database name only. Never credentials.
const { target } = validation

const sql = neon(url)
const verificationQueries = rbacVerificationQueries()

async function runVerification() {
  const rows = await Promise.all(
    verificationQueries.map(({ sql: stmt, params }) => sql.query(stmt, params)),
  )
  const summary = {}
  verificationQueries.forEach(({ name }, i) => {
    summary[name] = rows[i][0]?.n ?? 0
  })
  return summary
}

function printVerification(summary) {
  const codes = rbacVerificationQueries()[0].params.length
  console.log(`permissions present: ${summary.permissionsPresent} / ${codes}`)
  console.log(`admin role: ${summary.adminRolePresent === 1 ? 'present' : 'missing'}`)
  console.log(`admin permissions: ${summary.adminPermissions} / ${codes}`)
}

if (VERIFY_MODE) {
  const summary = await runVerification()
  console.log(`RBAC verification (read-only): ${target}`)
  printVerification(summary)
  const complete =
    summary.permissionsPresent === summary.adminPermissions && summary.adminRolePresent === 1
  console.log(`RBAC bootstrap: ${complete ? 'complete' : 'incomplete'}`)
  process.exit(complete ? 0 : 2)
}

const statements = rbacBootstrapStatements()

// Atomic, non-interactive transaction: the Neon HTTP driver wraps the array of
// `NeonQueryPromise`s in a single batch. Either all three commits or none.
await sql.transaction(statements.map(({ sql: stmt, params }) => sql.query(stmt, params)))
console.log(`RBAC bootstrap: applied (${target})`)

const summary = await runVerification()
printVerification(summary)
const complete =
  summary.permissionsPresent === summary.adminPermissions && summary.adminRolePresent === 1
console.log(`RBAC bootstrap: ${complete ? 'complete' : 'incomplete'}`)
process.exit(complete ? 0 : 2)
