/**
 * Database access for API handlers. Reads the `DATABASE_URL` secret binding
 * and returns a typed Drizzle client, or signals 503 `db_unavailable` when no
 * database is configured (development safety net — the browser never holds
 * credentials; only this worker does).
 */
import { getDb, type Db } from '@likehoney/db'
import type { Env } from '../env'

export function getDatabase(env: Env): Db {
  return getDb(env.DATABASE_URL ?? '')
}

export function isDatabaseConfigured(env: Env): boolean {
  return typeof env.DATABASE_URL === 'string' && env.DATABASE_URL.length > 0
}

export type { Db }
