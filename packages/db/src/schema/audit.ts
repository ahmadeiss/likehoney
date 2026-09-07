/**
 * Append-only audit trail. Records WHO did WHAT to WHICH entity, optionally
 * with a compact JSON metadata payload. Sensitive data must never be copied
 * into `metadata_json`; reference by IDs/short codes only.
 *
 * The audit trail is a model for Phase 3B services to write; no trigger
 * logic lives in the database.
 */
import { index, pgTable } from 'drizzle-orm/pg-core'

import { staffUsers } from './staff'

export const auditLogs = pgTable(
  'audit_logs',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    /** `staff` or `system`. */
    actorType: t.varchar('actor_type', { length: 16 }).notNull(),
    actorStaffId: t
      .uuid('actor_staff_id')
      .references(() => staffUsers.id, { onDelete: 'set null' }),
    /** e.g. `order.status_changed`, `product.updated`. */
    action: t.varchar('action', { length: 64 }).notNull(),
    /** e.g. `order`, `product`, `variant`, `store_sale`. */
    entityType: t.varchar('entity_type', { length: 32 }).notNull(),
    /** Entity UUID or human-readable number. */
    entityId: t.text('entity_id').notNull(),
    /** Compact JSON of before/after references. */
    metadataJson: t.text('metadata_json'),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_created_idx').on(t.createdAt),
    index('audit_logs_action_idx').on(t.action),
  ],
)
