import { Hono } from 'hono'
import {
  deliveryZoneCreateSchema,
  deliveryZoneListQuerySchema,
  deliveryZoneUpdateSchema,
  paymentSettingsUpdateSchema,
  storeSettingKeySchema,
  storeSettingSetSchema,
  zoneUuidParamSchema,
  ValidationError,
  type StoreSettingKey,
} from '@likehoney/shared'

import type { AppEnv } from '../env'
import { requirePermission, currentStaffId } from '../http/auth'
import { parseBody, parseParams, parseQuery } from '../http/request'
import { auditActor } from '../services/audit'
import { getDatabase } from '../services/db'
import {
  getPaymentSettingsReadModelService,
  updatePaymentSettingsService,
} from '../services/payments/settings'
import {
  createDeliveryZoneService,
  getDeliveryZoneService,
  getSettingService,
  listDeliveryZonesService,
  listSettingsService,
  removeDeliveryZoneService,
  setSettingService,
  updateDeliveryZoneService,
} from '../services/settings'

export const settingsRouter = new Hono<AppEnv>()

// ---------------------------------------------------------------------------
// Settings + delivery zones
//
// Hono matches routes in registration order, so every static segment
// (`/delivery-zones`, `/delivery-zones/:zoneId`) must be declared BEFORE the
// parameterized `/:key` route; otherwise `GET /settings/delivery-zones` is
// captured by `/:key` and rejected as an unknown setting key.
// ---------------------------------------------------------------------------

settingsRouter.get('/', requirePermission('settings:write'), async (c) => {
  return c.json(await listSettingsService(getDatabase(c.env)))
})

settingsRouter.get('/delivery-zones', requirePermission('settings:write'), async (c) => {
  const query = parseQuery(c, deliveryZoneListQuerySchema)
  return c.json(
    await listDeliveryZonesService(getDatabase(c.env), {
      page: query.page,
      pageSize: query.pageSize,
      isActive: query.isActive,
    }),
  )
})

settingsRouter.post('/delivery-zones', requirePermission('settings:write'), async (c) => {
  const input = await parseBody(c, deliveryZoneCreateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const zone = await createDeliveryZoneService(db, input, actor)
  return c.json(zone, 201)
})

settingsRouter.get('/delivery-zones/:zoneId', requirePermission('settings:write'), async (c) => {
  const { zoneId } = parseParams(c, zoneUuidParamSchema)
  return c.json(await getDeliveryZoneService(getDatabase(c.env), zoneId))
})

settingsRouter.patch('/delivery-zones/:zoneId', requirePermission('settings:write'), async (c) => {
  const { zoneId } = parseParams(c, zoneUuidParamSchema)
  const input = await parseBody(c, deliveryZoneUpdateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const zone = await updateDeliveryZoneService(db, zoneId, input, actor)
  return c.json(zone)
})

settingsRouter.delete('/delivery-zones/:zoneId', requirePermission('settings:write'), async (c) => {
  const { zoneId } = parseParams(c, zoneUuidParamSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const removed = await removeDeliveryZoneService(db, zoneId, actor)
  return c.json(removed)
})

// Gate B4 Stage 3 — canonical payment settings (protected keys; §35). Must be
// registered before the `/:key` catch-all for the same reason as the delivery
// zone routes above.
settingsRouter.get('/payments', requirePermission('settings:write'), async (c) => {
  return c.json(await getPaymentSettingsReadModelService(getDatabase(c.env), c.env))
})

settingsRouter.patch('/payments', requirePermission('settings:write'), async (c) => {
  const input = await parseBody(c, paymentSettingsUpdateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const result = await updatePaymentSettingsService(db, c.env, input, actor)
  return c.json(result)
})

settingsRouter.get('/:key', requirePermission('settings:write'), async (c) => {
  const key = parseSettingKey(c.req.param('key'))
  return c.json(await getSettingService(getDatabase(c.env), key))
})

settingsRouter.put('/:key', requirePermission('settings:write'), async (c) => {
  const key = parseSettingKey(c.req.param('key'))
  const input = await parseBody(c, storeSettingSetSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const result = await setSettingService(db, key, input, actor)
  return c.json(result)
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSettingKey(raw: string): StoreSettingKey {
  const result = storeSettingKeySchema.safeParse(raw)
  if (!result.success || result.data === undefined) {
    throw new ValidationError('unknown setting key', { key: raw })
  }
  return result.data
}
