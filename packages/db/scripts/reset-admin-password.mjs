/**
 * ONE-TIME production password reset for a single staff member — the only
 * sanctioned way to move an existing production account onto a Cloudflare
 * Workers-compatible PBKDF2 hash.
 *
 * Production hashes created previously used 210000 iterations. Cloudflare
 * Workers' Web Crypto refuses PBKDF2 iteration counts above 100000
 * (NotSupportedError), so such accounts can no longer sign in on the deployed
 * Worker. This script rehashes ONE staff member's password at exactly 100000
 * iterations and updates ONLY that row — nothing else is touched or seeded.
 *
 * Safety properties:
 *   - Requires CONFIRM_PRODUCTION_PASSWORD_RESET=YES (fail-closed otherwise).
 *   - Refuses to run against the development branch (packages/db/.env).
 *   - Aborts on zero or more than one matching staff member.
 *   - Writes only password_hash. status, roles, name, phone and every other
 *     column are preserved.
 *   - Never prints the password and never prints the database URL (only a
 *     redacted host + database name).
 *   - Does not create permissions, roles, sessions, or any other data.
 *
 * Usage (PowerShell):
 *   $env:PRODUCTION_DATABASE_URL='postgres://user:pass@host/db' ; `
 *   $env:ADMIN_EMAIL='ahmad@likehoney.com' ; `
 *   $env:ADMIN_PASSWORD='<new password>' ; `
 *   $env:CONFIRM_PRODUCTION_PASSWORD_RESET='YES' ; `
 *   pnpm --filter @likehoney/db db:reset:admin-password
 *
 * Do not run this casually. It is a one-time compatibility migration for
 * production accounts whose pre-100k hashes cannot be verified on Workers.
 */
import fs from 'node:fs'
import { neon } from '@neondatabase/serverless'

const PBKDF2_ITERATIONS = 100_000
const SALT_BYTES = 16
const KEY_BYTES = 32
const PREFIX = 'pbkdf2'

const url = process.env.PRODUCTION_DATABASE_URL?.trim()
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
const password = process.env.ADMIN_PASSWORD
const confirm = process.env.CONFIRM_PRODUCTION_PASSWORD_RESET?.trim()

if (!url) throw new Error('PRODUCTION_DATABASE_URL is required')
if (!email) throw new Error('ADMIN_EMAIL is required')
if (!password) throw new Error('ADMIN_PASSWORD is required')
if (password.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters')
if (confirm !== 'YES') {
  throw new Error('CONFIRM_PRODUCTION_PASSWORD_RESET must be exactly "YES" to run')
}

let parsedUrl
try {
  parsedUrl = new URL(url)
} catch {
  throw new Error('PRODUCTION_DATABASE_URL is not a valid URL')
}

// Fail closed against the development branch (must never rehash a dev account).
const envPath = new URL('../.env', import.meta.url)
if (fs.existsSync(envPath)) {
  const devUrl = fs
    .readFileSync(envPath, 'utf8')
    .match(/^DATABASE_URL=(.+)$/m)?.[1]
    ?.trim()
  if (devUrl && devUrl === url) {
    throw new Error('PRODUCTION_DATABASE_URL matches the development branch — refusing')
  }
}

const target = `${parsedUrl.host}${parsedUrl.pathname}`

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

const sql = neon(url)

const rows = await sql`SELECT id, status FROM staff_users WHERE lower(email) = lower(${email})`
if (rows.length === 0) {
  throw new Error(`No staff member found with email ${email} — nothing changed`)
}
if (rows.length > 1) {
  throw new Error(`Multiple staff members share email ${email} — aborting, nothing changed`)
}
const { id } = rows[0]

const passwordHash = await hashPassword(password)
const updated =
  await sql`UPDATE staff_users SET password_hash = ${passwordHash} WHERE id = ${id} RETURNING id`
if (updated.length !== 1) {
  throw new Error('UPDATE did not affect exactly one row — aborting, nothing changed')
}

console.log(`Password reset for ${email} (id ${id.slice(0, 8)}…) on ${target}`)
console.log(`PBKDF2-SHA256 @ ${PBKDF2_ITERATIONS} iterations (Cloudflare Workers compatible)`)
console.log('Password not printed.')
