/**
 * Store settings + delivery zone service. Setting values are validated
 * against the single registry in `@likehoney/shared`; unknown keys are
 * rejected. Human-readable values store localized shapes, numeric/boolean
 * values are stored untranslated.
 */
import {
  ConflictError,
  getStoreSettingDef,
  NotFoundError,
  PROTECTED_PAYMENT_SETTING_KEYS,
  STORE_SETTING_DEFS,
  UnprocessableError,
  ValidationError,
  type DeliveryZoneCreateInput,
  type DeliveryZoneUpdateInput,
  type StoreSettingSetInput,
} from '@likehoney/shared'
import type { DbClient } from '@likehoney/db'
import {
  countOrdersForZone,
  createDeliveryZone,
  getDeliveryZone,
  getDeliveryZoneByCode,
  getSetting,
  listDeliveryZones,
  listSettings,
  removeDeliveryZone,
  updateDeliveryZone,
  upsertSetting,
} from '@likehoney/db'

import { recordAudit, type AuditActor } from './audit'

// ---------------------------------------------------------------------------
// Store settings
// ---------------------------------------------------------------------------

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function listSettingsService(db: DbClient) {
  const rows = await listSettings(db)
  const byKey = new Map(rows.map((row) => [row.key, row]))

  return Object.entries(STORE_SETTING_DEFS).map(([key, def]) => {
    const row = byKey.get(key)
    return {
      key,
      value: row === undefined ? null : (tryParseJson(row.valueJson) ?? null),
      summaryEn: def.summaryEn,
      summaryAr: def.summaryAr,
    }
  })
}

export async function getSettingService(db: DbClient, key: string) {
  const def = getStoreSettingDef(key)
  if (def === null) throw new UnprocessableError('unknown setting key', { key })

  const row = await getSetting(db, key)
  return { key, value: row === undefined ? null : (tryParseJson(row.valueJson) ?? null) }
}

export async function setSettingService(
  db: DbClient,
  key: string,
  input: StoreSettingSetInput,
  actor: AuditActor,
) {
  const def = getStoreSettingDef(key)
  if (def === null) throw new UnprocessableError('unknown setting key', { key })

  // Gate B4 Stage 3 — protected payment settings can only be written through
  // the typed payment-settings service, which enforces the electronic-
  // enablement guard and the no-zero-payment-method invariant atomically
  // across keys. The generic key/value endpoint must not be a back door.
  if ((PROTECTED_PAYMENT_SETTING_KEYS as readonly string[]).includes(key)) {
    throw new UnprocessableError(
      'this setting is protected — update it through the payment settings endpoint',
      { key },
    )
  }

  const parsed = def.valueSchema.safeParse(input.value)
  if (!parsed.success) {
    throw new ValidationError('setting value does not match the schema for this key', {
      key,
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    })
  }

  const row = await upsertSetting(db, key, JSON.stringify(parsed.data))
  await recordAudit(db, actor, 'setting.updated', 'setting', key)

  return { key, value: tryParseJson(row.valueJson) }
}

// ---------------------------------------------------------------------------
// Delivery zones
// ---------------------------------------------------------------------------

export async function listDeliveryZonesService(
  db: DbClient,
  query: { page: number; pageSize: number; isActive?: boolean },
) {
  const { rows, total } = await listDeliveryZones(db, query)
  return { data: rows, meta: { page: query.page, pageSize: query.pageSize, total } }
}

export async function getDeliveryZoneService(db: DbClient, zoneId: string) {
  const zone = await getDeliveryZone(db, zoneId)
  if (zone === undefined) throw new NotFoundError('delivery zone not found')
  return zone
}

export async function createDeliveryZoneService(
  db: DbClient,
  input: DeliveryZoneCreateInput,
  actor: AuditActor,
) {
  const zone = await createDeliveryZone(db, {
    code: input.code,
    nameEn: input.nameEn,
    nameAr: input.nameAr,
    feeMinor: input.feeMinor,
    isActive: input.isActive,
    displayOrder: input.displayOrder,
  })
  await recordAudit(
    db,
    actor,
    'delivery_zone.created',
    'delivery_zone',
    zone.id,
    JSON.stringify({ code: zone.code }),
  )
  return zone
}

export async function updateDeliveryZoneService(
  db: DbClient,
  zoneId: string,
  input: DeliveryZoneUpdateInput,
  actor: AuditActor,
) {
  const existing = await getDeliveryZone(db, zoneId)
  if (existing === undefined) throw new NotFoundError('delivery zone not found')

  if (input.code !== undefined && input.code !== existing.code) {
    const byCode = await getDeliveryZoneByCode(db, input.code)
    if (byCode !== undefined) {
      throw new ConflictError('delivery zone code is already in use', { code: input.code })
    }
  }

  const updated = await updateDeliveryZone(db, zoneId, {
    code: input.code,
    nameEn: input.nameEn,
    nameAr: input.nameAr,
    feeMinor: input.feeMinor,
    isActive: input.isActive,
    displayOrder: input.displayOrder,
  })
  if (updated === undefined) throw new NotFoundError('delivery zone not found')

  await recordAudit(db, actor, 'delivery_zone.updated', 'delivery_zone', updated.id)
  return updated
}

export async function removeDeliveryZoneService(db: DbClient, zoneId: string, actor: AuditActor) {
  const existing = await getDeliveryZone(db, zoneId)
  if (existing === undefined) throw new NotFoundError('delivery zone not found')

  const orders = await countOrdersForZone(db, zoneId)
  if (orders > 0) {
    throw new ConflictError('delivery zone has orders; set isActive false instead', { orders })
  }

  const removed = await removeDeliveryZone(db, zoneId)
  if (removed === undefined) throw new NotFoundError('delivery zone not found')
  await recordAudit(db, actor, 'delivery_zone.deleted', 'delivery_zone', removed.id)
  return removed
}
