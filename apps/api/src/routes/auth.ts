/**
 * Staff authentication routes (server-authoritative).
 *
 * `POST /auth/login` verifies credentials and issues an HttpOnly session cookie
 * (only the token hash is stored in `staff_sessions`). `GET /auth/me` returns
 * the signed-in staff member + effective permissions. `POST /auth/logout`
 * revokes the session. `POST /auth/change-password` lets a signed-in staff
 * member rotate their own password (revoking all their sessions).
 */
import { Hono } from 'hono'
import {
  effectivePermissionCodes,
  getStaffRoleIds,
  getStaffUser,
  type DbClient,
} from '@likehoney/db'
import { staffChangePasswordSchema, staffLoginSchema, UnauthorizedError } from '@likehoney/shared'

import { SESSION_COOKIE_NAME, type AppEnv } from '../env'
import { currentStaffId } from '../http/auth'
import { parseBody } from '../http/request'
import {
  loginService,
  logoutService,
  sessionCookieOptions,
  setStaffPassword,
} from '../services/auth'
import { getDatabase } from '../services/db'
import { verifyPassword } from '../services/password'

export const authRouter = new Hono<AppEnv>()

function readCookieToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === SESSION_COOKIE_NAME) return part.slice(eq + 1).trim()
  }
  return undefined
}

function sessionCookieValue(value: string, opts: { secure: boolean; maxAge: number }): string {
  const base = `${SESSION_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
    value ? opts.maxAge : 0
  }`
  return opts.secure ? `${base}; Secure` : base
}

async function staffMePayload(db: DbClient, staffId: string) {
  const staff = await getStaffUser(db, staffId)
  if (staff === undefined) throw new UnauthorizedError('authentication required')
  const [codes, roleIds] = await Promise.all([
    effectivePermissionCodes(db, staffId),
    getStaffRoleIds(db, staffId),
  ])
  return {
    staff: {
      id: staff.id,
      nameAr: staff.nameAr,
      nameEn: staff.nameEn,
      email: staff.email,
      phoneNormalized: staff.phoneNormalized,
      status: staff.status,
      mustChangePassword: staff.mustChangePassword,
    },
    permissions: codes,
    roleIds,
  }
}

authRouter.post('/login', async (c) => {
  const input = await parseBody(c, staffLoginSchema)
  const db = getDatabase(c.env)

  const result = await loginService(db, input.identifier, input.password, {
    env: c.env,
    ip: c.req.header('cf-connecting-ip') ?? undefined,
    userAgent: c.req.header('user-agent') ?? undefined,
  })

  const cookie = sessionCookieOptions(c).options
  c.header('Set-Cookie', sessionCookieValue(result.token, cookie))

  return c.json(await staffMePayload(db, result.staff.id), 200)
})

authRouter.post('/logout', async (c) => {
  const token = readCookieToken(c.req.header('cookie'))
  await logoutService(getDatabase(c.env), token)
  const cookie = sessionCookieOptions(c).options
  c.header('Set-Cookie', sessionCookieValue('', cookie))
  return c.json({ ok: true })
})

authRouter.get('/me', async (c) => {
  const db = getDatabase(c.env)
  // Session-first; in development on a loopback host the identity picker's
  // `X-Staff-Id` header also resolves here (via `currentStaffId` →
  // `resolveStaff`), so the dev Admin UI sees the *selected* staff member's
  // real effective permissions instead of an anonymous fallback. This branch
  // is never reachable in production and does not change RBAC — every other
  // route still re-checks the permission for that identity.
  const staffId = await currentStaffId(c)
  if (staffId === undefined) throw new UnauthorizedError('authentication required')
  return c.json(await staffMePayload(db, staffId))
})

authRouter.post('/change-password', async (c) => {
  const input = await parseBody(c, staffChangePasswordSchema)
  const db = getDatabase(c.env)
  const staffId = await currentStaffId(c)
  if (staffId === undefined) throw new UnauthorizedError('authentication required')

  const staff = await getStaffUser(db, staffId)
  if (staff === undefined || staff.passwordHash === null) {
    throw new UnauthorizedError('authentication required')
  }
  const ok = await verifyPassword(input.currentPassword, staff.passwordHash)
  if (!ok) throw new UnauthorizedError('current password is incorrect')

  await setStaffPassword(db, staffId, input.newPassword)
  return c.json({ ok: true })
})
