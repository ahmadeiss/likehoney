/**
 * Gate C final — server-side directory + stagnation filters.
 *
 * `getStagnant`'s category/supplier narrowing is pure JS over the fetched
 * rows — tested directly with a fake DB. `listCustomers`'s channel /
 * new-returning / inactivity filters are SQL predicates — captured from the
 * executed statement and asserted (the same style as `resolveCustomerByPhone`'s
 * upsert-shape test). All seven combinations plus composition are also
 * proven LIVE against b4-development (see the final report).
 *
 * Run:  node --test src/services/gate-c-directory-filters.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  categories,
  getStagnant,
  getSupplierProductBreakdown,
  listCustomers,
  productVariants,
  suppliers,
  type DbClient,
} from '@likehoney/db'

// ---------------------------------------------------------------------------
// getStagnant — category / supplier filters (§1)
// ---------------------------------------------------------------------------

const FROM = new Date('2026-09-01T00:00:00Z')
const TO = new Date('2026-10-01T00:00:00Z')

/**
 * Fake DB for `getStagnant`: the main variant query resolves canned rows;
 * the category/supplier name lookups resolve their canned rows.
 */
function fakeStagnantDb(variantRows: Record<string, unknown>[]) {
  let lastTable: unknown = null
  const chain = {
    from(tbl: unknown) {
      lastTable = tbl
      return chain
    },
    innerJoin: () => chain,
    leftJoin: () => chain,
    where() {
      if (lastTable === productVariants) return Promise.resolve(variantRows)
      if (lastTable === categories)
        return Promise.resolve([
          { id: 'cat-shoes', ar: 'أحذية', en: 'Shoes' },
          { id: 'cat-bags', ar: 'حقائب', en: 'Bags' },
        ])
      if (lastTable === suppliers)
        return Promise.resolve([
          { id: 'sup-a', ar: 'المورد أ', en: 'Supplier A' },
          { id: 'sup-b', ar: 'المورد ب', en: 'Supplier B' },
        ])
      return Promise.resolve([])
    },
  }
  return { select: () => chain } as unknown as DbClient
}

const variantRow = (id: string, over: Record<string, unknown> = {}) => ({
  variantId: `v-${id}`,
  sku: `SKU-${id}`,
  cost: null,
  productId: 'p1',
  catId: 'cat-shoes',
  supId: 'sup-a',
  ar: 'منتج',
  en: 'Product',
  available: '5',
  soldInWindow: '0', // never sold in window → stagnant candidate
  lastSoldAt: null,
  ...over,
})

const baseFilter = {
  stagnantDays: 30,
  withStockOnly: true,
  neverSoldOnly: false,
  limit: 50,
}

test('§1 stagnation CATEGORY filter keeps only variants of that category', async () => {
  const db = fakeStagnantDb([
    variantRow('1', { catId: 'cat-shoes' }),
    variantRow('2', { catId: 'cat-bags' }),
  ])
  const rows = await getStagnant(db, FROM, TO, { ...baseFilter, categoryId: 'cat-shoes' })
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.variantId, 'v-1')
  assert.equal(rows[0]!.categoryNameEn, 'Shoes')
})

test('§1 stagnation SUPPLIER filter keeps only variants of that supplier', async () => {
  const db = fakeStagnantDb([
    variantRow('1', { supId: 'sup-a' }),
    variantRow('2', { supId: 'sup-b' }),
  ])
  const rows = await getStagnant(db, FROM, TO, { ...baseFilter, supplierId: 'sup-b' })
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.variantId, 'v-2')
  assert.equal(rows[0]!.supplierNameEn, 'Supplier B')
})

test('§1 category + supplier compose (both must match)', async () => {
  const db = fakeStagnantDb([
    variantRow('1', { catId: 'cat-shoes', supId: 'sup-a' }),
    variantRow('2', { catId: 'cat-shoes', supId: 'sup-b' }),
    variantRow('3', { catId: 'cat-bags', supId: 'sup-a' }),
  ])
  const rows = await getStagnant(db, FROM, TO, {
    ...baseFilter,
    categoryId: 'cat-shoes',
    supplierId: 'sup-a',
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.variantId, 'v-1')
})

// ---------------------------------------------------------------------------
// listCustomers — channel / type / inactivity SQL predicates (§2)
// ---------------------------------------------------------------------------

/** Recursively render a drizzle `SQL` object's static text (params are not
 *  needed — the predicates we assert on are all literal SQL). */
function flattenSql(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  const o = node as { queryChunks?: unknown[]; value?: unknown }
  if (Array.isArray(o.queryChunks)) return o.queryChunks.map(flattenSql).join(' ')
  if (Array.isArray(o.value)) return o.value.join('')
  if (o.value !== undefined && (typeof o.value === 'number' || typeof o.value === 'string')) {
    return String(o.value)
  }
  return ''
}

/** Captures every `db.execute(sql)` and returns canned rows. */
function fakeCustomerDb() {
  const executed: string[] = []
  const db = {
    execute(node: unknown) {
      executed.push(flattenSql(node))
      return Promise.resolve({ rows: [{ n: 0 }] })
    },
  } as unknown as DbClient & { executed: string[] }
  ;(db as unknown as { executed: string[] }).executed = executed
  return db as DbClient & { executed: string[] }
}

const baseQ = { page: 1, pageSize: 20 }

test('§2 channel=online builds an online-completed-only predicate', async () => {
  const db = fakeCustomerDb()
  await listCustomers(db, { ...baseQ, channel: 'online' })
  assert.ok(db.executed.some((s) => s.includes('a.online_completed > 0 AND a.store_count = 0')))
})

test('§2 channel=store builds a store-only predicate', async () => {
  const db = fakeCustomerDb()
  await listCustomers(db, { ...baseQ, channel: 'store' })
  assert.ok(db.executed.some((s) => s.includes('a.store_count > 0 AND a.online_completed = 0')))
})

test('§2 channel=both requires completed activity on BOTH channels', async () => {
  const db = fakeCustomerDb()
  await listCustomers(db, { ...baseQ, channel: 'both' })
  assert.ok(db.executed.some((s) => s.includes('a.online_completed > 0 AND a.store_count > 0')))
})

test('§2/§1 type classification — 0 → no_purchase, exactly 1 → new, ≥2 → returning (0 and 1 never merged)', async () => {
  const dbNo = fakeCustomerDb()
  await listCustomers(dbNo, { ...baseQ, type: 'no_purchase' })
  assert.ok(dbNo.executed.some((s) => s.includes('(a.online_completed + a.store_count) = 0')))

  const dbNew = fakeCustomerDb()
  await listCustomers(dbNew, { ...baseQ, type: 'new' })
  const newQ = dbNew.executed.find((s) => s.includes('ORDER BY c.last_seen_at'))!
  assert.ok(newQ.includes('(a.online_completed + a.store_count) = 1'))
  // new must NOT be "<= 1" (that would fold in the never-buyers)
  assert.ok(!newQ.includes('(a.online_completed + a.store_count) <= 1'))

  const dbRet = fakeCustomerDb()
  await listCustomers(dbRet, { ...baseQ, type: 'returning' })
  assert.ok(dbRet.executed.some((s) => s.includes('(a.online_completed + a.store_count) >= 2')))
})

test('§3 inactiveDays EXCLUDES never-buyers (last_completed_at IS NOT NULL AND < cutoff)', async () => {
  const db = fakeCustomerDb()
  await listCustomers(db, { ...baseQ, inactiveDays: 90 })
  const q = db.executed.find((s) => s.includes('ORDER BY c.last_seen_at'))!
  assert.ok(q.includes('a.last_completed_at IS NOT NULL AND a.last_completed_at <'))
  // the OLD misleading form must be gone
  assert.ok(!q.includes('a.last_completed_at IS NULL OR'))
  // the derived aggregate still counts COMPLETED online orders only
  assert.ok(db.executed.some((s) => s.includes("o.status = 'completed'")))
})

test('§2 filters compose — channel + type + inactivity + search + status in one statement', async () => {
  const db = fakeCustomerDb()
  await listCustomers(db, {
    ...baseQ,
    search: 'ليان',
    status: 'active',
    channel: 'both',
    type: 'returning',
    inactiveDays: 365,
  })
  const rowsQuery = db.executed.find((s) => s.includes('ORDER BY c.last_seen_at'))
  assert.ok(rowsQuery)
  assert.ok(rowsQuery!.includes('c.status ='))
  assert.ok(rowsQuery!.includes('ILIKE'))
  assert.ok(rowsQuery!.includes('a.online_completed > 0 AND a.store_count > 0'))
  assert.ok(rowsQuery!.includes('(a.online_completed + a.store_count) >= 2'))
  assert.ok(rowsQuery!.includes('a.last_completed_at IS NOT NULL AND a.last_completed_at <'))
  assert.ok(rowsQuery!.includes('LIMIT'))
  assert.ok(rowsQuery!.includes('OFFSET'))
})

test('§4 pagination is applied server-side (LIMIT + OFFSET) alongside the filters', async () => {
  const db = fakeCustomerDb()
  await listCustomers(db, { page: 2, pageSize: 20, channel: 'online', type: 'returning' })
  const rowsQuery = db.executed.find((s) => s.includes('ORDER BY c.last_seen_at'))!
  assert.ok(rowsQuery.includes('LIMIT'))
  assert.ok(rowsQuery.includes('OFFSET'))
  // the count query has NO limit/offset — it counts the full filtered set
  const countQuery = db.executed.find((s) => s.includes('SELECT count(*)::int'))!
  assert.ok(!countQuery.includes('LIMIT'))
  assert.ok(countQuery.includes('a.online_completed > 0 AND a.store_count = 0'))
})

// ---------------------------------------------------------------------------
// Supplier drilldown — historical (snapshot) vs current (relationship) (§6/§7)
// ---------------------------------------------------------------------------

function fakeDrilldownDb(rows: Record<string, unknown>[]) {
  const executed: string[] = []
  return {
    db: {
      // supplier name lookup
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ ar: 'مورد أ', en: 'Supplier A' }]) }),
        }),
      }),
      execute(node: unknown) {
        executed.push(flattenSql(node))
        return Promise.resolve({ rows })
      },
    } as unknown as DbClient,
    executed,
  }
}

test('§6/§7 the SQL guards current stock on the CURRENT product→supplier relationship', async () => {
  const { db, executed } = fakeDrilldownDb([])
  await getSupplierProductBreakdown(db, 'sup-A', new Date('2026-09-01'), new Date('2026-10-01'))
  const q = executed[0]!
  // historical attribution stays on the sale-time snapshot columns
  assert.ok(q.includes('supplier_id_snapshot'))
  // current stock only when the product is STILL this supplier's
  assert.ok(q.includes('p.supplier_id is not distinct from'))
  assert.ok(q.includes('currently_supplied'))
})

test('§7 a product still supplied by A → historical sales AND current stock under A', async () => {
  const { db } = fakeDrilldownDb([
    {
      vid: 'v1',
      sku: 'S1',
      ar: 'منتج',
      en: 'Product',
      units: 4,
      revenue: 31600,
      cogs: 16800,
      lines_total: 2,
      lines_covered: 2,
      currently_supplied: true,
      available: 17,
      last_sold_at: '2026-09-05T00:00:00Z',
    },
  ])
  const { rows } = await getSupplierProductBreakdown(
    db,
    'sup-A',
    new Date('2026-09-01'),
    new Date('2026-10-01'),
  )
  assert.equal(rows[0]!.unitsSold, 4)
  assert.equal(rows[0]!.revenueMinor, 31600)
  assert.equal(rows[0]!.currentlySupplied, true)
  assert.equal(rows[0]!.availableToSell, 17)
})

test('§7 a product that MOVED to supplier B → historical sales stay under A, current stock does NOT', async () => {
  const { db } = fakeDrilldownDb([
    {
      vid: 'v1',
      sku: 'S1',
      ar: 'منتج',
      en: 'Product',
      units: 4,
      revenue: 31600,
      cogs: 0,
      lines_total: 4,
      lines_covered: 0,
      currently_supplied: false, // product.supplier_id is now B
      available: 0, // SQL CASE forces 0 for a non-current supplier
      last_sold_at: '2026-01-05T00:00:00Z',
    },
  ])
  const { rows } = await getSupplierProductBreakdown(
    db,
    'sup-A',
    new Date('2026-09-01'),
    new Date('2026-10-01'),
  )
  // historical sales remain attributed to A
  assert.equal(rows[0]!.unitsSold, 4)
  assert.equal(rows[0]!.revenueMinor, 31600)
  // but current stock is NOT attributed to A
  assert.equal(rows[0]!.currentlySupplied, false)
  assert.equal(rows[0]!.availableToSell, 0)
})
