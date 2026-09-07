/**
 * Request input validation helpers.
 *
 * Every request input (body, query, params) is validated against a Zod schema
 * from `@likehoney/shared` at the API edge. Validation failures surface as
 * `ValidationError` with a flat list of issue details for Arabic/English UI
 * display.
 */
import type { Context } from 'hono'
import type { ZodIssue, ZodType } from 'zod'
import { ValidationError } from '@likehoney/shared'

interface IssueDetail {
  field: string
  code: string
  message: string
}

function formatIssues(issues: ZodIssue[]): IssueDetail[] {
  return issues.map((issue) => ({
    field: issue.path.join('.'),
    code: issue.code,
    message: issue.message,
  }))
}

export async function parseBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new ValidationError('request body must be valid JSON')
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new ValidationError('request body validation failed', formatIssues(result.error.issues))
  }
  return result.data
}

export function parseQuery<T>(c: Context, schema: ZodType<T>): T {
  const result = schema.safeParse(c.req.query())
  if (!result.success) {
    throw new ValidationError('query validation failed', formatIssues(result.error.issues))
  }
  return result.data
}

export function parseParams<T>(c: Context, schema: ZodType<T>): T {
  const result = schema.safeParse(c.req.param())
  if (!result.success) {
    throw new ValidationError(
      'path parameters validation failed',
      formatIssues(result.error.issues),
    )
  }
  return result.data
}
