/**
 * Product media metadata data access. Media rows reference R2 object keys
 * only; binary content never touches Neon.
 */
import { asc, eq } from 'drizzle-orm'

import type { DbClient } from '../client'
import { productMedia } from '../schema'

export type ProductMediaRow = typeof productMedia.$inferSelect
export type ProductMediaNew = typeof productMedia.$inferInsert

export type MediaTypeValue = 'image' | 'video'

export async function listMediaForProduct(
  db: DbClient,
  productId: string,
): Promise<ProductMediaRow[]> {
  return db
    .select()
    .from(productMedia)
    .where(eq(productMedia.productId, productId))
    .orderBy(asc(productMedia.sortOrder), asc(productMedia.createdAt))
}

export async function getMedia(
  db: DbClient,
  mediaId: string,
): Promise<ProductMediaRow | undefined> {
  const rows = await db.select().from(productMedia).where(eq(productMedia.id, mediaId)).limit(1)
  return rows[0]
}

export async function getMediaByObjectKey(
  db: DbClient,
  objectKey: string,
): Promise<ProductMediaRow | undefined> {
  const rows = await db
    .select()
    .from(productMedia)
    .where(eq(productMedia.objectKey, objectKey))
    .limit(1)
  return rows[0]
}

export async function insertMedia(db: DbClient, values: ProductMediaNew): Promise<ProductMediaRow> {
  const rows = await db.insert(productMedia).values(values).returning()
  return rows[0] as ProductMediaRow
}

export async function updateMedia(
  db: DbClient,
  mediaId: string,
  values: Partial<ProductMediaNew>,
): Promise<ProductMediaRow | undefined> {
  const rows = await db
    .update(productMedia)
    .set(values)
    .where(eq(productMedia.id, mediaId))
    .returning()
  return rows[0]
}

export async function removeMedia(
  db: DbClient,
  mediaId: string,
): Promise<ProductMediaRow | undefined> {
  const rows = await db.delete(productMedia).where(eq(productMedia.id, mediaId)).returning()
  return rows[0]
}

export async function clearPrimaryForProduct(db: DbClient, productId: string): Promise<void> {
  await db
    .update(productMedia)
    .set({ isPrimary: false })
    .where(eq(productMedia.productId, productId))
}

export async function countMediaForProduct(db: DbClient, productId: string): Promise<number> {
  const rows = await db
    .select({ id: productMedia.id })
    .from(productMedia)
    .where(eq(productMedia.productId, productId))
  return rows.length
}

/**
 * Applies a full new sort order atomically (one transaction — no
 * intermediate state where two rows share a position or a position is
 * skipped). `orderedIds` must be exactly the product's current media ids;
 * the caller validates that before calling this.
 */
export async function reorderMediaForProduct(
  db: DbClient,
  productId: string,
  orderedIds: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await Promise.all(
      orderedIds.map((id, index) =>
        tx.update(productMedia).set({ sortOrder: index }).where(eq(productMedia.id, id)),
      ),
    )
  })
}

/** Used by the reorder validation path — confirms every id belongs to the product. */
export async function getMediaIdsForProduct(db: DbClient, productId: string): Promise<string[]> {
  const rows = await db
    .select({ id: productMedia.id })
    .from(productMedia)
    .where(eq(productMedia.productId, productId))
  return rows.map((row) => row.id)
}
