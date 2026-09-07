import { Hono } from 'hono'

import type { AppEnv } from '../env'
import { authRouter } from './auth'
import { categoriesRouter } from './categories'
import { customersRouter } from './customers'
import { inventoryRouter } from './inventory'
import { mediaRouter } from './media'
import { ordersRouter } from './orders'
import { paymentsRouter } from './payments'
import { productsRouter } from './products'
import { publicRouter } from './public'
import { reportsRouter } from './reports'
import { reviewsRouter } from './reviews'
import { settingsRouter } from './settings'
import { staffRouter } from './staff'
import { storeSalesRouter } from './store-sales'
import { suppliersRouter } from './suppliers'
import { variantsRouter } from './variants'

/**
 * Versioned API v1 aggregate. Everything under this router requires the
 * RBAC foundation middleware (`requirePermission` per route), EXCEPT the
 * `public` sub-router (intentionally unauthenticated), the `auth` routes
 * (sign-in itself), and `payments` (server-to-server webhook — secured by
 * provider signature verification, not staff RBAC; Gate B4 Stage 4).
 * `/health` stays unversioned on the root app.
 */
export const v1Routes = new Hono<AppEnv>()

v1Routes.route('/auth', authRouter)
v1Routes.route('/categories', categoriesRouter)
v1Routes.route('/suppliers', suppliersRouter)
v1Routes.route('/products', productsRouter)
v1Routes.route('/variants', variantsRouter)
v1Routes.route('/inventory', inventoryRouter)
v1Routes.route('/orders', ordersRouter)
v1Routes.route('/store-sales', storeSalesRouter)
v1Routes.route('/customers', customersRouter)
v1Routes.route('/reports', reportsRouter)
v1Routes.route('/reviews', reviewsRouter)
v1Routes.route('/media', mediaRouter)
v1Routes.route('/settings', settingsRouter)
v1Routes.route('/staff', staffRouter)
v1Routes.route('/public', publicRouter)
v1Routes.route('/payments', paymentsRouter)
