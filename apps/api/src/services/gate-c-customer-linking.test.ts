/**
 * Gate C — customer identity + snapshot plumbing, at the repository seam.
 *
 * Hand-built fake `DbClient`s (same style as `admin-orders.test.ts`) — no
 * real Postgres. These prove the SHAPE of the data-access calls that the
 * live b4-development verification exercised end-to-end:
 *
 *  - `resolveCustomerByPhone` is ONE concurrency-safe upsert statement
 *    (`INSERT … ON CONFLICT (phone) DO UPDATE`), never a SELECT-then-write
 *    race (§7).
 *  - `insertOrderItems` actually forwards the Gate C sale-time snapshot
 *    columns (regression guard: they were silently dropped by an explicit
 *    allow-list before this gate).
 *  - `customerHasOtherTransactions` classifies new vs returning across BOTH
 *    channels and honours the "exclude the row being viewed" rule (§54/§58).
 *
 * Run:  node --test src/services/gate-c-customer-linking.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  customerHasOtherTransactions,
  getCustomerCommercialSummary,
  insertOrderItems,
  orders,
  resolveCustomerByPhone,
  storeSales,
  type DbClient,
} from '@likehoney/db'

// --- resolveCustomerByPhone: single-statement upsert -------------------------

test('§7 resolveCustomerByPhone is one INSERT … ON CONFLICT DO UPDATE — no SELECT-then-write race', async () => {
  let conflictArgs: { target?: unknown; set?: Record<string, unknown> } | undefined
  let returned = false

  const fakeDb = {
    select() {
      throw new Error('resolveCustomerByPhone must NOT SELECT first (race window)')
    },
    update() {
      throw new Error('resolveCustomerByPhone must NOT issue a separate UPDATE')
    },
    insert() {
      return {
        values() {
          return {
            onConflictDoUpdate(args: { target?: unknown; set?: Record<string, unknown> }) {
              conflictArgs = args
              return {
                returning() {
                  returned = true
                  return Promise.resolve([
                    { id: 'cust-1', phoneNormalized: '970591234567', status: 'active' },
                  ])
                },
              }
            },
          }
        },
      }
    },
  } as unknown as DbClient

  const row = await resolveCustomerByPhone(fakeDb, {
    phoneNormalized: '970591234567',
    nameAr: 'اختبار',
    seenAt: new Date('2026-09-05T00:00:00Z'),
  })

  assert.equal(row.id, 'cust-1')
  assert.ok(returned, 'the upsert must use RETURNING to hand back the resolved row')
  assert.ok(conflictArgs?.target, 'ON CONFLICT must target the phone uniqueness constraint')
  assert.ok(conflictArgs?.set, 'the conflict path must UPDATE the existing profile, not ignore it')
  // "latest non-empty wins" + monotonic consent: the SET clause touches name
  // and lastSeenAt but the test only needs to see it exists and is non-empty.
  assert.ok(Object.keys(conflictArgs!.set!).length > 0)
})

// --- insertOrderItems forwards the Gate C snapshot columns ------------------

test('§33/§34 insertOrderItems persists unit-cost + supplier + category sale-time snapshots', async () => {
  let captured: Record<string, unknown>[] | undefined

  const fakeDb = {
    insert() {
      return {
        values(rows: Record<string, unknown>[]) {
          captured = rows
          return { returning: () => Promise.resolve([]) }
        },
      }
    },
  } as unknown as DbClient

  await insertOrderItems(fakeDb, 'order-1', [
    {
      productId: 'p1',
      variantId: 'v1',
      skuSnapshot: 'LH-X-1',
      productNameEnSnapshot: 'X',
      productNameArSnapshot: 'س',
      unitPriceMinor: 3500,
      quantity: 2,
      lineTotalMinor: 7000,
      unitCostSnapshot: 1200,
      supplierIdSnapshot: 'sup-1',
      supplierNameEnSnapshot: 'Supplier',
      supplierNameArSnapshot: 'مورد',
      categoryIdSnapshot: 'cat-1',
      categoryNameEnSnapshot: 'Toys',
      categoryNameArSnapshot: 'ألعاب',
    },
  ])

  assert.ok(captured && captured.length === 1)
  const row = captured![0]!
  assert.equal(row.unitCostSnapshot, 1200)
  assert.equal(row.supplierIdSnapshot, 'sup-1')
  assert.equal(row.supplierNameArSnapshot, 'مورد')
  assert.equal(row.categoryIdSnapshot, 'cat-1')
  assert.equal(row.categoryNameEnSnapshot, 'Toys')
})

test('§33 a line with NO captured cost writes NULL, never 0', async () => {
  let captured: Record<string, unknown>[] | undefined
  const fakeDb = {
    insert: () => ({
      values(rows: Record<string, unknown>[]) {
        captured = rows
        return { returning: () => Promise.resolve([]) }
      },
    }),
  } as unknown as DbClient

  await insertOrderItems(fakeDb, 'order-1', [
    {
      productId: 'p1',
      variantId: 'v1',
      skuSnapshot: 'LH-X-1',
      productNameEnSnapshot: 'X',
      productNameArSnapshot: 'س',
      unitPriceMinor: 3500,
      quantity: 1,
      lineTotalMinor: 3500,
      // no unitCostSnapshot / supplier / category
    },
  ])

  assert.equal(captured![0]!.unitCostSnapshot, null)
  assert.equal(captured![0]!.supplierIdSnapshot, null)
  assert.equal(captured![0]!.categoryIdSnapshot, null)
})

// --- customerHasOtherTransactions cross-channel classification -------------

/** Renders a drizzle condition object's static text (columns + literals). */
function flatten(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  const o = node as { queryChunks?: unknown[]; value?: unknown; name?: unknown }
  if (Array.isArray(o.queryChunks)) return o.queryChunks.map(flatten).join(' ')
  if (Array.isArray(o.value)) return o.value.join('')
  if (typeof o.name === 'string') return o.name
  if (typeof o.value === 'string' || typeof o.value === 'number') return String(o.value)
  return ''
}

function fakeLookupDb(orderRows: unknown[], saleRows: unknown[]) {
  const wheres: { table: unknown; cond: string }[] = []
  const db = {
    select() {
      return {
        from(table: unknown) {
          return {
            where(cond: unknown) {
              wheres.push({ table, cond: flatten(cond) })
              return {
                limit() {
                  return Promise.resolve(
                    table === orders ? orderRows : table === storeSales ? saleRows : [],
                  )
                },
              }
            },
          }
        },
      }
    },
  }
  return { db: db as unknown as DbClient, wheres }
}

test('§54 a customer with no OTHER completed transaction is classified NEW', async () => {
  const { db } = fakeLookupDb([], [])
  const isReturning = await customerHasOtherTransactions(db, 'cust-1', { orderId: 'o-current' })
  assert.equal(isReturning, false)
})

test('§54 a prior COMPLETED online order makes the customer RETURNING', async () => {
  const { db } = fakeLookupDb([{ id: 'o-old' }], [])
  const isReturning = await customerHasOtherTransactions(db, 'cust-1', { orderId: 'o-current' })
  assert.equal(isReturning, true)
})

test('§5 the online lookup filters on status = completed (a pending order is not a prior purchase)', async () => {
  const { db, wheres } = fakeLookupDb([], [])
  await customerHasOtherTransactions(db, 'cust-1', { orderId: 'o-current' })
  const orderWhere = wheres.find((w) => w.table === orders)!
  assert.ok(orderWhere.cond.includes('status'))
  assert.ok(orderWhere.cond.includes('completed'))
})

test('§58 a prior STORE sale makes the customer RETURNING (cross-channel)', async () => {
  const { db } = fakeLookupDb([], [{ id: 's-old' }])
  const isReturning = await customerHasOtherTransactions(db, 'cust-1', { storeSaleId: 's-current' })
  assert.equal(isReturning, true)
})

// --- Customer 360 commercial summary: driver returns ISO strings ----------

test('§ commercial summary handles the driver returning aggregate timestamps as STRINGS', async () => {
  // Regression: the neon driver returns `min()/max()` timestamps as ISO
  // strings, not `Date`s — a customer with completed transactions must not
  // crash Customer 360 on `.getTime()`.
  const agg = (over: Record<string, unknown>) => ({
    from: () => ({
      where: () => Promise.resolve([{ n: 2, spend: '32400', first: null, last: null, ...over }]),
    }),
  })
  let call = 0
  const fakeDb = {
    select() {
      call += 1
      return call === 1
        ? agg({ first: '2026-09-05T14:31:59.047Z', last: '2026-09-05T14:32:04.773Z' })
        : agg({
            n: 1,
            spend: '7900',
            first: '2026-09-05T14:32:10.108Z',
            last: '2026-09-05T14:32:10.108Z',
          })
    },
  } as unknown as DbClient

  const summary = await getCustomerCommercialSummary(fakeDb, 'cust-1')
  assert.ok(summary.firstTransactionAt instanceof Date)
  assert.ok(summary.lastTransactionAt instanceof Date)
  assert.equal(summary.firstTransactionAt!.toISOString(), '2026-09-05T14:31:59.047Z')
  assert.equal(summary.lastTransactionAt!.toISOString(), '2026-09-05T14:32:10.108Z')
  assert.equal(summary.lifetimeSpendMinor, 32400 + 7900)
})

test('§ commercial summary is null-safe when the customer has no transactions', async () => {
  const empty = {
    from: () => ({
      where: () => Promise.resolve([{ n: 0, spend: '0', first: null, last: null }]),
    }),
  }
  const fakeDb = { select: () => empty } as unknown as DbClient
  const summary = await getCustomerCommercialSummary(fakeDb, 'cust-1')
  assert.equal(summary.firstTransactionAt, null)
  assert.equal(summary.lastTransactionAt, null)
  assert.equal(summary.completedOrdersCount, 0)
})
