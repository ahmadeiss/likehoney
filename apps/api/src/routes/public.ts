import { Hono } from 'hono'
import {
  checkoutCreateSchema,
  publicCartVerifySchema,
  publicProductListQuerySchema,
  publicReviewListQuerySchema,
  publicReviewSubmitSchema,
  contentSlugParamSchema,
  orderByNumberParamSchema,
  productUuidParamSchema,
  NotFoundError,
  ValidationError,
} from '@likehoney/shared'
import { getOrderByNumber, listOrderItems } from '@likehoney/db'

import type { AppEnv } from '../env'
import { parseBody, parseParams, parseQuery } from '../http/request'
import { getDatabase, isDatabaseConfigured } from '../services/db'
import { buildMediaResponse, getMediaStorage, isSafeObjectKey } from '../media/storage'
import {
  getPublicProductDetailService,
  listPublicCategoriesService,
  listPublicProductsService,
  resolvePublicCategoryId,
} from '../services/public-catalog'
import {
  getContentPageBySlugService,
  listContentPagesService,
  listDeliveryZonesService,
  publicSettingsService,
} from '../services/public-content'
import { createCheckoutOrderService, quoteCheckoutService } from '../services/orders'
import { listPublicApprovedReviewsService, submitPublicReviewService } from '../services/reviews'
import { createElectronicCheckoutService } from '../services/payments/checkout'
import { getElectronicPaymentReadiness } from '../services/payments/readiness'
import { getPaymentSettingsService } from '../services/payments/settings'

/**
 * Public (guest) storefront aggregate mounted at `/api/v1/public`.
 *
 * Unauthenticated, no `X-Staff-Id`, no RBAC. Purposefully exposes only
 * customer-safe data (active catalog, active zones, published pages) and
 * authoritative checkout that performs atomic stock deduction.
 */
export const publicRouter = new Hono<AppEnv>()

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

publicRouter.get('/categories', async (c) => {
  const db = getDatabase(c.env)
  const origin = new URL(c.req.url).origin
  return c.json({ data: await listPublicCategoriesService(db, origin) })
})

publicRouter.get('/products', async (c) => {
  const query = parseQuery(c, publicProductListQuerySchema)
  const db = getDatabase(c.env)
  const categoryId = await resolvePublicCategoryId(db, query.categorySlug, query.categoryId)
  const origin = new URL(c.req.url).origin
  return c.json(await listPublicProductsService(db, { ...query, categoryId }, origin))
})

publicRouter.get('/products/:productId', async (c) => {
  const { productId } = parseParams(c, productUuidParamSchema)
  const db = getDatabase(c.env)
  const origin = new URL(c.req.url).origin
  return c.json(await getPublicProductDetailService(db, productId, origin))
})

// ---------------------------------------------------------------------------
// Content, delivery zones, settings
// ---------------------------------------------------------------------------

publicRouter.get('/content/pages', async (c) => {
  return c.json({ data: await listContentPagesService(getDatabase(c.env)) })
})

publicRouter.get('/content/pages/:slug', async (c) => {
  const { slug } = parseParams(c, contentSlugParamSchema)
  return c.json(await getContentPageBySlugService(getDatabase(c.env), slug))
})

publicRouter.get('/delivery-zones', async (c) => {
  return c.json({ data: await listDeliveryZonesService(getDatabase(c.env)) })
})

publicRouter.get('/settings', async (c) => {
  return c.json(await publicSettingsService(getDatabase(c.env)))
})

// ---------------------------------------------------------------------------
// Store / shopping-experience reviews (Reviews Gate)
// ---------------------------------------------------------------------------

/**
 * Submit a review. It is ALWAYS created `pending` (§9) — no input, verified
 * customer, matching order or 5-star rating can auto-publish it. The response
 * is generic (`{ id, status: 'pending' }`) and never reveals whether the
 * server could verify a purchase or anything about an order (§13/§32).
 */
publicRouter.post('/reviews', async (c) => {
  const input = await parseBody(c, publicReviewSubmitSchema)
  return c.json(await submitPublicReviewService(getDatabase(c.env), input), 201)
})

/** Approved reviews ONLY (never pending/rejected), newest-approved first, plus
 *  an approved-only count + average summary (§23/§24). */
publicRouter.get('/reviews', async (c) => {
  const { limit } = parseQuery(c, publicReviewListQuerySchema)
  return c.json(await listPublicApprovedReviewsService(getDatabase(c.env), limit))
})

// ---------------------------------------------------------------------------
// Cart + checkout
// ---------------------------------------------------------------------------

/** Authoritative commercial quote — lines + totals + `quoteFingerprint`. */
publicRouter.post('/cart/verify', async (c) => {
  const input = await parseBody(c, publicCartVerifySchema)
  const db = getDatabase(c.env)
  const { electronicEnabled } = await getPaymentSettingsService(db)
  const electronicAvailable = getElectronicPaymentReadiness(
    c.env,
    electronicEnabled,
  ).availableForCheckout
  return c.json(await quoteCheckoutService(db, input, electronicAvailable))
})

publicRouter.post('/orders', async (c) => {
  const input = await parseBody(c, checkoutCreateSchema)
  const db = getDatabase(c.env)
  if (!isDatabaseConfigured(c.env)) {
    return c.json(
      { error: { code: 'checkout_unavailable', message: 'checkout is unavailable' } },
      503,
    )
  }

  // Gate B4 Stage 4: electronic is a separate branch sharing quote truth,
  // snapshots and idempotency — but never COD's payment semantics. COD stays
  // byte-for-byte unchanged below.
  if (input.paymentMethod === 'electronic') {
    const { replayed, body } = await createElectronicCheckoutService(db, c.env, input)
    return c.json(body, replayed ? 200 : 201)
  }

  const { replayed, body } = await createCheckoutOrderService(db, input)
  return c.json(body, replayed ? 200 : 201)
})

publicRouter.get('/orders/:number', async (c) => {
  const { number } = parseParams(c, orderByNumberParamSchema)
  const db = getDatabase(c.env)
  const order = await getOrderByNumber(db, number)
  if (order === undefined) throw new NotFoundError('order not found')
  const items = await listOrderItems(db, order.id)
  return c.json({
    id: order.id,
    number: order.number,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    subtotalMinor: order.subtotalMinor,
    deliveryFeeMinor: order.deliveryFeeMinor,
    totalMinor: order.totalMinor,
    currency: order.currency,
    createdAt: order.createdAt,
    items: items.map((item) => ({
      sku: item.skuSnapshot,
      productNameAr: item.productNameArSnapshot,
      productNameEn: item.productNameEnSnapshot,
      quantity: item.quantity,
      lineTotalMinor: item.lineTotalMinor,
    })),
  })
})

// ---------------------------------------------------------------------------
// Public media stream (unauthenticated)
// ---------------------------------------------------------------------------

publicRouter.get('/media/stream', async (c) => {
  const key = c.req.query('key')
  if (!key || !isSafeObjectKey(key)) {
    throw new ValidationError('a valid media object key query parameter is required')
  }

  const storage = getMediaStorage(c.env.MEDIA_BUCKET)
  const response = await buildMediaResponse(storage, key, c.req.header('Range'))
  if (response.status === 404) {
    return c.json({ error: { code: 'not_found', message: 'media not found' } }, 404)
  }
  return response
})
