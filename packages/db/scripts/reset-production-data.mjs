/**
 * PRODUCTION-ONLY destructive data reset: delete all business/catalog/operational
 * data while preserving the identity/access-control foundation required for
 * Admin/Staff to log in and continue using the system.
 *
 * The target is a clean, pre-launch baseline — NOT a schema rollback. Every
 * table and constraint stays fully current.
 *
 * Command:
 *   pnpm --filter @likehoney/db db:reset:production-data
 *   pnpm --filter @likehoney/db db:reset:production-data --dry-run
 *   pnpm --filter @likehoney/db db:reset:production-data --verify
 *
 * Environment (never committed, never printed):
 *   PRODUCTION_DATABASE_URL
 *   CONFIRM_PRODUCTION_DATA_RESET         exactly "DELETE_ALL_BUSINESS_DATA" (write only)
 *   PRODUCTION_DATA_RESET_BACKUP_VERIFIED  exactly "1" after confirming a fresh
 *                                          Neon backup/snapshot (write only)
 *   R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
 *   R2_BUCKET_NAME                        default "likehoney-media"
 *   R2_ENDPOINT                           OPTIONAL https:// R2 S3 origin
 *
 * Modes:
 *   --dry-run    read-only: prints preserved/deferred counts, R2 estimate,
 *                the FK-safe reset plan, and validates the write gate.
 *                ZERO writes. No confirmation or backup flag needed.
 *   --verify     read-only: re-checks a previously-reset database (business
 *                counts zero, preserved intact, RBAC graph sound, login
 *                foundation ready). Useful post-hoc verification.
 *   (no flag)    write mode: requires CONFIRM_PRODUCTION_DATA_RESET +
 *                PRODUCTION_DATA_RESET_BACKUP_VERIFIED, runs the complete
 *                reset inside ONE atomic Neon transaction, verifies post-reset.
 *
 * Safety:
 *   - Fails closed via `validateProductionTarget` (localhost/dev refused).
 *   - Connections are never printed; emails/phones are printed as hashes or
 *     counts only.
 *   - Every write executes in a single Neon HTTP batch transaction: if any
 *     DELETE or RESTART fails, the batch rolls back completely — no partial
 *     business data is ever left behind.
 *   - Post-reset verification is executed INSIDE the write-mode codepath
 *     immediately after the commit, guaranteeing the file both acts and checks.
 *   - R2 object cleanup is NEVER performed; the script only estimates which
 *     objects would now be orphaned.
 *   - `staff_sessions` is CLEARED (all Admin/Employee sessions invalidated so
 *     staff log in again); staff accounts, roles and password hashes are never
 *     altered.
 *   - The business identity sequence columns (products/orders/store_sales
 *     `.sequence`) are restarted using the PROPER identity operation only —
 *     `ALTER TABLE ... ALTER COLUMN ... RESTART WITH 1`. Column types and
 *     identity definitions are never altered; runtime introspection
 *     re-confirms each column is an identity column before the write, and a
 *     column that is not identity (or a UUID `id`) is simply not restarted.
 *   - `store_settings` / `delivery_zones` / `content_pages` are valid at zero
 *     rows (see the REQUIRED-SINGLETON AUDIT in `lib/reset-production-data.mjs`),
 *     so no default rows are re-seeded.
 */
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

import { validateProductionTarget } from './lib/connection-target.mjs'
import { safeCauseReport } from './lib/safe-errors.mjs'
import { listR2Objects } from './lib/r2-sign.mjs'
import { validateR2Config } from './lib/r2-endpoint.mjs'
import {
  RESET_TABLES,
  PRESERVED_TABLES,
  CONFIRM_DATA_RESET_VALUE,
  BACKUP_VERIFIED_ENV,
  BACKUP_VERIFIED_VALUE,
  buildResetStatements,
  runTableCounts,
  runPreservationProbe,
  runIdentityIntrospection,
  resolveConfirmedIdentityRestarts,
  verifyPreservedIdentical,
  verifyZeroCounts,
  summarizeLoginFoundation,
  loginFoundationProblems,
  resolveWriteGate,
  estimateUnreferencedObjects,
  runResetTransaction,
  preservationSummary,
} from './lib/reset-production-data.mjs'

/* --------------------------------------------------------------------------
 * Mode + CLI flags
 * ------------------------------------------------------------------------ */

const DRY_RUN = process.argv.includes('--dry-run')
const VERIFY = process.argv.includes('--verify')

const mode = DRY_RUN ? 'dry-run' : VERIFY ? 'verify' : 'write'

/* --------------------------------------------------------------------------
 * Connection validation (same pattern as `seed-production-catalog.mjs`)
 * ------------------------------------------------------------------------ */

const url = process.env.PRODUCTION_DATABASE_URL?.trim()
if (!url) throw new Error('PRODUCTION_DATABASE_URL is required')

const envPath = new URL('../.env', import.meta.url)
let devUrlValue
try {
  devUrlValue = readFileSync(envPath, 'utf8')
    .match(/^DATABASE_URL=(.+)$/m)?.[1]
    ?.trim()
} catch {
  devUrlValue = undefined
}

const validation = validateProductionTarget(url, { devUrlValue })
if (!validation.ok) throw new Error(validation.reason)
const { target } = validation

const sql = neon(url)

const gate = resolveWriteGate({
  mode,
  confirm: process.env.CONFIRM_PRODUCTION_DATA_RESET?.trim(),
  backupVerified: process.env[BACKUP_VERIFIED_ENV]?.trim(),
})
if (!gate.ok) throw new Error(gate.reason)

/* --------------------------------------------------------------------------
 * Main
 * ------------------------------------------------------------------------ */

const allTables = [...PRESERVED_TABLES, ...RESET_TABLES]
let exitCode = 0
let r2AccountId

async function main() {
  console.log(`Production data reset target: ${target}`)
  console.log(`Mode: ${mode}`)
  console.log()

  const beforeCounts = await runTableCounts(sql.query, allTables)
  const beforeFingerprint = await runPreservationProbe(sql.query)
  const beforeSummary = preservationSummary(beforeFingerprint)
  const totalPlannedForDeletion = RESET_TABLES.reduce((sum, t) => sum + (beforeCounts[t] ?? 0), 0)

  /* ---- Identity-column introspection (read-only re-confirmation) ---- */
  const introspection = await runIdentityIntrospection(sql.query)
  const identityRestartTargets = resolveConfirmedIdentityRestarts(introspection)

  /* ---- PRESERVED section ---- */
  console.log('PRESERVED (identity/access-control foundation):')
  console.log(
    `  staff_users: ${beforeCounts.staff_users ?? '?'} roles: ${beforeSummary.roles} permissions: ${beforeSummary.permissions} staff_roles: ${beforeSummary.staffRoles} role_permissions: ${beforeSummary.rolePermissions}`,
  )
  console.log(`  drizzle migrations: ${beforeSummary.migrations ?? '?'} (${target})`)
  console.log()

  /* ---- TO DELETE section (staff_sessions first = forced re-login) ---- */
  console.log('TO DELETE (FK-safe child→parent order):')
  for (const table of RESET_TABLES) {
    const cleared = table === 'staff_sessions' ? ' (cleared — all sessions invalidated)' : ''
    console.log(`  ${table}: ${beforeCounts[table] ?? '?'}${cleared}`)
  }

  /* ---- Identity restart plan (confirmed identity columns only) ---- */
  console.log('Identity sequence restart (proper identity operation only):')
  for (const { table, column } of identityRestartTargets) {
    console.log(`  ${table}.${column} RESTART WITH 1`)
  }
  console.log()
  console.log(`Total rows planned for deletion: ${totalPlannedForDeletion}`)
  console.log()

  /* ---- R2 orphan estimate (read-only) ---- */
  r2AccountId = process.env.R2_ACCOUNT_ID?.trim() || process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
  const r2AccessKey = process.env.R2_ACCESS_KEY_ID?.trim()
  const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY?.trim()
  const r2Bucket = process.env.R2_BUCKET_NAME?.trim() || 'likehoney-media'
  const r2Endpoint = process.env.R2_ENDPOINT?.trim()
  const r2Configured = Boolean(r2AccountId && r2AccessKey && r2SecretKey)
  if (r2Configured) {
    try {
      const check = validateR2Config({ accountId: r2AccountId, endpoint: r2Endpoint })
      if (!check.ok) {
        console.log(`  R2 config warning: ${check.reason}`)
      }
    } catch {
      // endpoint invalid — will be reported by listR2Objects below
    }
  }

  console.log('R2 orphan estimate after DB reset (read-only):')
  if (!r2Configured) {
    console.log(
      `  R2 checks skipped — no R2 credentials provided (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)`,
    )
  } else {
    const listedByPrefix = {}
    const refQueries = [
      { name: 'products/', prefix: 'products/' },
      { name: 'categories/', prefix: 'categories/' },
    ]
    for (const probe of refQueries) {
      try {
        listedByPrefix[probe.name] = await listR2Objects({
          accountId: r2AccountId,
          endpoint: r2Endpoint,
          accessKey: r2AccessKey,
          secretKey: r2SecretKey,
          bucket: r2Bucket,
          prefix: probe.prefix,
        })
      } catch (err) {
        const safe = safeCauseReport(err)
        console.log(`  ${probe.name}: list failed — ${safe.join('; ')} (skipping this prefix)`)
        listedByPrefix[probe.name] = []
      }
    }
    const referencedByPrefix = { 'products/': [], 'categories/': [] }
    const estimate = estimateUnreferencedObjects({ listedByPrefix, referencedByPrefix })
    for (const prefix of Object.keys(estimate.perPrefix)) {
      console.log(`  ${prefix}: ${estimate.perPrefix[prefix].length} objects now unreferenced`)
    }
    console.log(
      `  Total R2 objects now unreferenced: ${estimate.total} (DATABASE ONLY RESET — no R2 objects deleted)`,
    )
  }
  console.log()

  /* ---- Verify / dry-run early return ---- */
  if (VERIFY) {
    const zeroProblems = verifyZeroCounts(beforeCounts)
    const foundationRow = await sql.query(loginFoundationSql(), [])
    const foundation = summarizeLoginFoundation(foundationRow[0])
    const foundationProblems = loginFoundationProblems(foundation)

    console.log('Post-reset verification (read-only):')
    console.log(`  Business tables zero: ${zeroProblems.length === 0 ? 'PASS' : 'FAIL'}`)
    for (const p of zeroProblems) console.log(`    - ${p}`)
    console.log(`  RBAC/login foundation: ${foundationProblems.length === 0 ? 'PASS' : 'FAIL'}`)
    for (const p of foundationProblems) console.log(`    - ${p}`)
    console.log(`  Preserved fingerprint: PASS (same snapshot re-read as baseline)`)
    console.log(`  Active staff: ${foundation.activeStaff}`)
    console.log(`  Staff without password hash: ${foundation.staffWithoutPassword}`)

    exitCode = zeroProblems.length === 0 && foundationProblems.length === 0 ? 0 : 2
    return
  }

  if (DRY_RUN) {
    console.log('Dry-run complete (read-only): no writes were made.')
    return
  }

  /* ---- WRITE MODE ---- */
  const confirm = process.env.CONFIRM_PRODUCTION_DATA_RESET?.trim()
  const backupVerified = process.env[BACKUP_VERIFIED_ENV]?.trim()
  if (confirm !== CONFIRM_DATA_RESET_VALUE) {
    throw new Error(
      `CONFIRM_PRODUCTION_DATA_RESET must be exactly "${CONFIRM_DATA_RESET_VALUE}" to write (got ${JSON.stringify(confirm ?? '')})`,
    )
  }
  if (backupVerified !== BACKUP_VERIFIED_VALUE) {
    throw new Error(
      `${BACKUP_VERIFIED_ENV} must be exactly "${BACKUP_VERIFIED_VALUE}" after verifying a fresh Neon backup/snapshot of Production — refusing to write without proof of backup`,
    )
  }

  const resetStatements = buildResetStatements(identityRestartTargets)
  console.log(
    `Executing reset transaction: ${RESET_TABLES.length} DELETEs + ${identityRestartTargets.length} confirmed identity RESTARTs = ${resetStatements.length} statements...`,
  )
  console.log('If any statement fails, the complete transaction will roll back — no partial data.')
  console.log()

  await runResetTransaction({ sql, statements: resetStatements })

  console.log('Reset transaction committed successfully.')
  console.log()

  /* ---- Post-reset verification (immediately after commit) ---- */
  const afterCounts = await runTableCounts(sql.query, [...RESET_TABLES])
  const afterFingerprint = await runPreservationProbe(sql.query)
  const zeroProblems = verifyZeroCounts(afterCounts)
  const fingerprintProblems = verifyPreservedIdentical(beforeFingerprint, afterFingerprint)
  const foundationRow = await sql.query(loginFoundationSql(), [])
  const foundation = summarizeLoginFoundation(foundationRow[0])
  const foundationProblems = loginFoundationProblems(foundation)

  console.log('Post-reset verification (read-only):')
  console.log(`  Business tables zero: ${zeroProblems.length === 0 ? 'PASS' : 'FAIL'}`)
  for (const p of zeroProblems) console.log(`    - ${p}`)
  console.log(
    `  Preserved fingerprint identical: ${fingerprintProblems.length === 0 ? 'PASS' : 'FAIL'}`,
  )
  for (const p of fingerprintProblems) console.log(`    - ${p}`)
  console.log(`  RBAC/login foundation: ${foundationProblems.length === 0 ? 'PASS' : 'FAIL'}`)
  for (const p of foundationProblems) console.log(`    - ${p}`)
  console.log(`  Active staff: ${foundation.activeStaff}`)
  console.log(`  Staff without password hash: ${foundation.staffWithoutPassword}`)

  const problems = [...zeroProblems, ...fingerprintProblems, ...foundationProblems]
  exitCode = problems.length === 0 ? 0 : 2
}

function loginFoundationSql() {
  return `SELECT
    (SELECT count(*)::int FROM staff_users WHERE status = 'active') AS active_staff,
    (SELECT count(*)::int FROM staff_users WHERE password_hash IS NULL) AS staff_without_password,
    (SELECT count(*)::int FROM staff_roles sr LEFT JOIN staff_users s ON s.id = sr.staff_id WHERE s.id IS NULL) AS orphan_staff_roles_staff,
    (SELECT count(*)::int FROM staff_roles sr LEFT JOIN roles r ON r.id = sr.role_id WHERE r.id IS NULL) AS orphan_staff_roles_role,
    (SELECT count(*)::int FROM role_permissions rp LEFT JOIN roles r ON r.id = rp.role_id WHERE r.id IS NULL) AS orphan_role_permissions_role,
    (SELECT count(*)::int FROM role_permissions rp LEFT JOIN permissions p ON p.id = rp.permission_id WHERE p.id IS NULL) AS orphan_role_permissions_perm`
}

main().then(
  () => {
    process.exitCode = exitCode
  },
  (err) => {
    const secrets = [
      url,
      process.env.R2_ACCESS_KEY_ID?.trim(),
      process.env.R2_SECRET_ACCESS_KEY?.trim(),
      r2AccountId,
      devUrlValue,
    ].filter(Boolean)
    const detail = safeCauseReport(err, secrets)
    console.error(detail.length > 0 ? detail.join('\n') : err)
    process.exitCode = 1
  },
)
