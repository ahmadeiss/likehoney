/**
 * `getOrderStatusCounts` service seam — proves the status-counts aggregate maps
 * grouped rows into the exact four-bucket document (defaults to 0 for any
 * status with no orders). Pure/unit-level: a hand-built fake `DbClient`
 * standing in for Drizzle's query builder, no real Postgres (mirrors the
 * style of `admin-orders.test.ts`).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DbClient } from '@likehoney/db'

import { listOrderStatusCountsService } from './admin-orders'

function fakeDbWithCounts(rows: Array<{ status: string; n: number }>): DbClient {
  const chain = {
    from: () => ({
      groupBy: () => Promise.resolve(rows),
    }),
  }
  return {
    select: () => chain as never,
  } as unknown as DbClient
}

test('status counts maps grouped rows into the four-bucket document', async () => {
  const db = fakeDbWithCounts([
    { status: 'processing', n: 7 },
    { status: 'delivering', n: 3 },
    { status: 'completed', n: 41 },
    { status: 'cancelled', n: 12 },
  ])
  assert.deepEqual(await listOrderStatusCountsService(db), {
    processing: 7,
    delivering: 3,
    completed: 41,
    cancelled: 12,
  })
})

test('status counts defaults empty statuses to zero (partial aggregate)', async () => {
  const db = fakeDbWithCounts([{ status: 'processing', n: 5 }])
  assert.deepEqual(await listOrderStatusCountsService(db), {
    processing: 5,
    delivering: 0,
    completed: 0,
    cancelled: 0,
  })
})

test('status counts is all-zero for an empty table', async () => {
  const db = fakeDbWithCounts([])
  assert.deepEqual(await listOrderStatusCountsService(db), {
    processing: 0,
    delivering: 0,
    completed: 0,
    cancelled: 0,
  })
})
