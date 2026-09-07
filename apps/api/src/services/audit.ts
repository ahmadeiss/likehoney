/**
 * Audit trail helper for services. Every business action writes one
 * append-only row; sensitive values are never stored — references/IDs only.
 */
import { writeAudit, type DbClient } from '@likehoney/db'

export interface AuditActor {
  actorType: 'staff' | 'system'
  actorStaffId?: string | null
}

/** Builds an actor from a staff identity header value. */
export function auditActor(staffId: string | undefined): AuditActor {
  if (staffId === undefined) return { actorType: 'system' }
  return { actorType: 'staff', actorStaffId: staffId }
}

export function recordAudit(
  db: DbClient,
  actor: AuditActor,
  action: string,
  entityType: string,
  entityId: string,
  metadataJson?: string,
) {
  return writeAudit(db, {
    actorType: actor.actorType,
    actorStaffId: actor.actorStaffId ?? null,
    action,
    entityType,
    entityId,
    metadataJson: metadataJson ?? null,
  })
}

/** JSON metadata helper for audit entries (never user content). */
export function auditMeta(values: Record<string, unknown>): string {
  return JSON.stringify(values)
}
