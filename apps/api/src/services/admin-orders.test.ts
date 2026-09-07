/**
 * Final pre-provider correction — direct proof that the Admin fulfillment
 * commands reject a genuinely-pending electronic order. Pure/unit-level: a
 * hand-built fake `DbClient` standing in for Drizzle's query builder, no real
 * Postgres, no Worker runtime — mirrors the plain-object style already used
 * by `payments/registry.test.ts`.
 *
 * Why a fake DB here and not a live b4-development order: the public
 * checkout API cannot produce a genuinely-`pending` electronic order (the
 * provider-facing idempotency key is a hash of the checkout key, so the TEST
 * provider's magic-suffix scenario selector never reaches it) without
 * weakening that hash or adding a dev-only public scenario knob — both
 * explicitly out of scope. `startDeliveryService`/`completeOrderService`
 * only need an `OrderRow`-shaped object and a `db.transaction` that calls
 * back with a query-builder-shaped `tx` to exercise their real guard logic,
 * so a controlled fixture proves the same business rule without touching
 * provider internals or faking real data in b4-development.
 *
 * Run:  node --test src/services/admin-orders.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PaymentStateConflictError } from '@likehoney/shared'
import type { DbClient, OrderRow } from '@likehoney/db'

import { completeOrderService, startDeliveryService } from './admin-orders'

/**
 * A chainable stand-in for Drizzle's `db.select().from().where().limit()`
 * builder. Only `getOrderForUpdate`'s exact chain
 * (`select().from().where().limit(1).for('update')`) is exercised by the
 * guard-rejection path under test — `.for(...)` is the terminal call and
 * resolves the canned rows, matching how the real builder is awaited.
 */
function fakeSelectChain(rows: OrderRow[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    for: () => Promise.resolve(rows),
  }
  return chain
}

/**
 * A fake `DbClient` whose `update`/`insert` THROW if ever called — the
 * strongest possible proof that a rejected command attempts zero payment and
 * zero inventory mutation: any write at all (order transition, movement,
 * payment row) immediately fails the test loudly rather than silently
 * succeeding against a fake store.
 */
function fakeDbRejectingOrder(order: OrderRow): DbClient {
  const tx = {
    select: () => fakeSelectChain([order]),
    update: () => {
      throw new Error('unexpected UPDATE — this path must mutate nothing')
    },
    insert: () => {
      throw new Error('unexpected INSERT — this path must mutate nothing')
    },
  }
  return {
    transaction: async (cb: (tx: unknown) => unknown) => cb(tx),
  } as unknown as DbClient
}

function pendingElectronicOrder(status: 'processing' | 'delivering'): OrderRow {
  return {
    id: 'order-1',
    number: 'LH-000001',
    status,
    paymentMethod: 'electronic',
    paymentStatus: 'pending',
  } as unknown as OrderRow
}

test('startDeliveryService: electronic + processing + pending -> rejected, zero mutation', async () => {
  const order = pendingElectronicOrder('processing')
  const db = fakeDbRejectingOrder(order)

  await assert.rejects(
    () => startDeliveryService(db, order.id, 'staff-1'),
    (err: unknown) => {
      assert.ok(err instanceof PaymentStateConflictError)
      assert.equal(err.serviceCode, 'payment_state_conflict')
      return true
    },
  )

  // The fixture itself was never touched — the guard rejected before any
  // transition, movement, or payment write was attempted.
  assert.equal(order.status, 'processing')
  assert.equal(order.paymentStatus, 'pending')
})

test('completeOrderService: electronic + delivering + pending -> rejected, zero mutation', async () => {
  const order = pendingElectronicOrder('delivering')
  const db = fakeDbRejectingOrder(order)

  await assert.rejects(
    () => completeOrderService(db, order.id, 'staff-1'),
    (err: unknown) => {
      assert.ok(err instanceof PaymentStateConflictError)
      assert.equal(err.serviceCode, 'payment_state_conflict')
      return true
    },
  )

  assert.equal(order.status, 'delivering')
  assert.equal(order.paymentStatus, 'pending')
})
