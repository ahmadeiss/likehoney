/**
 * Staff session data access. Only hashes of bearer tokens are stored; the raw
 * token is delivered to the browser once via an HttpOnly cookie. Lifecycle
 * helpers: create (server-authoritative), validate (active + unexpired +
 * unrevoked), and revoke (current, all-for-staff, or by token).
 */
import { and, eq, gt, isNull, lt } from 'drizzle-orm'

import type { DbClient } from '../client'
import { staffSessions } from '../schema'

export type StaffSessionRow = typeof staffSessions.$inferSelect

/** Creates a session row for a staff member. Returns the stored row. */
export async function createStaffSession(
  db: DbClient,
  values: {
    staffId: string
    tokenHash: string
    expiresAt: Date
    ip?: string | null
    userAgent?: string | null
  },
): Promise<StaffSessionRow> {
  const rows = await db
    .insert(staffSessions)
    .values({
      staffId: values.staffId,
      tokenHash: values.tokenHash,
      expiresAt: values.expiresAt,
      ip: values.ip ?? null,
      userAgent: values.userAgent ?? null,
    })
    .returning()
  return rows[0] as StaffSessionRow
}

/**
 * Resolves a live session by token hash: must exist, not be revoked, and not
 * be expired. Returns the row (with staffId) when valid, otherwise undefined.
 */
export async function getLiveSessionByTokenHash(
  db: DbClient,
  tokenHash: string,
): Promise<StaffSessionRow | undefined> {
  const rows = await db
    .select()
    .from(staffSessions)
    .where(
      and(
        eq(staffSessions.tokenHash, tokenHash),
        isNull(staffSessions.revokedAt),
        gt(staffSessions.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return rows[0]
}

/** Revokes a single session by token hash (used by sign-out). */
export async function revokeSessionByTokenHash(db: DbClient, tokenHash: string): Promise<void> {
  await db
    .update(staffSessions)
    .set({ revokedAt: new Date() })
    .where(eq(staffSessions.tokenHash, tokenHash))
}

/** Revokes every live session belonging to a staff member (disable / reseed). */
export async function revokeAllStaffSessions(db: DbClient, staffId: string): Promise<void> {
  await db
    .update(staffSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(staffSessions.staffId, staffId), isNull(staffSessions.revokedAt)))
}

/** Permanently deletes expired sessions (already past expires_at) for cleanup. */
export async function deleteExpiredSessions(db: DbClient, now: Date): Promise<number> {
  const rows = await db
    .delete(staffSessions)
    .where(lt(staffSessions.expiresAt, now))
    .returning({ id: staffSessions.id })
  return rows.length
}
