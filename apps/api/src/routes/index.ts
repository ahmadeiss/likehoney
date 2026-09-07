import { Hono } from 'hono'
import { API_PREFIX } from '@likehoney/shared'

import type { AppEnv } from '../env'
import { health } from './health'
import { v1Routes } from './v1'

/**
 * Route aggregation for the API.
 *
 * `GET /health` is the unversioned liveness probe; every production endpoint
 * lives under the versioned prefix from `@likehoney/shared` (`/api/v1`).
 */
export const routes = new Hono<AppEnv>()

routes.route('/health', health)
routes.route(API_PREFIX, v1Routes)
