/**
 * Central HTTP error handling.
 *
 * Services throw `ServiceError` (machine-coded, portable) and the database
 * layer throws `DatabaseNotConfiguredError`; every route stays focused and
 * errors bubble here. Error responses carry a stable ASCII `code` that the UI
 * localizes for Arabic/English — never raw internals.
 *
 * Database failures are logged as a SAFE structured diagnostic (SQLSTATE +
 * table + constraint + the server message only) so schema drift like
 * "42703 column ... does not exist" is immediately legible in Worker logs.
 * The raw Postgres error object is deliberately NOT logged: its `detail` can
 * carry captured values (duplicate-key payloads, etc.) — server logs must
 * never contain customer data or secrets. The client still receives only a
 * generic `internal_error`.
 */
import type { ErrorHandler, NotFoundHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ServiceError } from '@likehoney/shared'
import { DatabaseNotConfiguredError } from '@likehoney/db'

/**
 * A safe, non-secret description of a Postgres failure, extracted from a
 * Drizzle/driver error chain. Returns `null` when `err` is not a database
 * error. Nothing here is ever returned to the browser — it exists only for
 * server-side logs.
 */
export interface DbFailureDiagnostic {
  /** PostgreSQL SQLSTATE (e.g. `42703` column/relation missing, `42P01` relation missing, or a custom `LH…` code). */
  sqlstate: string
  /** The offending table, when the driver reports one. */
  table: string | null
  /** The violating constraint name, when the driver reports one. */
  constraint: string | null
  /** The server-generated message (column/relation/constraint facts — never bound values). */
  message: string
}

/** A real SQLSTATE (or custom `LH…` SQLSTATE) is exactly five `[0-9A-Z]` characters. */
const SQLSTATE_RE = /^[0-9A-Z]{5}$/

export function describeDbFailure(err: unknown): DbFailureDiagnostic | null {
  let node: unknown = err
  for (let depth = 0; depth < 5 && node != null; depth += 1) {
    if (typeof node !== 'object' || node === null) return null
    const record = node as {
      code?: unknown
      table?: unknown
      constraint?: unknown
      message?: unknown
    }
    const code = record.code
    if (typeof code === 'string' && SQLSTATE_RE.test(code)) {
      const table = record.table
      const constraint = record.constraint
      const message = record.message
      return {
        sqlstate: code,
        table: typeof table === 'string' && table.length > 0 ? table : null,
        constraint: typeof constraint === 'string' && constraint.length > 0 ? constraint : null,
        message: typeof message === 'string' && message.length > 0 ? message : `SQLSTATE ${code}`,
      }
    }
    node = 'cause' in node ? (node as { cause?: unknown }).cause : null
  }
  return null
}

export interface ErrorPayload {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export const notFoundHandler: NotFoundHandler = (c) => {
  return c.json(
    { error: { code: 'not_found', message: 'route not found' } satisfies ErrorPayload['error'] },
    404,
  )
}

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof ServiceError) {
    return c.json(
      { error: { code: err.serviceCode, message: err.message, details: err.details } },
      err.status as ContentfulStatusCode,
    )
  }

  if (err instanceof DatabaseNotConfiguredError) {
    return c.json({ error: { code: 'db_unavailable', message: err.message } }, 503)
  }

  const dbFailure = describeDbFailure(err)
  if (dbFailure !== null) {
    console.error('request failed: database error', dbFailure)
  } else {
    console.error('unhandled error', err)
  }
  return c.json({ error: { code: 'internal_error', message: 'internal server error' } }, 500)
}
