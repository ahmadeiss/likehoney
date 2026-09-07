/**
 * Staff authentication (server-authoritative).
 *
 * Passwords are verified with PBKDF2 (Web Crypto); successful sign-in issues a
 * random bearer token whose SHA-256 hash is stored in `staff_sessions`. The raw
 * token is delivered to the browser once, in an HttpOnly/Secure/SameSite
 * cookie, and validated against the database on every request. Lifecycle:
 * expiry, logout revocation, revoke-all on disable, and revoke-on-password-
 * change are all enforced server-side. No native dependencies; runs on
 * Cloudflare Workers.
 */
import { UnauthorizedError } from '@likehoney/shared'
import {
  createStaffSession,
  getLiveSessionByTokenHash,
  getStaffUser,
  getStaffUserByIdentifier,
  revokeAllStaffSessions,
  revokeSessionByTokenHash,
  updateStaffUser,
  type DbClient,
  type StaffUserRow,
} from '@likehoney/db'

import { DEV_APP_ENV, SESSION_COOKIE_NAME } from '../env'
import { hashPassword, verifyPassword } from './password'

/** Default session lifetime (12 hours) when SESSION_HOURS is not configured. */
export const DEFAULT_SESSION_HOURS = 12

export function sessionLifetimeHours(c: { env: { SESSION_HOURS?: string } }): number {
  const raw = c.env.SESSION_HOURS
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SESSION_HOURS
}

export function sessionCookieOptions(c: {
  env: { APP_ENV?: string; SECURE_COOKIES?: string; SESSION_HOURS?: string }
}): {
  name: string
  options: {
    httpOnly: boolean
    secure: boolean
    sameSite: 'Lax'
    path: string
    maxAge: number
  }
} {
  const hours = sessionLifetimeHours(c)
  const secure =
    c.env.SECURE_COOKIES === undefined
      ? c.env.APP_ENV !== DEV_APP_ENV
      : c.env.SECURE_COOKIES === 'true'
  return {
    name: SESSION_COOKIE_NAME,
    options: {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: hours * 60 * 60,
    },
  }
}

/** SHA-256 of a bearer token, used as the database key for the session. */
function hashToken(token: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
}

async function tokenHashHex(token: string): Promise<string> {
  const digest = await hashToken(token)
  return bytesToHex(new Uint8Array(digest))
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, '0')
  return out
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]!)
  return btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface LoginResult {
  staff: StaffUserRow
  token: string
  mustChangePassword: boolean
}

/**
 * Authenticates a staff member by identifier (phone or email) + password,
 * returns the raw bearer token and staff identity. Throws UnauthorizedError on
 * any failure without revealing which part was wrong.
 */
export async function loginService(
  db: DbClient,
  identifier: string,
  password: string,
  context: { env: EnvLike; ip?: string | null; userAgent?: string | null },
): Promise<LoginResult> {
  const staff = await getStaffUserByIdentifier(db, identifier.trim())
  if (staff === undefined || staff.passwordHash === null) {
    throw new UnauthorizedError('invalid credentials')
  }

  const ok = await verifyPassword(password, staff.passwordHash)
  if (!ok) {
    throw new UnauthorizedError('invalid credentials')
  }

  if (staff.status !== 'active') {
    throw new UnauthorizedError('account is not active')
  }

  await updateStaffUser(db, staff.id, { lastLoginAt: new Date() })

  const token = randomToken()
  const tokenHash = await tokenHashHex(token)
  const hours = sessionLifetimeHours(context)
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000)

  await createStaffSession(db, {
    staffId: staff.id,
    tokenHash,
    expiresAt,
    ip: context.ip ?? null,
    userAgent: context.userAgent ?? null,
  })

  return { staff, token, mustChangePassword: staff.mustChangePassword }
}

/**
 * Validates a bearer token and returns the staff member it belongs to, or
 * undefined when the session is missing, expired, revoked, or the staff is no
 * longer active.
 */
export async function validateSession(
  db: DbClient,
  token: string | undefined,
): Promise<StaffUserRow | undefined> {
  if (!token) return undefined
  const tokenHash = await tokenHashHex(token)
  const session = await getLiveSessionByTokenHash(db, tokenHash)
  if (session === undefined) return undefined

  const staff = await getStaffUser(db, session.staffId)
  if (staff === undefined || staff.status !== 'active') return undefined
  return staff
}

/** Revokes the session identified by a bearer token (sign-out). */
export async function logoutService(db: DbClient, token: string | undefined): Promise<void> {
  if (!token) return
  const tokenHash = await tokenHashHex(token)
  await revokeSessionByTokenHash(db, tokenHash)
}

/** Marks a staff member as disabled and revokes all of their sessions. */
export async function disableStaffAndRevokeSessions(db: DbClient, staffId: string): Promise<void> {
  await updateStaffUser(db, staffId, { status: 'inactive' })
  await revokeAllStaffSessions(db, staffId)
}

/**
 * Sets a staff password (hash). When `mustChange` is true the next sign-in is
 * forced to change it (used when an Admin sets/resets a password); prior
 * sessions are always revoked so a stolen cookie cannot outlive the change.
 */
export async function setStaffPassword(
  db: DbClient,
  staffId: string,
  password: string,
  mustChange = false,
): Promise<void> {
  const passwordHash = await hashPassword(password)
  await updateStaffUser(db, staffId, { passwordHash, mustChangePassword: mustChange })
  await revokeAllStaffSessions(db, staffId)
}

interface EnvLike {
  SESSION_HOURS?: string
}
