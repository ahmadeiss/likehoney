import { Hono } from 'hono'
import {
  adminReviewListQuerySchema,
  adminReviewModerateSchema,
  reviewIdParamSchema,
} from '@likehoney/shared'

import type { AppEnv } from '../env'
import { currentStaffId, requirePermission } from '../http/auth'
import { parseBody, parseParams, parseQuery } from '../http/request'
import { getDatabase } from '../services/db'
import {
  getAdminReviewDetailService,
  listAdminReviewsService,
  moderateReviewService,
} from '../services/reviews'

/**
 * Admin store-review moderation — every route requires `reviews:moderate`
 * (owner/admin authority by default; never in the employee default set).
 * The public storefront never reaches this router. Moderation is approve /
 * reject only — there is no edit-text and no delete route (§51/§52).
 */
export const reviewsRouter = new Hono<AppEnv>()

reviewsRouter.get('/', requirePermission('reviews:moderate'), async (c) => {
  const query = parseQuery(c, adminReviewListQuerySchema)
  return c.json(await listAdminReviewsService(getDatabase(c.env), query))
})

reviewsRouter.get('/:reviewId', requirePermission('reviews:moderate'), async (c) => {
  const { reviewId } = parseParams(c, reviewIdParamSchema)
  return c.json(await getAdminReviewDetailService(getDatabase(c.env), reviewId))
})

reviewsRouter.post('/:reviewId/approve', requirePermission('reviews:moderate'), async (c) => {
  const { reviewId } = parseParams(c, reviewIdParamSchema)
  const { note } = await parseBody(c, adminReviewModerateSchema)
  const staffId = await currentStaffId(c)
  return c.json(await moderateReviewService(getDatabase(c.env), reviewId, 'approve', staffId, note))
})

reviewsRouter.post('/:reviewId/reject', requirePermission('reviews:moderate'), async (c) => {
  const { reviewId } = parseParams(c, reviewIdParamSchema)
  const { note } = await parseBody(c, adminReviewModerateSchema)
  const staffId = await currentStaffId(c)
  return c.json(await moderateReviewService(getDatabase(c.env), reviewId, 'reject', staffId, note))
})
