/**
 * DEVELOPMENT-ONLY first-Admin bootstrap.
 *
 * Creates (idempotently) the first real Admin account with a real password
 * supplied through the environment / inputs. It never prints the password and
 * never commits credentials. Everything targets the Development Neon branch
 * only — the script refuses to run against an unverified target.
 *
 * Required environment / inputs (values are read from process.env):
 *   ADMIN_NAME_AR        Arabic name (required)
 *   ADMIN_NAME_EN        English name (optional)
 *   ADMIN_EMAIL          login email (required, unique)
 *   ADMIN_PHONE          login phone in local 059.../international form (optional)
 *   ADMIN_PASSWORD       password to set (required, >= 8 chars)
 *
 * If a staff member that is already an Admin exists (any staff holding a
 * role that grants `staff:write`), the script is a no-op unless a matching
 * email already has a password set.
 *
 * Usage:
 *   $env:ADMIN_EMAIL=... ; $env:ADMIN_PASSWORD=... ; pnpm --filter @likehoney/db db:bootstrap:admin
 */
import fs from 'node:fs'
import { neon } from '@neondatabase/serverless'

import { ADMIN_ROLE_PERMISSIONS, PERMISSION_LABELS } from './rbac-defaults.mjs'

const envPath = new URL('../.env', import.meta.url)
if (!fs.existsSync(envPath)) throw new Error('packages/db/.env not found')
const m = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)
if (!m) throw new Error('DATABASE_URL missing from packages/db/.env — refusing to bootstrap')
const url = m[1].trim()
if (!/^postgres(ql)?:\/\/.+@.+\.neon\.tech\/likehoneydb/.test(url)) {
  throw new Error(
    'Target does not match the expected Development Neon branch — refusing to bootstrap',
  )
}

const sql = neon(url)
const q = (v) => `'${String(v).replace(/'/g, "''")}'`
const run = async (stmt) => await sql`${sql.unsafe(stmt)}`

const nameAr = process.env.ADMIN_NAME_AR?.trim()
const nameEn = process.env.ADMIN_NAME_EN?.trim() || null
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
const password = process.env.ADMIN_PASSWORD

if (!nameAr || !email || !password) {
  throw new Error('ADMIN_NAME_AR, ADMIN_EMAIL and ADMIN_PASSWORD are required (see script header)')
}
if (password.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters')

// `phone_normalized` is NOT NULL + unique. If none is supplied, synthesize a
// unique placeholder so sign-in still works via email.
let phone = process.env.ADMIN_PHONE?.trim() || null
if (!phone) {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(9)))
    .map((b) => b % 10)
    .join('')
  phone = `+970${rand}`
}

// PBKDF2-SHA256, exactly 100000 iterations (Cloudflare Workers rejects counts
// above 100000) — 16-byte salt, 32-byte key. Matches apps/api's canonical
// password.ts so hashes are interchangeable between bootstrap and runtime.
const PBKDF2_ITERATIONS = 100_000
const SALT_BYTES = 16
const KEY_BYTES = 32
const PREFIX = 'pbkdf2'

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

// --- Find/create an "admin" role that carries every production permission. ---
// Canonical mapping lives in ./rbac-defaults.mjs (single source of truth).
const ALL_PERMISSIONS = ADMIN_ROLE_PERMISSIONS

// Ensure every permission row exists (idempotent, order-independent).
await run(
  `INSERT INTO permissions (code, name_ar, name_en) VALUES
     ${ALL_PERMISSIONS.map((c) => `(${q(c)}, ${q(PERMISSION_LABELS[c][0])}, ${q(PERMISSION_LABELS[c][1])})`).join(',\n     ')}
   ON CONFLICT (code) DO NOTHING`,
)

const existingAdmin = await run(`SELECT r.id, r.code FROM roles r WHERE r.code = 'admin' LIMIT 1`)
let adminRoleId = existingAdmin[0]?.id ?? null
if (!adminRoleId) {
  const created = await run(
    `INSERT INTO roles (code, name_ar, name_en, description_ar, description_en)
     VALUES ('admin', 'مدير', 'Admin', 'مدير النظام الكامل', 'Full system administrator')
     RETURNING id`,
  )
  adminRoleId = created[0].id
}

// Ensure the admin role grants every permission.
await run(
  `INSERT INTO role_permissions (role_id, permission_id)
   SELECT ${q(adminRoleId)}, p.id FROM permissions p
   WHERE p.code IN (${ALL_PERMISSIONS.map(q).join(', ')})
   ON CONFLICT DO NOTHING`,
)

// --- Locate an existing staff member with this email. ---
const existing = await run(
  `SELECT id, name_ar, email, password_hash FROM staff_users WHERE email = ${q(email)} LIMIT 1`,
)
const staff = existing[0]

if (staff && staff.password_hash) {
  console.log(
    'An Admin with this email already exists and has a password set; nothing to do (idempotent).',
  )
  process.exit(0)
}

let staffId = staff?.id ?? null
if (!staffId) {
  const created = await run(
    `INSERT INTO staff_users (name_ar, name_en, email, phone_normalized)
     VALUES (${q(nameAr)}, ${q(nameEn)}, ${q(email)}, ${q(phone ?? '')})
     RETURNING id`,
  )
  staffId = created[0].id
} else {
  await run(
    `UPDATE staff_users SET name_ar = ${q(nameAr)}, name_en = ${q(nameEn)}, status = 'active'
     WHERE id = ${q(staffId)}`,
  )
}

const passwordHash = await hashPassword(password)
await run(
  `UPDATE staff_users SET password_hash = ${q(passwordHash)}, status = 'active' WHERE id = ${q(staffId)}`,
)

// Attach the admin role (idempotent).
await run(
  `INSERT INTO staff_roles (staff_id, role_id) VALUES (${q(staffId)}, ${q(adminRoleId)})
   ON CONFLICT DO NOTHING`,
)

console.log(
  `Bootstrapped Admin: ${nameAr}${nameEn ? ` (${nameEn})` : ''} <${email}> (id ${staffId.slice(0, 8)}…)`,
)
console.log('Password set (not printed). You can now sign in via the Admin login page.')
