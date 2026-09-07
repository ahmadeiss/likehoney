/**
 * Gate C completion — acquisition cost, at the service seam.
 *
 * Hand-built fake `DbClient`s (same style as `admin-orders.test.ts`) — no
 * real Postgres. RBAC boundaries + snapshot immutability are proven LIVE
 * against b4-development (see the final report); these guard the pieces that
 * are pure logic:
 *
 *  - `updateVariantService` forwards `acquisitionCostMinor` to the repo
 *    EXACTLY as received (absent → untouched, `null` → cleared, `0` → an
 *    explicit zero) — never coalesced (§7/§8).
 *  - a cost update touches `product_variants` ONLY — never `order_items` or
 *    `store_sale_items` (historical `unit_cost_snapshot` is immutable, §7).
 *  - `bulkVariantCostService` fans out over the canonical per-variant update
 *    with a per-row audit — no bulk SQL UPDATE (§9).
 *
 * Run:  node --test src/services/gate-c-cost.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DbClient } from '@likehoney/db'

import { auditActor } from './audit'
import { bulkVariantCostService, updateVariantService } from './products'

/** A fake DB that records every UPDATE's table + set-payload and rejects any
 *  write to a table other than `product_variants`. */
function fakeVariantDb(existingVariant: Record<string, unknown>) {
  const updates: { table: string; set: Record<string, unknown> }[] = []
  const chain = (table: string) => ({
    set(values: Record<string, unknown>) {
      if (table !== 'product_variants') {
        throw new Error(
          `unexpected UPDATE on ${table} — a cost change must touch product_variants only`,
        )
      }
      updates.push({ table, set: values })
      return {
        where: () => ({
          returning: () => Promise.resolve([{ ...existingVariant, ...values }]),
        }),
      }
    },
  })
  const db = {
    updates,
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([existingVariant]) }) }),
    }),
    update: (tbl: unknown) => {
      // Drizzle passes the table object; our fake tags it by a well-known name.
      const name =
        tbl && typeof tbl === 'object' && '_' in tbl
          ? String((tbl as { _: { name?: string } })._.name ?? 'unknown')
          : 'product_variants'
      return chain(name)
    },
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{}]),
        onConflictDoNothing: () => Promise.resolve(),
      }),
    }),
  }
  return db as unknown as DbClient & { updates: typeof updates }
}

const VARIANT = {
  id: 'v1',
  sku: 'LH-X-1',
  status: 'active',
  priceMinor: 3500,
  acquisitionCostMinor: 1000,
}

test('§8 an explicit cost is written through unchanged', async () => {
  const db = fakeVariantDb(VARIANT)
  await updateVariantService(db, 'v1', { acquisitionCostMinor: 1800 }, auditActor(undefined))
  const costWrites = db.updates.filter((u) => 'acquisitionCostMinor' in u.set)
  assert.equal(costWrites.length, 1)
  assert.equal(costWrites[0]!.set.acquisitionCostMinor, 1800)
})

test('§8 an explicit ZERO cost is preserved, not treated as absence', async () => {
  const db = fakeVariantDb(VARIANT)
  await updateVariantService(db, 'v1', { acquisitionCostMinor: 0 }, auditActor(undefined))
  const write = db.updates.find((u) => 'acquisitionCostMinor' in u.set)
  assert.ok(write)
  assert.equal(write!.set.acquisitionCostMinor, 0)
})

test('§8 null clears cost to "unknown" — never coerced to 0', async () => {
  const db = fakeVariantDb(VARIANT)
  await updateVariantService(db, 'v1', { acquisitionCostMinor: null }, auditActor(undefined))
  const write = db.updates.find((u) => 'acquisitionCostMinor' in u.set)
  assert.ok(write)
  assert.equal(write!.set.acquisitionCostMinor, null)
})

test('§7 a price-only update never carries an acquisitionCostMinor key', async () => {
  const db = fakeVariantDb(VARIANT)
  await updateVariantService(db, 'v1', { priceMinor: 4000 }, auditActor(undefined))
  const write = db.updates[0]!
  assert.equal(write.set.priceMinor, 4000)
  assert.equal(write.set.acquisitionCostMinor, undefined)
})

test('§7 a cost update only ever UPDATEs product_variants (no snapshot tables)', async () => {
  const db = fakeVariantDb(VARIANT)
  await updateVariantService(db, 'v1', { acquisitionCostMinor: 900 }, auditActor(undefined))
  for (const u of db.updates) assert.equal(u.table, 'product_variants')
})

test('§9 bulkVariantCostService fans out over per-variant updates (no bulk SQL)', async () => {
  const variants = [
    { id: 'a', sku: 's-a', status: 'active', priceMinor: 100, acquisitionCostMinor: null },
    { id: 'b', sku: 's-b', status: 'active', priceMinor: 200, acquisitionCostMinor: null },
    { id: 'c', sku: 's-c', status: 'active', priceMinor: 300, acquisitionCostMinor: null },
  ]
  const updated: string[] = []
  const auditRows: string[] = []
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ id: 'p1' }]),
          orderBy: () => Promise.resolve(variants),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => {
            updated.push('u')
            return Promise.resolve([{ id: `v${updated.length}`, acquisitionCostMinor: 500 }])
          },
        }),
      }),
    }),
    insert: () => ({
      values: () => {
        auditRows.push('a')
        return { returning: () => Promise.resolve([{}]) }
      },
    }),
  } as unknown as DbClient

  const res = await bulkVariantCostService(
    db,
    'p1',
    { acquisitionCostMinor: 500 },
    auditActor(undefined),
  )
  assert.equal(res.updatedCount, 3)
  assert.equal(updated.length, 3, 'one UPDATE per variant, not a single bulk statement')
  assert.equal(auditRows.length, 3, 'one audit row per variant')
})
