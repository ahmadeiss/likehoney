import { Hono } from 'hono'

/**
 * Liveness probe used to verify the Worker builds and answers.
 * The only route permitted during Phase 0.
 */
export const health = new Hono()

health.get('/', (c) => c.json({ status: 'ok' }))
