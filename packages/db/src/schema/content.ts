/**
 * Simple editorial content pages (e.g. Shipping & Returns, About Us, FAQ).
 * Rendered with light markup decided at the UI layer; stored as text per
 * language on a single row.
 */
import { index, pgTable } from 'drizzle-orm/pg-core'

import { contentStatus } from './enums'

export const contentPages = pgTable(
  'content_pages',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    slug: t.text('slug').notNull().unique(),
    titleEn: t.text('title_en').notNull(),
    titleAr: t.text('title_ar').notNull(),
    bodyEn: t.text('body_en'),
    bodyAr: t.text('body_ar'),
    status: contentStatus('status').notNull().default('draft'),
    publishedAt: t.timestamp('published_at', { withTimezone: true }),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [index('content_pages_status_idx').on(t.status)],
)
