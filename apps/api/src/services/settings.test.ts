/**
 * Regression tests for the delivery-zone PATCH default-value bug.
 *
 * Root cause: `deliveryZoneUpdateSchema` used to be
 * `deliveryZoneCreateSchema.partial()`. `.partial()` only relaxes
 * *requiredness* — every `.default(...)` on the create schema (`feeMinor`,
 * `isActive`, `displayOrder`) still fired for a field the caller omitted,
 * materializing that default into the parsed output. A PATCH sending only
 * `{ nameAr, nameEn }` therefore silently zeroed `feeMinor` (and would have
 * reset `isActive`/`displayOrder` too, on the exact same mechanism).
 *
 * `deliveryZoneUpdateSchema` is now a genuinely separate schema with plain
 * `.optional()` fields and no defaults, so an omitted field parses to
 * `undefined` — which `updateDeliveryZone`'s `db.update(...).set({...values})`
 * already skips (standard Drizzle behavior: `set()` only emits SQL for keys
 * actually present). §A-C below prove the schema-level contract directly
 * (the exact place the bug lived); §D-E prove the full service round-trip
 * through a fake `DbClient` in the same style as `admin-orders.test.ts` —
 * no real Postgres.
 *
 * Run:  node --import tsx --test src/services/settings.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { deliveryZoneUpdateSchema } from '@likehoney/shared'
import type { DbClient } from '@likehoney/db'

import { auditActor } from './audit'
import { updateDeliveryZoneService } from './settings'

// ---------------------------------------------------------------------------
// §A-C — schema-level: the exact contract that was broken
// ---------------------------------------------------------------------------

test('§A names-only PATCH parses without materializing feeMinor/isActive/displayOrder defaults', () => {
  const parsed = deliveryZoneUpdateSchema.parse({ nameAr: 'رام الله', nameEn: 'Ramallah' })
  assert.deepEqual(parsed, { nameAr: 'رام الله', nameEn: 'Ramallah' })
  assert.equal('feeMinor' in parsed, false)
  assert.equal('isActive' in parsed, false)
  assert.equal('displayOrder' in parsed, false)
})

test('§B fee-only PATCH parses without touching name fields', () => {
  const parsed = deliveryZoneUpdateSchema.parse({ feeMinor: 2500 })
  assert.deepEqual(parsed, { feeMinor: 2500 })
})

test('§C explicit feeMinor: 0 parses and survives — zero is a valid fee, never treated as absence', () => {
  const parsed = deliveryZoneUpdateSchema.parse({ feeMinor: 0 })
  assert.deepEqual(parsed, { feeMinor: 0 })
  assert.equal('feeMinor' in parsed, true)
})

test('§C.1 negative fee is rejected (existing domain constraint, unaffected by this fix)', () => {
  assert.throws(() => deliveryZoneUpdateSchema.parse({ feeMinor: -100 }))
})

test('empty object is rejected — at least one updatable field is required', () => {
  assert.throws(() => deliveryZoneUpdateSchema.parse({}))
})

// ---------------------------------------------------------------------------
// §D-E — full service round-trip through a fake DbClient (no real Postgres),
// same style as admin-orders.test.ts.
// ---------------------------------------------------------------------------

interface FakeZone {
  id: string
  code: string
  nameEn: string
  nameAr: string
  feeMinor: number
  isActive: boolean
  displayOrder: number
}

/** A minimal chainable fake covering exactly the three query shapes
 *  `getDeliveryZone`/`getDeliveryZoneByCode`/`updateDeliveryZone`/`writeAudit`
 *  use: `select().from().where().limit()`, `update().set().where().returning()`,
 *  `insert().values().returning()`. */
function fakeDb(zone: FakeZone): DbClient {
  const state = { ...zone }
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ ...state }]),
        }),
      }),
    }),
    update: () => ({
      // Mirrors real Drizzle: `.set()` only emits SQL for keys whose value
      // is actually present — an `undefined`-valued key (an omitted PATCH
      // field forwarded through, per `updateDeliveryZoneService`) must never
      // overwrite the existing column. This is the exact behavior the fix
      // depends on; the fake has to reproduce it faithfully or it would
      // "pass" by accident.
      set: (values: Partial<FakeZone>) => ({
        where: () => ({
          returning: () => {
            for (const [key, value] of Object.entries(values)) {
              if (value !== undefined) (state as Record<string, unknown>)[key] = value
            }
            return Promise.resolve([{ ...state }])
          },
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: 'audit-1' }]),
      }),
    }),
  }
  return db as unknown as DbClient
}

const actor = auditActor(undefined)

test('§D omitted-field service round-trip: PATCH names only leaves feeMinor untouched', async () => {
  const db = fakeDb({
    id: 'zone-1',
    code: 'RAM',
    nameEn: 'Old Zone',
    nameAr: 'منطقة قديمة',
    feeMinor: 2000,
    isActive: true,
    displayOrder: 0,
  })

  const input = deliveryZoneUpdateSchema.parse({ nameAr: 'رام الله', nameEn: 'Ramallah' })
  const updated = await updateDeliveryZoneService(db, 'zone-1', input, actor)

  assert.equal(updated.nameAr, 'رام الله')
  assert.equal(updated.nameEn, 'Ramallah')
  assert.equal(updated.feeMinor, 2000, 'feeMinor must survive a names-only PATCH')
  assert.equal(updated.isActive, true)
  assert.equal(updated.displayOrder, 0)
})

test('§E explicit-zero service round-trip: PATCH feeMinor: 0 actually sets it to 0', async () => {
  const db = fakeDb({
    id: 'zone-1',
    code: 'RAM',
    nameEn: 'Ramallah',
    nameAr: 'رام الله',
    feeMinor: 2000,
    isActive: true,
    displayOrder: 0,
  })

  const input = deliveryZoneUpdateSchema.parse({ feeMinor: 0 })
  const updated = await updateDeliveryZoneService(db, 'zone-1', input, actor)

  assert.equal(updated.feeMinor, 0, 'an explicit zero must be applied, not ignored')
  assert.equal(updated.nameAr, 'رام الله', 'names untouched by a fee-only PATCH')
  assert.equal(updated.nameEn, 'Ramallah')
})
