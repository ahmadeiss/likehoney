/**
 * Drizzle client factory for Neon PostgreSQL.
 *
 * The browser never reaches Neon directly — this factory is only ever called
 * from backend code (apps/api). No connection string is hard-coded anywhere:
 * the caller supplies it from its environment bindings/secrets at request
 * time. When no `DATABASE_URL` is configured, the factory throws
 * `DatabaseNotConfiguredError`, which the API maps to a 503.
 *
 * Transport notes for Cloudflare Workers (where sockets cannot outlive a
 * request handler and reads/writes must be stateless):
 *
 * - Plain queries ride the Neon `Pool` with `poolQueryViaFetch = true`, i.e.
 *   stateless HTTPS through the Neon drive API — safe to share across
 *   requests.
 * - `db.transaction(...)` must be a REAL PostgreSQL transaction, so drizzle's
 *   neon-serverless driver would open a connected `Client` (`await
 *   Pool.connect()`, a WebSocket) that workerd forbids to reuse across
 *   requests. Instead, each transaction spins up a fresh `Client` inside the
 *   current request, runs the whole callback against it, and closes it
 *   afterwards — the sanctioned Neon/Workers pattern. This keeps genuine
 *   atomicity (INVENTORY_RULES.md §3) without a persistent socket.
 *
 * Both must be set before any `Pool`/`Client` is constructed.
 */
import { Client, neonConfig } from '@neondatabase/serverless'
import { type NeonDatabase, drizzle } from 'drizzle-orm/neon-serverless'

import * as schema from './schema'

neonConfig.poolQueryViaFetch = true

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super('DATABASE_URL is not configured for this environment')
    this.name = 'DatabaseNotConfiguredError'
  }
}

export type Db = NeonDatabase<typeof schema>

/** Transaction client handed to `db.transaction(...)` callbacks. */
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** Either the top-level client or a transaction client (both support queries). */
export type DbClient = Db | DbTx

const cache = new Map<string, Db>()

export function getDb(databaseUrl: string): Db {
  if (!databaseUrl || databaseUrl.length === 0) {
    throw new DatabaseNotConfiguredError()
  }

  const cached = cache.get(databaseUrl)
  if (cached !== undefined) return cached

  const base = drizzle({ connection: databaseUrl, schema })

  // Workerd forbids reusing a connection across request handlers, so a shared
  // `Pool` (WebSocket) can never serve `db.transaction(...)`. We shadow
  // `transaction` on this instance with an implementation that opens a fresh,
  // request-scoped `Client` per call and closes it once the callback resolves.
  const transactional = base as Db & {
    transaction: Db['transaction']
  }
  transactional.transaction = (async (callback, config) => {
    const client = new Client(databaseUrl)
    await client.connect()
    try {
      const session = drizzle(client, { schema })
      return await session.transaction(callback, config)
    } finally {
      await client.end()
    }
  }) as Db['transaction']

  cache.set(databaseUrl, transactional)
  return transactional
}
