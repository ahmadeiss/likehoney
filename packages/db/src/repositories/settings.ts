/**
 * Store settings + delivery zone data access.
 *
 * Setting values are stored as validated JSON text (`value_json`); the typed
 * shape per key is enforced by the service layer using `STORE_SETTING_DEFS`
 * from `@likehoney/shared`.
 */
import { and, asc, count, eq, type SQL } from 'drizzle-orm'

import type { DbClient } from '../client'
import { deliveryZones, orders, storeSettings } from '../schema'

export type StoreSettingRow = typeof storeSettings.$inferSelect
export type DeliveryZoneRow = typeof deliveryZones.$inferSelect

export async function getSetting(db: DbClient, key: string): Promise<StoreSettingRow | undefined> {
  const rows = await db.select().from(storeSettings).where(eq(storeSettings.key, key)).limit(1)
  return rows[0]
}

export async function upsertSetting(
  db: DbClient,
  key: string,
  valueJson: string,
): Promise<StoreSettingRow> {
  await db
    .insert(storeSettings)
    .values({ key, valueJson })
    .onConflictDoUpdate({ target: storeSettings.key, set: { valueJson, updatedAt: new Date() } })
  const row = await getSetting(db, key)
  if (row === undefined) {
    throw new Error('store setting upsert did not persist the row')
  }
  return row
}

export async function listSettings(db: DbClient): Promise<StoreSettingRow[]> {
  return db.select().from(storeSettings).orderBy(asc(storeSettings.key))
}

/**
 * Restore true absence of a key (distinct from writing a "disabled" value).
 * `store_settings` carries no immutability guard — used by the Gate B4
 * Stage 3 payment-settings tests to restore exact pre-test state.
 */
export async function deleteSetting(db: DbClient, key: string): Promise<void> {
  await db.delete(storeSettings).where(eq(storeSettings.key, key))
}

// ---------------------------------------------------------------------------
// Delivery zones
// ---------------------------------------------------------------------------

export async function listDeliveryZones(
  db: DbClient,
  options: { page: number; pageSize: number; isActive?: boolean },
): Promise<{ rows: DeliveryZoneRow[]; total: number }> {
  const conditions: SQL[] = []
  if (options.isActive !== undefined) {
    conditions.push(eq(deliveryZones.isActive, options.isActive))
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const totalRows = await db.select({ value: count() }).from(deliveryZones).where(where)
  const total = totalRows[0]?.value ?? 0

  const rows = await db
    .select()
    .from(deliveryZones)
    .where(where)
    .orderBy(asc(deliveryZones.displayOrder), asc(deliveryZones.nameAr))
    .limit(options.pageSize)
    .offset((options.page - 1) * options.pageSize)

  return { rows, total }
}

export async function getDeliveryZone(
  db: DbClient,
  zoneId: string,
): Promise<DeliveryZoneRow | undefined> {
  const rows = await db.select().from(deliveryZones).where(eq(deliveryZones.id, zoneId)).limit(1)
  return rows[0]
}

export async function getDeliveryZoneByCode(
  db: DbClient,
  code: string,
): Promise<DeliveryZoneRow | undefined> {
  const rows = await db.select().from(deliveryZones).where(eq(deliveryZones.code, code)).limit(1)
  return rows[0]
}

export async function createDeliveryZone(
  db: DbClient,
  values: typeof deliveryZones.$inferInsert,
): Promise<DeliveryZoneRow> {
  const rows = await db.insert(deliveryZones).values(values).returning()
  return rows[0] as DeliveryZoneRow
}

export async function updateDeliveryZone(
  db: DbClient,
  zoneId: string,
  values: Partial<typeof deliveryZones.$inferInsert>,
): Promise<DeliveryZoneRow | undefined> {
  const rows = await db
    .update(deliveryZones)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(deliveryZones.id, zoneId))
    .returning()
  return rows[0]
}

export async function removeDeliveryZone(
  db: DbClient,
  zoneId: string,
): Promise<DeliveryZoneRow | undefined> {
  const rows = await db.delete(deliveryZones).where(eq(deliveryZones.id, zoneId)).returning()
  return rows[0]
}

export async function countOrdersForZone(db: DbClient, zoneId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(orders)
    .where(eq(orders.deliveryZoneId, zoneId))
  return rows[0]?.value ?? 0
}
