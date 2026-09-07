/**
 * Regression tests for the forced `must_change_password` removal.
 *
 * After the cleanup the signed-in staff document (`/auth/me`, login payload)
 * and `loginService` must never reference a forced password change, and a
 * legacy `must_change_password` column value (still present in the database
 * until the drop migration runs) must have ZERO effect on sign-in behavior.
 * `setStaffPassword` (admin reset + voluntary change flows) must no longer
 * write that column either.
 *
 * Pure unit tests through a fake `DbClient` — no real Postgres. The fake
 * reproduces the exact query shapes the auth path uses
 * (`select().from().where().limit()`, `select()/selectDistinct().from().where()`,
 * `update().set().where().returning()`, `insert().values().returning()`).
 *
 * Run:  node --import tsx --test src/services/auth.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { staffRoles, staffUsers, type DbClient, type StaffUserRow } from '@likehoney/db'
import { UnauthorizedError } from '@likehoney/shared'

import { authMePayload, loginService, setStaffPassword } from './auth'
import { hashPassword } from './password'

interface FakeAuthDbOptions {
  staff?: StaffUserRow
  staffByIdentifier?: StaffUserRow
  roleIds?: string[]
  permissionCodes?: string[]
}

/** A minimal chainable fake covering the four query shapes the auth path uses. */
function fakeAuthDb(opts: FakeAuthDbOptions): { db: DbClient; writes: Record<string, unknown>[] } {
  const writes: Record<string, unknown>[] = []
  let currentTable: unknown = null
  let distinct = false

  const rows = (): Promise<unknown[]> => {
    if (currentTable === staffUsers) {
      const staff = opts.staffByIdentifier ?? opts.staff
      return Promise.resolve(staff ? [staff] : [])
    }
    if (currentTable === staffRoles) {
      if (distinct) {
        return Promise.resolve((opts.permissionCodes ?? []).map((code) => ({ code })))
      }
      return Promise.resolve((opts.roleIds ?? []).map((roleId) => ({ roleId })))
    }
    return Promise.resolve([])
  }

  const db = {
    select: () => {
      distinct = false
      return db
    },
    selectDistinct: () => {
      distinct = true
      return db
    },
    from: (table: unknown) => {
      currentTable = table
      return db
    },
    innerJoin: () => db,
    where: () => {
      // Identifier/id lookups continue with `.limit(1)`; role/permission
      // lookups are awaited directly.
      if (currentTable === staffUsers) {
        return { ...db, limit: () => rows() }
      }
      return rows()
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            writes.push(values)
            return Promise.resolve([{ id: 'staff-1' }])
          },
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          writes.push(values)
          return Promise.resolve([{ id: 'session-1' }])
        },
      }),
    }),
  }

  return { db: db as unknown as DbClient, writes }
}

async function staffRow(overrides?: Partial<StaffUserRow>): Promise<StaffUserRow> {
  return {
    id: 'staff-1',
    nameAr: 'أحمد',
    nameEn: 'Ahmad',
    email: 'ahmad@likehoney.com',
    phoneNormalized: '+970599000000',
    status: 'active',
    passwordHash: await hashPassword('correct-password-123'),
    lastLoginAt: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as StaffUserRow
}

test('a normal active Admin logs in with the correct password (no forced change involved)', async () => {
  const { db } = fakeAuthDb({ staffByIdentifier: await staffRow() })

  const result = await loginService(db, 'ahmad@likehoney.com', 'correct-password-123', {
    env: {},
    ip: null,
    userAgent: null,
  })

  assert.equal(result.staff.id, 'staff-1')
  assert.ok(result.token.length > 0, 'a bearer token must be issued')
  assert.equal(
    'mustChangePassword' in result,
    false,
    'the login result must not carry a forced-change flag',
  )
  assert.equal('must_change_password' in result, false)
})

test('a legacy must_change_password=true row still logs in normally (column value does not affect behavior)', async () => {
  const stale = await staffRow()
  // Simulates a row where the (pre-migration) column is still set — the app
  // no longer reads it, so sign-in must be unaffected.
  ;(stale as unknown as Record<string, unknown>).mustChangePassword = true

  const { db } = fakeAuthDb({ staffByIdentifier: stale })

  const result = await loginService(db, 'ahmad@likehoney.com', 'correct-password-123', {
    env: {},
    ip: null,
    userAgent: null,
  })

  assert.equal(result.staff.id, 'staff-1')
  assert.equal('mustChangePassword' in result, false)
})

test('an inactive staff member cannot log in even with the correct password', async () => {
  const { db } = fakeAuthDb({ staffByIdentifier: await staffRow({ status: 'inactive' }) })

  await assert.rejects(
    () =>
      loginService(db, 'ahmad@likehoney.com', 'correct-password-123', {
        env: {},
        ip: null,
        userAgent: null,
      }),
    (err: unknown) => err instanceof UnauthorizedError && err.status === 401,
  )
})

test('a wrong password still fails with the same generic UnauthorizedError', async () => {
  const { db } = fakeAuthDb({ staffByIdentifier: await staffRow() })

  await assert.rejects(
    () =>
      loginService(db, 'ahmad@likehoney.com', 'wrong-password', {
        env: {},
        ip: null,
        userAgent: null,
      }),
    (err: unknown) => err instanceof UnauthorizedError && err.status === 401,
  )
})

test('authMePayload exposes identity + permissions + roleIds and never a forced-change field', async () => {
  const { db } = fakeAuthDb({
    staff: await staffRow(),
    roleIds: ['role-owner'],
    permissionCodes: ['catalog:read', 'staff:write'],
  })

  const payload = await authMePayload(db, 'staff-1')

  assert.equal(payload.staff.id, 'staff-1')
  assert.equal(payload.staff.nameAr, 'أحمد')
  assert.equal(payload.staff.status, 'active')
  assert.deepEqual(payload.permissions, ['catalog:read', 'staff:write'])
  assert.deepEqual(payload.roleIds, ['role-owner'])
  assert.equal('mustChangePassword' in payload.staff, false)
  assert.equal('must_change_password' in payload.staff, false)
})

test('setStaffPassword writes the hash and never a forced-change column', async () => {
  const { db, writes } = fakeAuthDb({ staff: await staffRow() })

  await setStaffPassword(db, 'staff-1', 'brand-new-password-456')

  const staffWrite = writes.find((w) => typeof w.passwordHash === 'string')
  assert.ok(staffWrite, 'a staff password write must have occurred')
  assert.equal('mustChangePassword' in staffWrite!, false)
  assert.equal('must_change_password' in staffWrite!, false)
  const parts = staffWrite!.passwordHash as string
  assert.equal(parts.split('$')[0], 'pbkdf2')
})
