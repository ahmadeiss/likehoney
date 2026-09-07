/**
 * Central HTTP error handling.
 *
 * Services throw `ServiceError` (machine-coded, portable) and the database
 * layer throws `DatabaseNotConfiguredError`; every route stays focused and
 * errors bubble here. Error responses carry a stable ASCII `code` that the UI
 * localizes for Arabic/English — never raw internals.
 */
import type { ErrorHandler, NotFoundHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ServiceError } from '@likehoney/shared'
import { DatabaseNotConfiguredError } from '@likehoney/db'

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

  console.error('unhandled error', err)
  return c.json({ error: { code: 'internal_error', message: 'internal server error' } }, 500)
}
