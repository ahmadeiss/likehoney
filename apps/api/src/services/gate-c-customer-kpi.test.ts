/**
 * Gate C — period customer KPI semantics (final fix).
 *
 * The owner-facing model keeps NEW and REPEAT PURCHASER independent, and the
 * "returned from a previous period" cohort separate from both. Customer-link
 * coverage makes anonymous / historical unlinked transactions visible instead
 * of silently shrinking the customer count.
 *
 * The classification / rate / coverage math is pure (`@likehoney/shared`) and
 * tested directly here. The two predicates that live only in SQL — completed
 * status filtering (D) and anonymous-POS exclusion (G) — are asserted against
 * the captured `getWindowCustomers` / `getCustomerLinkCoverage` statements.
 *
 * Run:  node --test src/services/gate-c-customer-kpi.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  classifyPeriodCustomer,
  customerLinkCoverage,
  repeatPurchaserRatePct,
} from '@likehoney/shared'
import { getCustomerLinkCoverage, getWindowCustomers, type DbClient } from '@likehoney/db'

const PERIOD_START = Date.parse('2026-09-01T00:00:00Z')

// --- A: first + second purchase both inside the selected period -------------

test('A — first AND second purchase inside the period → new = true, repeat purchaser = true', () => {
  const c = classifyPeriodCustomer({
    firstCompletedAtMs: Date.parse('2026-09-02T10:00:00Z'),
    completedCountThroughPeriodEnd: 2, // 2026-09-02 + 2026-09-04
    periodStartMs: PERIOD_START,
  })
  assert.equal(c.isNew, true)
  assert.equal(c.isRepeatPurchaser, true)
  assert.equal(c.isReturnedFromPreviousPeriod, false)
})

// --- B: purchased before the period + once inside it -----------------------

test('B — purchased before the period + once inside → new = false, repeat purchaser = true', () => {
  const c = classifyPeriodCustomer({
    firstCompletedAtMs: Date.parse('2026-07-15T10:00:00Z'),
    completedCountThroughPeriodEnd: 2,
    periodStartMs: PERIOD_START,
  })
  assert.equal(c.isNew, false)
  assert.equal(c.isRepeatPurchaser, true)
  assert.equal(c.isReturnedFromPreviousPeriod, true)
})

// --- C: exactly one completed purchase ever, inside the period ------------

test('C — exactly one completed purchase ever, inside the period → new = true, repeat purchaser = false', () => {
  const c = classifyPeriodCustomer({
    firstCompletedAtMs: Date.parse('2026-09-10T10:00:00Z'),
    completedCountThroughPeriodEnd: 1,
    periodStartMs: PERIOD_START,
  })
  assert.equal(c.isNew, true)
  assert.equal(c.isRepeatPurchaser, false)
  assert.equal(c.isReturnedFromPreviousPeriod, false)
})

// --- D: pending / cancelled never produce repeat status ------------------

test("D — getWindowCustomers only ever counts status = 'completed' orders", async () => {
  const { db, executed } = captureExecute()
  await getWindowCustomers(db, new Date('2026-09-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'))
  const sql = executed.join('\n')
  // every orders reference is completed-only — no pending/cancelled slips in
  assert.ok(sql.includes("o.status = 'completed'"))
  assert.equal(sql.includes("status = 'pending'"), false)
  assert.equal(sql.includes("status = 'cancelled'"), false)
  // repeat purchaser is a >= 2 count to the END of the window
  assert.ok(sql.includes('completed_total_to_end >= 2'))
})

// --- E: 3 purchasing customers, one repeat purchaser → 33.3% ------------

test('E — repeat-purchase rate is repeatPurchasers / purchasing, one decimal (1 / 3 = 33.3%)', () => {
  assert.equal(repeatPurchaserRatePct(1, 3), 33.3)
  assert.equal(repeatPurchaserRatePct(0, 3), 0)
  assert.equal(repeatPurchaserRatePct(3, 3), 100)
  assert.equal(repeatPurchaserRatePct(1, 0), 0) // never divides by zero
})

// --- F: customer-link coverage 5 / 27 -----------------------------------

test('F — link coverage: 5 linked of 27 completed → 22 unlinked, 18.5%', () => {
  const cov = customerLinkCoverage({
    completedTransactionsTotal: 27,
    completedTransactionsLinked: 5,
  })
  assert.equal(cov.completedTransactionsWithoutCustomer, 22)
  assert.equal(cov.customerLinkCoveragePct, 18.5)
})

test('F.1 — link coverage clamps impossible inputs and never divides by zero', () => {
  assert.equal(
    customerLinkCoverage({ completedTransactionsTotal: 0, completedTransactionsLinked: 0 })
      .customerLinkCoveragePct,
    0,
  )
  // linked can never exceed total
  const cov = customerLinkCoverage({
    completedTransactionsTotal: 4,
    completedTransactionsLinked: 9,
  })
  assert.equal(cov.completedTransactionsWithoutCustomer, 0)
  assert.equal(cov.customerLinkCoveragePct, 100)
})

// --- G: anonymous store sale — total up, unique customers unchanged -----

test('G — anonymous POS sales are excluded from the customer count but counted in link coverage', async () => {
  const win = captureExecute()
  await getWindowCustomers(
    win.db,
    new Date('2026-09-01T00:00:00Z'),
    new Date('2026-10-01T00:00:00Z'),
  )
  // the "active customers" store CTE requires a real customer_id
  assert.ok(win.executed.join('\n').includes('s.customer_id is not null'))

  const cvg = captureExecute()
  await getCustomerLinkCoverage(
    cvg.db,
    new Date('2026-09-01T00:00:00Z'),
    new Date('2026-10-01T00:00:00Z'),
  )
  const sql = cvg.executed.join('\n')
  // link coverage counts EVERY store sale in the window (linked or not)…
  assert.ok(sql.includes('from store_sales s'))
  // …and splits them by whether a customer id is present
  assert.ok(sql.includes("ch = 'store' and cid is not null"))
  assert.ok(sql.includes("ch = 'store' and cid is null"))
  assert.ok(sql.includes("ch = 'online' and cid is null"))
})

// ---------------------------------------------------------------------------

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

function captureExecute() {
  const executed: string[] = []
  const db = {
    execute(node: unknown) {
      executed.push(flattenSql(node))
      return Promise.resolve({ rows: [{}] })
    },
  } as unknown as DbClient
  return { db, executed }
}
