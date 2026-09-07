/**
 * Public (customer-facing) content, delivery and settings services.
 *
 * Exposes only customer-safe data:
 * - published editorial pages only;
 * - active delivery zones (never inactive or internal fields);
 * - a whitelisted slice of store settings.
 */
import { NotFoundError, type StoreSettingKey } from '@likehoney/shared'
import {
  getPublishedContentPage,
  listActiveDeliveryZones,
  listPublishedContentPages,
  listSettings,
  type DbClient,
} from '@likehoney/db'

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function listContentPagesService(db: DbClient) {
  const rows = await listPublishedContentPages(db)
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    titleAr: row.titleAr,
    titleEn: row.titleEn,
    bodyAr: row.bodyAr,
    bodyEn: row.bodyEn,
    updatedAt: row.updatedAt,
  }))
}

export async function getContentPageBySlugService(db: DbClient, slug: string) {
  const row = await getPublishedContentPage(db, slug)
  if (row === undefined) throw new NotFoundError('page not found')
  return {
    id: row.id,
    slug: row.slug,
    titleAr: row.titleAr,
    titleEn: row.titleEn,
    bodyAr: row.bodyAr,
    bodyEn: row.bodyEn,
    updatedAt: row.updatedAt,
  }
}

export async function listDeliveryZonesService(db: DbClient) {
  const rows = await listActiveDeliveryZones(db)
  return rows.map((zone) => ({
    id: zone.id,
    nameAr: zone.nameAr,
    nameEn: zone.nameEn,
    feeMinor: zone.feeMinor,
  }))
}

/** Public keys a guest checkout/header may read. */
const PUBLIC_SETTING_KEYS: StoreSettingKey[] = [
  'checkout:cod.enabled',
  'store:announcement',
  'general:currency',
]

export async function publicSettingsService(db: DbClient) {
  const rows = await listSettings(db)
  const byKey = new Map(rows.map((row) => [row.key, row]))
  const result: Record<string, unknown> = {}
  for (const key of PUBLIC_SETTING_KEYS) {
    const row = byKey.get(key)
    result[key] = row === undefined ? null : (tryParseJson(row.valueJson) ?? null)
  }
  return { settings: result }
}
