import { Hono } from 'hono'

import type { AppEnv, Env } from './env'
import { errorHandler, notFoundHandler } from './http/errors'
import { routes } from './routes'
import { isDatabaseConfigured, getDatabase } from './services/db'
import { runReconciliationPass } from './services/payments/reconciliation'

const app = new Hono<AppEnv>()

app.route('/', routes)

app.notFound(notFoundHandler)
app.onError(errorHandler)

/**
 * Gate B4 Stage 4 — reconciliation sweep (§46). Cadence is set in
 * `wrangler.jsonc` (`triggers.crons`), not here. Safe under overlap (§76):
 * every mutation this reaches goes through the same order-locked,
 * guard-checked services every other caller uses — a second concurrent pass
 * re-reads current state and finds nothing left to do.
 */
async function scheduled(_event: ScheduledController, env: Env): Promise<void> {
  if (!isDatabaseConfigured(env)) return
  const db = getDatabase(env)
  try {
    const summary = await runReconciliationPass(db, env)
    console.log('reconciliation pass complete', summary)
  } catch (err) {
    console.error('reconciliation pass failed', err)
  }
}

export default {
  fetch: app.fetch,
  scheduled,
}
