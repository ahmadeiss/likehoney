/**
 * Admin guard-policy regression tests for the forced `must_change_password`
 * removal. The sign-in screen is now the ONLY chrome-less admin route — there
 * is no forced password-change page anymore, so the shell can never redirect
 * on a "must change password" flag that no longer exists.
 *
 * Run:  node --import tsx --test src/lib/admin/auth-paths.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AUTH_PATHS, isAdminAuthPath } from './auth-paths'

test('the sign-in route is the only chrome-less admin route', () => {
  assert.deepEqual([...AUTH_PATHS], ['/admin/login'])
})

test('no admin guard path references a forced password-change route', () => {
  assert.equal(
    AUTH_PATHS.some((path) => path.includes('change-password')),
    false,
  )
})

test('isAdminAuthPath is an exact match', () => {
  assert.equal(isAdminAuthPath('/admin/login'), true)
  assert.equal(isAdminAuthPath('/admin'), false)
  assert.equal(isAdminAuthPath('/admin/change-password'), false)
  assert.equal(isAdminAuthPath('/admin/staff'), false)
})
