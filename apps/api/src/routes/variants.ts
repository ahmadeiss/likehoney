import { Hono } from 'hono'
import {
  optionUpdateSchema,
  optionUuidParamSchema,
  optionValueAddSchema,
  optionValueUpdateSchema,
  optionValueUuidParamSchema,
  uuidParamSchema,
  variantUpdateSchema,
} from '@likehoney/shared'
import { getVariant } from '@likehoney/db'

import type { AppEnv } from '../env'
import { assertPermission, currentStaffId, hasPermissionFor, requirePermission } from '../http/auth'
import { parseBody, parseParams } from '../http/request'
import { getDatabase } from '../services/db'
import {
  addOptionValueService,
  updateOptionService,
  updateOptionValueService,
  updateVariantService,
} from '../services/products'
import { auditActor } from '../services/audit'

export const variantsRouter = new Hono<AppEnv>()

variantsRouter.patch('/options/:optionId', requirePermission('catalog:write'), async (c) => {
  const { optionId } = parseParams(c, optionUuidParamSchema)
  const input = await parseBody(c, optionUpdateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const option = await updateOptionService(db, optionId, input, actor)
  return c.json(option)
})

// "+ إضافة قيمة" — grows an EXISTING option group with one new value (e.g.
// Size gains "31") and generates only the missing variant combinations.
// Deliberately does not create new option GROUPS (see service doc).
variantsRouter.post('/options/:optionId/values', requirePermission('catalog:write'), async (c) => {
  const { optionId } = parseParams(c, optionUuidParamSchema)
  const input = await parseBody(c, optionValueAddSchema)
  if (input.acquisitionCostMinor !== undefined) {
    await assertPermission(c, 'catalog-cost:write')
  }
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const result = await addOptionValueService(db, optionId, input, actor)
  return c.json(result, 201)
})

variantsRouter.patch(
  '/option-values/:optionValueId',
  requirePermission('catalog:write'),
  async (c) => {
    const { optionValueId } = parseParams(c, optionValueUuidParamSchema)
    const input = await parseBody(c, optionValueUpdateSchema)
    const db = getDatabase(c.env)
    const actor = auditActor(await currentStaffId(c))
    const value = await updateOptionValueService(db, optionValueId, input, actor)
    return c.json(value)
  },
)

variantsRouter.get('/:id', requirePermission('catalog:read'), async (c) => {
  const { id } = parseParams(c, uuidParamSchema)
  const db = getDatabase(c.env)
  const variant = await getVariant(db, id)
  if (variant === undefined) {
    return c.json({ error: { code: 'not_found', message: 'variant not found' } }, 404)
  }
  // Strip acquisition cost unless the caller holds `catalog-cost:read`.
  if (await hasPermissionFor(c, 'catalog-cost:read')) {
    return c.json(variant)
  }
  const safe: Record<string, unknown> = { ...variant }
  delete safe.acquisitionCostMinor
  return c.json(safe)
})

variantsRouter.patch('/:id', requirePermission('catalog:write'), async (c) => {
  const { id } = parseParams(c, uuidParamSchema)
  const input = await parseBody(c, variantUpdateSchema)
  // Changing acquisition cost needs the dedicated financial permission —
  // `catalog:write` alone must not move cost.
  if ('acquisitionCostMinor' in input) {
    await assertPermission(c, 'catalog-cost:write')
  }
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const variant = await updateVariantService(db, id, input, actor)
  return c.json(variant)
})
