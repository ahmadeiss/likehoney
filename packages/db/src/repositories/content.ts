/**
 * Editorial content page data access (public, published-only).
 *
 * Only `published` pages are exposed to the storefront. `body_*` and `title_*`
 * are bilingual (Arabic-first / English).
 */
import { and, eq } from 'drizzle-orm'

import type { DbClient } from '../client'
import { contentPages } from '../schema'

export type ContentPageRow = typeof contentPages.$inferSelect

export async function listPublishedContentPages(db: DbClient): Promise<ContentPageRow[]> {
  return db.select().from(contentPages).where(eq(contentPages.status, 'published'))
}

export async function getPublishedContentPage(
  db: DbClient,
  slug: string,
): Promise<ContentPageRow | undefined> {
  const rows = await db
    .select()
    .from(contentPages)
    .where(and(eq(contentPages.slug, slug), eq(contentPages.status, 'published')))
    .limit(1)
  return rows[0]
}
