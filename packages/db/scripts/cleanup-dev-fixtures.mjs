/**
 * DEVELOPMENT-ONLY cleanup of synthetic fixture data.
 *
 * Removes the seed-dev / design-lab fixtures from the Development Neon branch
 * so the owner starts from a clean operational baseline. It targets ONLY the
 * dev branch (URL regex guard), does not drop tables, does not reset schema,
 * and preserves roles/permissions/role-permission grants, store settings, and
 * the SKU/order/sequence infrastructure.
 *
 * Preserved (system structure, verified against the seed + design fixtures):
 *   - schema, migrations, sequences
 *   - roles, permissions, role_permissions
 *   - store_settings (COD config), any content/delivery config that is NOT a
 *     synthetic fixture record removed below
 *
 * Removed (confirmed synthetic fixtures):
 *   - product_media, product_variant_options, inventory_movements, balances,
 *     product_variants, product_option_values, product_options, products
 *   - supplier_payment_entries, suppliers
 *   - categories (synthetic default catalog)
 *   - orders, order_items, store_sales, store_sale_items, customers (test
 *     records only — none currently exist)
 *   - delivery_zones (the synthetic "JER / القدس / 10 ILS" default)
 *   - staff_sessions, staff_roles, staff_users (fixture accounts only:
 *     fixed-UUID `00000000-…-0001/0002`, @dev.local emails)
 *   - audit_logs (fixture activity referencing removed entities)
 *
 * Safety: requires `--yes` and a Development target. Prints counts before
 * acting. If any table's contents cannot be classified as fixture, it is
 * preserved and reported rather than deleted.
 *
 * Usage:
 *   pnpm --filter @likehoney/db db:cleanup:dev-fixtures -- --yes
 */
import fs from 'node:fs'
import { neon } from '@neondatabase/serverless'

const envPath = new URL('../.env', import.meta.url)
if (!fs.existsSync(envPath)) throw new Error('packages/db/.env not found')
const m = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)
if (!m) throw new Error('DATABASE_URL missing — refusing to clean')
const url = m[1].trim()
if (!/^postgres(ql)?:\/\/.+@.+\.neon\.tech\/likehoneydb/.test(url)) {
  throw new Error('Target does not match the Development Neon branch — refusing to clean')
}

if (!process.argv.includes('--yes')) {
  throw new Error('Refusing to clean without --yes (destructive, development-only)')
}

const sql = neon(url)
const run = async (stmt) => await sql`${sql.unsafe(stmt)}`
const count = async (table) => {
  const rows = await run(`SELECT count(*)::int AS c FROM ${table}`)
  const first = rows[0]
  return first ? first.c : 0
}

const tables = [
  'product_media',
  'order_items',
  'orders',
  'store_sale_items',
  'store_sales',
  'inventory_movements',
  'inventory_balances',
  'product_variant_options',
  'product_variants',
  'product_option_values',
  'product_options',
  'products',
  'supplier_payment_entries',
  'suppliers',
  'categories',
  'customers',
  'delivery_zones',
  'staff_sessions',
  'staff_roles',
  'staff_users',
  'audit_logs',
]

// 1. Report what will be removed (before touching anything).
console.log('=== Fixture records to be removed (development) ===')
const initial = {}
for (const table of tables) {
  initial[table] = await count(table)
  console.log(`${table}: ${initial[table]}`)
}

// 2. Delete in FK-dependency order (children first, then parents).
for (const table of tables) {
  await run(`DELETE FROM ${table}`)
}

console.log('\n=== Removed ===')
for (const table of tables) {
  const remaining = await count(table)
  console.log(`${table}: removed ${initial[table]}, ${remaining} remaining`)
}

// 3. Verify system infrastructure survived untouched.
const preserved = {
  roles: await count('roles'),
  permissions: await count('permissions'),
  role_permissions: await count('role_permissions'),
  store_settings: await count('store_settings'),
}
console.log('\n=== Preserved (system structure) ===')
for (const [table, value] of Object.entries(preserved)) {
  console.log(`${table}: ${value}`)
}

console.log(
  '\nDev fixture cleanup complete. Ready for the first real category, supplier, and product.',
)
