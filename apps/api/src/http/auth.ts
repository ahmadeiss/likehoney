/**
 * Authorization foundation.
 *
 * Identity resolution order (server-authoritative, no trust in client claims):
 *
 * 1. A valid real staff session cookie → the authenticated staff member.
 * 2. Fallback ONLY in development and from a local/loopback host: the
 *    `X-Staff-Id` header (the dev identity picker). It is never honored in
 *    production, and it still passes through the same active-status and RBAC
 *    checks as a real session.
 *
 * `requirePermission` re-checks staff status and resolves the role-derived
 * permission codes on every request, so disabled accounts and stale grants are
 * denied immediately regardless of how the identity was established.
 */
import type { MiddlewareHandler } from 'hono'
import { ForbiddenError, UnauthorizedError, type PermissionCode } from '@likehoney/shared'
import { effectivePermissionCodes, getStaffUser, type DbClient } from '@likehoney/db'

import { DEV_APP_ENV, SESSION_COOKIE_NAME, type AppEnv } from '../env'
import { getDatabase } from '../services/db'
import { validateSession } from '../services/auth'

/** Legacy development identity header (development-only fallback). */
export const IDENTITY_HEADER = 'x-staff-id'

export interface AuthContext {
  env: { APP_ENV?: string }
  url: URL
  cookieHeader?: string | undefined
  devHeader?: string | undefined
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

async function resolveStaff(
  db: DbClient,
  ctx: AuthContext,
): Promise<{ id: string; via: 'session' | 'dev-header' } | undefined> {
  const token = readCookie(ctx.cookieHeader, SESSION_COOKIE_NAME)
  if (token) {
    const staff = await validateSession(db, token)
    if (staff) return { id: staff.id, via: 'session' }
  }

  // Development-only, loopback-only fallback for the identity picker.
  if (ctx.env.APP_ENV === DEV_APP_ENV && isLoopbackHost(ctx.url.hostname)) {
    const staffId = ctx.devHeader
    if (staffId) {
      const staff = await getStaffUser(db, staffId)
      if (staff !== undefined && staff.status === 'active') {
        return { id: staff.id, via: 'dev-header' }
      }
    }
  }

  return undefined
}

/**
 * Rejects the request unless the authenticated staff member holds the given
 * permission code. Resolves permissions from the role graph on every call.
 */
export function requirePermission(code: PermissionCode): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const db = getDatabase(c.env)
    const resolved = await resolveStaff(db, {
      env: c.env,
      url: new URL(c.req.url),
      cookieHeader: c.req.header('cookie'),
      devHeader: c.req.header(IDENTITY_HEADER),
    })
    if (resolved === undefined) {
      throw new UnauthorizedError('authentication required')
    }

    const codes = await effectivePermissionCodes(db, resolved.id)
    if (!codes.includes(code)) {
      throw new ForbiddenError(`missing required permission: ${code}`)
    }

    await next()
  }
}

/**
 * Resolves the requesting staff identity without asserting a permission.
 * Used for audit provenance on mutation routes.
 */
export async function currentStaffId(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
): Promise<string | undefined> {
  const db = getDatabase(c.env)
  const resolved = await resolveStaff(db, {
    env: c.env,
    url: new URL(c.req.url),
    cookieHeader: c.req.header('cookie'),
    devHeader: c.req.header(IDENTITY_HEADER),
  })
  return resolved?.id
}

/**
 * Does the requesting staff member hold `code`? For routes where a base
 * permission gates the endpoint but a SECONDARY permission gates one
 * sensitive field in the payload (Gate C: `catalog-cost:*` on the variant
 * PATCH). Anonymous → false. Resolves from the role graph every call.
 */
export async function hasPermissionFor(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  code: PermissionCode,
): Promise<boolean> {
  const db = getDatabase(c.env)
  const resolved = await resolveStaff(db, {
    env: c.env,
    url: new URL(c.req.url),
    cookieHeader: c.req.header('cookie'),
    devHeader: c.req.header(IDENTITY_HEADER),
  })
  if (resolved === undefined) return false
  const codes = await effectivePermissionCodes(db, resolved.id)
  return codes.includes(code)
}

/** Throws `ForbiddenError` unless the caller holds `code`. */
export async function assertPermission(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  code: PermissionCode,
): Promise<void> {
  if (!(await hasPermissionFor(c, code))) {
    throw new ForbiddenError(`missing required permission: ${code}`)
  }
}
