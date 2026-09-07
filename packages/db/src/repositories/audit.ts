/**
 * Audit trail data access.
 *
 * Append-only: rows are never updated or deleted. Services write one row per
 * business action. Sensitive values are never stored in `metadataJson` —
 * references and short codes only (DATA_MODEL.md §14).
 */
import { and, asc, eq } from 'drizzle-orm'

import type { DbClient } from '../client'
import { auditLogs, staffUsers } from '../schema'

export type AuditLogRow = typeof auditLogs.$inferSelect

export interface AuditEntityEntry {
  action: string
  metadataJson: string | null
  createdAt: Date
  actorStaffId: string | null
  actorNameAr: string | null
  actorNameEn: string | null
}

/** Ordered activity for one entity, with the actor's display name resolved. */
export async function listAuditForEntity(
  db: DbClient,
  entityType: string,
  entityId: string,
): Promise<AuditEntityEntry[]> {
  return db
    .select({
      action: auditLogs.action,
      metadataJson: auditLogs.metadataJson,
      createdAt: auditLogs.createdAt,
      actorStaffId: auditLogs.actorStaffId,
      actorNameAr: staffUsers.nameAr,
      actorNameEn: staffUsers.nameEn,
    })
    .from(auditLogs)
    .leftJoin(staffUsers, eq(auditLogs.actorStaffId, staffUsers.id))
    .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)))
    .orderBy(asc(auditLogs.createdAt))
}

export type ActorTypeValue = 'staff' | 'system'

export interface NewAuditLogEntry {
  actorType: ActorTypeValue
  actorStaffId?: string | null
  action: string
  entityType: string
  entityId: string
  metadataJson?: string | null
}

export async function writeAudit(db: DbClient, entry: NewAuditLogEntry): Promise<AuditLogRow> {
  const rows = await db.insert(auditLogs).values(entry).returning()
  return rows[0] as AuditLogRow
}
