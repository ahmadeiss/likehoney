import { Hono } from 'hono'
import {
  productCreateSchema,
  productListQuerySchema,
  productUpdateSchema,
  productUuidParamSchema,
  variantBulkCostSchema,
  variantCreateSchema,
} from '@likehoney/shared'

import type { AppEnv } from '../env'
import { assertPermission, currentStaffId, hasPermissionFor, requirePermission } from '../http/auth'
import { parseBody, parseParams, parseQuery } from '../http/request'
import { getDatabase } from '../services/db'
import {
  addVariantService,
  bulkActivateDraftVariantsService,
  bulkVariantCostService,
  createProductService,
  getProductDetailService,
  listProductsService,
  updateProductService,
} from '../services/products'
import { auditActor } from '../services/audit'

export const productsRouter = new Hono<AppEnv>()

productsRouter.get('/', requirePermission('catalog:read'), async (c) => {
  const query = parseQuery(c, productListQuerySchema)
  return c.json(await listProductsService(getDatabase(c.env), query))
})

productsRouter.post('/', requirePermission('catalog:write'), async (c) => {
  const input = await parseBody(c, productCreateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const product = await createProductService(db, input, actor)
  return c.json(product, 201)
})

productsRouter.get('/:productId', requirePermission('catalog:read'), async (c) => {
  const { productId } = parseParams(c, productUuidParamSchema)
  // Acquisition cost is only serialized for a `catalog-cost:read` holder.
  const includeCost = await hasPermissionFor(c, 'catalog-cost:read')
  return c.json(await getProductDetailService(getDatabase(c.env), productId, includeCost))
})

productsRouter.patch('/:productId', requirePermission('catalog:write'), async (c) => {
  const { productId } = parseParams(c, productUuidParamSchema)
  const input = await parseBody(c, productUpdateSchema)
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const product = await updateProductService(db, productId, input, actor)
  return c.json(product)
})

productsRouter.post('/:productId/variants', requirePermission('catalog:write'), async (c) => {
  const { productId } = parseParams(c, productUuidParamSchema)
  const input = await parseBody(c, variantCreateSchema)
  // Setting a cost on the new variant needs the dedicated financial permission.
  if (input.acquisitionCostMinor !== undefined) {
    await assertPermission(c, 'catalog-cost:write')
  }
  const db = getDatabase(c.env)
  const actor = auditActor(await currentStaffId(c))
  const variant = await addVariantService(db, productId, input, actor)
  return c.json(variant, 201)
})

/**
 * §9 — apply one acquisition cost across many variants of a product.
 * `catalog-cost:write` only (independent of `catalog:write`).
 */
productsRouter.post(
  '/:productId/variants/cost',
  requirePermission('catalog-cost:write'),
  async (c) => {
    const { productId } = parseParams(c, productUuidParamSchema)
    const input = await parseBody(c, variantBulkCostSchema)
    const db = getDatabase(c.env)
    const actor = auditActor(await currentStaffId(c))
    return c.json(await bulkVariantCostService(db, productId, input, actor))
  },
)

// "فعّلي التركيبات المعروضة" — bulk-activates every currently-draft variant
// of this product in one staff action, after review/deactivation. Scoped
// strictly to draft variants of this product (see service doc).
productsRouter.post(
  '/:productId/variants/bulk-activate',
  requirePermission('catalog:write'),
  async (c) => {
    const { productId } = parseParams(c, productUuidParamSchema)
    const db = getDatabase(c.env)
    const actor = auditActor(await currentStaffId(c))
    const result = await bulkActivateDraftVariantsService(db, productId, actor)
    return c.json(result)
  },
)
