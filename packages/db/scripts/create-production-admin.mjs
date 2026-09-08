/**
 * PRODUCTION-ONLY first-Admin creation.
 *
 * The canonical, safe way to create ONE Admin staff user in the Neon
 * production database after migrations 0000–0015 have been applied. It
 * deliberately does NOT create roles, permissions, or any other data — it only
 * creates the staff member and attaches the EXISTING canonical `admin` role.
 *
 * Required environment variables:
 *   PRODUCTION_DATABASE_URL       production Neon connection string
 *   ADMIN_EMAIL                   login email (required, normalized/lowercased)
 *   ADMIN_PASSWORD                password to set (required, >= 8 chars)
 *   ADMIN_NAME_AR                 Arabic name (required)
 *   CONFIRM_PRODUCTION_ADMIN_CREATE  must be exactly "YES"
 *
 * Optional:
 *   ADMIN_NAME_EN                 English name
 *
 * Safety properties:
 *   - Refuses to run without every required variable (fail-closed).
 *   - Refuses obvious development / local DB targets.
 *   - Never prints the database URL or the plaintext password (only a redacted
 *     host + database name).
 *   - Normalizes/lowercases the email.
 *   - Hashes the password with EXACTLY the canonical production logic:
 *     PBKDF2-SHA256 / 100000 iterations / 16-byte salt / 32-byte key, stored as
 *     `pbkdf2$100000$<saltB64>$<hashB64>`.
 *   - Creates the staff user with status 'active'.
 *   - Does NOT use or reference `must_change_password` (removed by 0015).
 *   - Attaches the existing `admin` role via `staff_roles`. Fails clearly if the
 *     `admin` role does not exist rather than leaving a permission-less user.
 *   - Runs the whole create+attach flow inside a single transaction.
 *   - Idempotent: if a staff member with (lowercased) email already exists, it
 *     does NOT create a duplicate — it reports the account already exists and
 *     whether it already has the Admin role. If it already has the role, it is
 *     also a no-op for the password (never rehashes an existing account's
 *     password unless it had none).
 *   - Never modifies ANY other staff user. Never deletes or resets existing
 *     users. Never seeds development fixtures.
 *
 * Usage (PowerShell):
 *   $env:PRODUCTION_DATABASE_URL='postgres://user:pass@host/db' ; `
 *   $env:ADMIN_EMAIL='ahmad@likehoney.com' ; `
 *   $env:ADMIN_PASSWORD='<new password>' ; `
 *   $env:ADMIN_NAME_AR='أحمد' ; `
 *   $env:CONFIRM_PRODUCTION_ADMIN_CREATE='YES' ; `
 *   pnpm --filter @likehoney/db db:create:production-admin
 *
 * Do not run this casually. It writes to the production database.
 */
import fs from 'node:fs'
import { neon } from '@neondatabase/serverless'

import { validateProductionTarget } from './lib/connection-target.mjs'

const PBKDF2_ITERATIONS = 100_000
const SALT_BYTES = 16
const KEY_BYTES = 32
const PREFIX = 'pbkdf2'
const ADMIN_ROLE_CODE = 'admin'

const url = process.env.PRODUCTION_DATABASE_URL?.trim()
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
const password = process.env.ADMIN_PASSWORD
const nameAr = process.env.ADMIN_NAME_AR?.trim()
const nameEn = process.env.ADMIN_NAME_EN?.trim() || null
const confirm = process.env.CONFIRM_PRODUCTION_ADMIN_CREATE?.trim()

if (!url) throw new Error('PRODUCTION_DATABASE_URL is required')
if (!email) throw new Error('ADMIN_EMAIL is required')
if (!password) throw new Error('ADMIN_PASSWORD is required')
if (!nameAr) throw new Error('ADMIN_NAME_AR is required')
if (password.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters')
if (confirm !== 'YES') {
  throw new Error('CONFIRM_PRODUCTION_ADMIN_CREATE must be exactly "YES" to run')
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

// Redacted target for logging: host + database name only. Never the password.
const { target } = validation

function bytesToB64(buffer) {
  let binary = ''
  for (let i = 0; i < buffer.length; i++) binary += String.fromCharCode(buffer[i])
  return btoa(binary)
}

async function hashPassword(value) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(value),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    KEY_BYTES * 8,
  )
  const hash = new Uint8Array(bits)
  return `${PREFIX}$${PBKDF2_ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(hash)}`
}

// `phone_normalized` is NOT NULL + unique. No phone env var is part of this
// script's contract; synthesize a unique placeholder so sign-in works via
// email (mirrors bootstrap-admin.mjs's approach).
function synthesizePhone() {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(9)))
    .map((b) => b % 10)
    .join('')
  return `+970${rand}`
}

const sql = neon(url)

// Look up the existing canonical Admin role BEFORE doing anything.
const roleRows = await sql`SELECT id FROM roles WHERE code = ${ADMIN_ROLE_CODE} LIMIT 1`
if (roleRows.length === 0) {
  throw new Error(
    `The '${ADMIN_ROLE_CODE}' role does not exist in this database — refusing to create a user with no permissions.` +
      ` Ensure the production DB has been bootstrapped with the canonical Admin role before running this script.`,
  )
}
const adminRoleId = roleRows[0].id

// Look up an existing staff member by (already-lowercased) email.
const existingRows =
  await sql`SELECT id, name_ar, name_en, status, password_hash FROM staff_users WHERE lower(email) = lower(${email}) LIMIT 1`

if (existingRows.length > 0) {
  const existing = existingRows[0]
  const hasRole =
    await sql`SELECT 1 FROM staff_roles WHERE staff_id = ${existing.id} AND role_id = ${adminRoleId}`
  const roleState =
    hasRole.length > 0 ? 'already has the Admin role' : 'does NOT yet have the Admin role'
  console.log(
    `An account with email ${email} already exists and ${roleState}. No duplicate was created.`,
  )
  process.exit(0)
}

// Create the staff member and attach the Admin role in ONE atomic statement
// (data-modifying CTE). The HTTP `neon().transaction()` API is non-interactive
// (no awaiting inside the callback), so a single self-contained statement is
// the correct transaction-safe form: either both writes commit or neither.
// The synthesized placeholder phone could in principle collide with an existing
// unique `phone_normalized`; retry with a fresh phone on a unique violation.
const passwordHash = await hashPassword(password)
const PHONE_RETRY_MAX = 3

let staffId = null
let lastRetryErr = null
for (let attempt = 0; attempt < PHONE_RETRY_MAX && staffId === null; attempt++) {
  const phone = synthesizePhone()
  try {
    const created = await sql`
      WITH new_staff AS (
        INSERT INTO staff_users (name_ar, name_en, email, phone_normalized, status, password_hash)
        VALUES (${nameAr}, ${nameEn}, ${email}, ${phone}, 'active', ${passwordHash})
        RETURNING id
      )
      INSERT INTO staff_roles (staff_id, role_id)
      SELECT id, ${adminRoleId} FROM new_staff
      RETURNING staff_id AS id`
    staffId = created[0].id
  } catch (err) {
    lastRetryErr = err
    if (err?.code !== '23505') throw err
  }
}
if (staffId === null) {
  throw new Error(
    `Could not create the Admin after ${PHONE_RETRY_MAX} attempts (placeholder phone collisions): ${
      lastRetryErr?.message ?? 'unknown error'
    }`,
  )
}

console.log(
  `Created Admin: ${nameAr}${nameEn ? ` (${nameEn})` : ''} <${email}> (id ${staffId.slice(0, 8)}) on ${target}`,
)
console.log(`PBKDF2-SHA256 @ ${PBKDF2_ITERATIONS} iterations (Cloudflare Workers compatible)`)
console.log('Password not printed. You can now sign in via the Admin login page.')
