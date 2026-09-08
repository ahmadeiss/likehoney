/**
 * Development database ↔ application-code compatibility preflight.
 *
 *   pnpm --filter @likehoney/db db:runtime-check
 *
 * Fails LOUDLY (non-zero exit + a plain-language message) when the connected
 * database is BEHIND the code in this working tree — the exact drift that made
 * Products / Orders / Inventory throw `42703 column "quantity_reserved" does
 * not exist` after the B4 code landed while the runtime still pointed at a
 * pre-B4 Neon branch.
 *
 * It checks, in order:
 *   1. migration history — every committed migration in
 *      `drizzle/migrations/meta/_journal.json` is recorded in
 *      `drizzle.__drizzle_migrations`, in order, with a matching content hash.
 *   2. the concrete schema objects the current repositories query.
 *
 * It prints a SAFE identity marker only (host + database + migration count) —
 * never the password or the full connection URL. It is a read-only check: no
 * DDL, no writes, no `db:push`.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { neon } from '@neondatabase/serverless'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.join(HERE, '..', 'drizzle', 'migrations')

function urlFromEnvFile(p) {
  if (!p || !fs.existsSync(p)) return null
  const m = fs.readFileSync(p, 'utf8').match(/^﻿?DATABASE_URL=(.+)$/m)
  return m ? m[1].trim() : null
}

/**
 * Resolution order: `--env-file <path>` (the API's `.dev.vars`, so the
 * preflight checks the DB the running API will actually use) → `DATABASE_URL`
 * env → `packages/db/.env`.
 */
function readDatabaseUrl() {
  const flagIdx = process.argv.indexOf('--env-file')
  if (flagIdx !== -1 && process.argv[flagIdx + 1]) {
    const fromFlag = urlFromEnvFile(path.resolve(process.cwd(), process.argv[flagIdx + 1]))
    if (fromFlag) return fromFlag
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.length > 0) {
    return process.env.DATABASE_URL
  }
  return urlFromEnvFile(path.join(HERE, '..', '.env'))
}

function safeMarker(url) {
  try {
    const u = new URL(url)
    return { host: u.host, database: u.pathname.replace(/^\//, '') || '(default)' }
  } catch {
    return { host: '(unparseable)', database: '(unknown)' }
  }
}

/** drizzle-kit stores sha256 hex of the raw migration SQL file text. */
function expectedMigrations() {
  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
  )
  return journal.entries
    .sort((a, b) => a.idx - b.idx)
    .map((e) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, `${e.tag}.sql`), 'utf8')
      return { tag: e.tag, hash: crypto.createHash('sha256').update(sql).digest('hex') }
    })
}

const url = readDatabaseUrl()
if (!url) {
  console.error('db:runtime-check — no DATABASE_URL (env or packages/db/.env). Cannot verify.')
  process.exit(2)
}
const marker = safeMarker(url)
const sql = neon(url)

const problems = []

// --- 1. migration history --------------------------------------------------
let appliedCount = 0
const expected = expectedMigrations()
try {
  const rows = await sql`select hash, created_at from drizzle.__drizzle_migrations order by id`
  appliedCount = rows.length
  const appliedHashes = rows.map((r) => r.hash)
  for (let i = 0; i < expected.length; i += 1) {
    if (appliedHashes[i] === undefined) {
      problems.push(`migration not applied: ${expected[i].tag}`)
    } else if (appliedHashes[i] !== expected[i].hash) {
      problems.push(
        `migration hash mismatch at #${i + 1} (${expected[i].tag}) — DB has a different migration body`,
      )
    }
  }
  if (appliedHashes.length > expected.length) {
    problems.push(
      `database has ${appliedHashes.length} migrations but the code only ships ${expected.length} — the DB is AHEAD of this working tree`,
    )
  }
} catch (err) {
  problems.push(
    `cannot read drizzle.__drizzle_migrations (${err.code || err.message}) — has ANY migration been applied to this database?`,
  )
}

// --- 2. concrete B4 schema objects the repositories query -----------------
async function columnExists(table, column) {
  const r =
    await sql`select 1 from information_schema.columns where table_schema='public' and table_name=${table} and column_name=${column} limit 1`
  return r.length > 0
}
async function tableExists(table) {
  const r =
    await sql`select 1 from information_schema.tables where table_schema='public' and table_name=${table} limit 1`
  return r.length > 0
}
async function enumHas(typeName, value) {
  const r = await sql`select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = ${typeName} and e.enumlabel = ${value} limit 1`
  return r.length > 0
}

const objectChecks = [
  [
    'column inventory_balances.quantity_reserved',
    () => columnExists('inventory_balances', 'quantity_reserved'),
  ],
  ['column orders.cancellation_source', () => columnExists('orders', 'cancellation_source')],
  ['table payments', () => tableExists('payments')],
  ['table payment_events', () => tableExists('payment_events')],
  ['table stock_reservations', () => tableExists('stock_reservations')],
  ["enum payment_method → 'electronic'", () => enumHas('payment_method', 'electronic')],
  ["enum payment_status → 'pending'", () => enumHas('payment_status', 'pending')],
  ["enum payment_status → 'expired'", () => enumHas('payment_status', 'expired')],
  // Gate C (0013) — product detail / customer directory drift
  [
    'column product_variants.acquisition_cost_minor',
    () => columnExists('product_variants', 'acquisition_cost_minor'),
  ],
  ['column customers.status', () => columnExists('customers', 'status')],
  ['column customers.first_seen_at', () => columnExists('customers', 'first_seen_at')],
  ['column customers.last_seen_at', () => columnExists('customers', 'last_seen_at')],
  // Reviews Gate (0014)
  ['table store_reviews', () => tableExists('store_reviews')],
  ["enum review_status → 'pending'", () => enumHas('review_status', 'pending')],
  ["enum review_status → 'approved'", () => enumHas('review_status', 'approved')],
  ["enum review_status → 'rejected'", () => enumHas('review_status', 'rejected')],
]
for (const [label, fn] of objectChecks) {
  try {
    if (!(await fn())) problems.push(`missing ${label}`)
  } catch (err) {
    problems.push(`could not verify ${label} (${err.code || err.message})`)
  }
}

// --- report --------------------------------------------------------------
console.log('db:runtime-check')
console.log(`  host      : ${marker.host}`)
console.log(`  database  : ${marker.database}`)
console.log(
  `  migrations: ${appliedCount} applied / ${expected.length} expected (0000 → ${expected.at(-1)?.tag})`,
)

if (problems.length === 0) {
  console.log(
    `  status    : OK — database matches the application code (0000 → ${expected.at(-1)?.tag}).`,
  )
  process.exit(0)
}

console.error('\n  Database schema is behind the application.')
console.error('  Required migrations are not applied to this development database.\n')
for (const p of problems) console.error(`   - ${p}`)
console.error(
  '\n  Fix: point DATABASE_URL / apps/api/.dev.vars at the current development Neon branch',
)
console.error('  and run:  pnpm --filter @likehoney/db db:migrate')
process.exit(1)
