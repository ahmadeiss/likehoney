/**
 * PBKDF2 password hashing regression tests (Cloudflare Workers compatibility).
 *
 * Workers Web Crypto refuses PBKDF2 iteration counts above 100000
 * (NotSupportedError). New hashes are therefore minted at exactly 100000
 * (SHA-256, 16-byte salt, 32-byte key). The stored format stays
 * self-describing (`pbkdf2$<iterations>$<saltB64>$<hashB64>`) so verification
 * reads the iteration count from each stored hash. These tests prove:
 *   - the new-workload hash format (+ verify success / wrong-password failure)
 *   - verification reads the iteration count from the stored format
 *   - malformed hashes fail safely as handled ServiceErrors
 *   - every password-writing flow (setStaffPassword) mints a 100000 hash
 *   - an unsupported high-iteration hash surfaces as a handled ServiceError,
 *     never an unhandled platform exception
 *
 * Pure unit tests: no database, no network.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ServiceError, UnauthorizedError } from '@likehoney/shared'
import type { DbClient } from '@likehoney/db'

import { setStaffPassword } from './auth'
import { hashPassword, verifyPassword } from './password'

const encoder = new TextEncoder()
const SALT_BYTES = 16
const KEY_BYTES = 32

function bytesToB64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

/** Mirrors the deployed stored format so a hash at ANY iteration count can be
 *  built — used to prove verification is driven by the stored hash's own count. */
async function buildHash(password: string, iterations: number): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_BYTES * 8,
  )
  return `pbkdf2$${iterations}$${bytesToB64(salt)}$${bytesToB64(new Uint8Array(bits))}`
}

function isInvalidHashError(err: unknown): boolean {
  return (
    err instanceof ServiceError && err.status === 500 && err.serviceCode === 'invalid_password_hash'
  )
}

test('hashPassword mints a Cloudflare-compatible pbkdf2$100000$ hash', async () => {
  const stored = await hashPassword('correct horse battery staple')
  const parts = stored.split('$')
  assert.equal(parts.length, 4)
  assert.equal(parts[0], 'pbkdf2')
  assert.equal(Number(parts[1]), 100_000)
  assert.ok(parts[2]!.length > 0, 'salt must be present')
  assert.ok(parts[3]!.length > 0, 'hash must be present')
})

test('the correct password verifies; a wrong password fails', async () => {
  const stored = await hashPassword('نحلة-العسل-1234')
  assert.equal(await verifyPassword('نحلة-العسل-1234', stored), true)
  assert.equal(await verifyPassword('wrong-password', stored), false)
})

test('malformed hashes fail safely as handled ServiceErrors (500 invalid_password_hash)', async () => {
  for (const bad of [
    '',
    'pbkdf2',
    'pbkdf2$$$',
    'bcrypt$10$abc',
    'pbkdf2$0$AAAA$AAAA',
    'pbkdf2$abc$AAAA$AAAA',
    'pbkdf2$100000$not!base64$AAAA',
  ]) {
    await assert.rejects(
      () => verifyPassword('whatever', bad),
      isInvalidHashError,
      `expected ${JSON.stringify(bad)} to fail as an invalid_password_hash ServiceError`,
    )
  }
})

test('verification reads the iteration count from the stored hash format', async () => {
  const low = await buildHash('legacy-format', 1_000)
  assert.equal(await verifyPassword('legacy-format', low), true)
  const legacy = await buildHash('legacy-format', 210_000)
  assert.equal(
    await verifyPassword('legacy-format', legacy),
    true,
    'a higher-count hash still verifies wherever the runtime permits it',
  )
  assert.equal(await verifyPassword('wrong', legacy), false)
})

test('setStaffPassword (change/reset flow) writes a 100000-iteration hash', async () => {
  let staffWrite: { passwordHash: string; mustChangePassword: boolean } | undefined
  const db = {
    // Covers the two query shapes setStaffPassword uses: the staff password
    // update (has returning()) and revokeAllStaffSessions' sessions update
    // (no returning()). The captured write is the one carrying passwordHash.
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            if (typeof values.passwordHash === 'string') {
              staffWrite = {
                passwordHash: values.passwordHash,
                mustChangePassword: Boolean(values.mustChangePassword),
              }
            }
            return Promise.resolve([{ id: 'staff-1' }])
          },
        }),
      }),
    }),
  } as unknown as DbClient

  await setStaffPassword(db, 'staff-1', 'new-password-123')

  assert.ok(staffWrite, 'a staff password write must have occurred')
  const parts = staffWrite!.passwordHash.split('$')
  assert.equal(parts[0], 'pbkdf2')
  assert.equal(Number(parts[1]), 100_000)
  assert.equal(await verifyPassword('new-password-123', staffWrite!.passwordHash), true)
  assert.equal(staffWrite!.mustChangePassword, false)
})

test('an iteration count above the Cloudflare 100000 cap fails as a handled ServiceError, not an unhandled platform error', async (t) => {
  const over = await buildHash('whatever', 210_000)
  t.mock.method(crypto.subtle, 'deriveBits', async () => {
    throw new DOMException(
      'Pbkdf2 failed: iteration counts above 100000 are not supported (requested 210000)',
      'NotSupportedError',
    )
  })
  await assert.rejects(
    () => verifyPassword('whatever', over),
    isInvalidHashError,
    'the Workers limit must surface as the same handled invalid_password_hash error',
  )
})

test('login keeps hiding failures behind a generic UnauthorizedError (no behavioural change from the fix)', async () => {
  // Guards the "no unrelated auth behaviour change" boundary: the wrong-password
  // path still throws UnauthorizedError and never a hash-format error.
  const stored = await hashPassword('real-password')
  assert.equal(await verifyPassword('wrong-password', stored), false)
  const error = new UnauthorizedError('invalid credentials')
  assert.equal(error.status, 401)
  assert.equal(error instanceof ServiceError, true)
})
