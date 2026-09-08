/**
 * Production vs development database-target safety for the db scripts.
 *
 * Neon branches can share the SAME PostgreSQL database name (`likehoneydb`):
 * the production branch also legitimately uses the database name `likehoneydb`.
 * The database PATHNAME therefore MUST NOT be used to decide whether a
 * connection is Development or Production. Environments are identified by
 * endpoint/host identity (host + port + database), not by the database name
 * alone.
 */

const DEFAULT_PG_PORT = 5432

function stripIpv6Brackets(host) {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

function normalizeScheme(protocol) {
  const scheme = protocol.replace(/:$/, '').toLowerCase()
  // `postgres://` and `postgresql://` are the same concrete connection.
  return scheme === 'postgres' || scheme === 'postgresql' ? 'postgresql' : scheme
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseUrl(value) {
  const parsed = value instanceof URL ? new URL(value.href) : new URL(value)
  return parsed
}

/**
 * Reduces a connection string to the normalized identity that identifies the
 * actual connection target: scheme (normalized), lowercased host (IPv6
 * brackets stripped), normalized port, and database name. Credentials and
 * query parameters are deliberately excluded — they are not part of endpoint
 * identity and must never be compared or printed.
 */
export function resolveConnectionTarget(value) {
  const parsed = parseUrl(value)
  const rawPort = parsed.port === '' ? '' : Number(parsed.port)
  const port = parsed.port === '' || rawPort === DEFAULT_PG_PORT ? DEFAULT_PG_PORT : rawPort
  const database = safeDecode(parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '')) || null
  return {
    scheme: normalizeScheme(parsed.protocol),
    host: stripIpv6Brackets(parsed.hostname.toLowerCase()),
    port,
    database,
  }
}

/** True when two normalized targets point at the same endpoint/database. */
export function isSameConnectionTarget(a, b) {
  return (
    a.scheme === b.scheme && a.host === b.host && a.port === b.port && a.database === b.database
  )
}

/**
 * Validates a PRODUCTION_DATABASE_URL and fails closed when it cannot be
 * distinguished from an obvious development / local target.
 *
 * @param {string} value the PRODUCTION_DATABASE_URL
 * @param {{ devUrlValue?: string }} opts optional known Development DATABASE_URL
 * @returns {{ ok: true, target: string } | { ok: false, reason: string }}
 *   `target` is a redacted host + database path (never credentials) for logging.
 */
export function validateProductionTarget(value, { devUrlValue } = {}) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return { ok: false, reason: 'PRODUCTION_DATABASE_URL is not a valid URL' }
  }

  const host = stripIpv6Brackets(parsed.hostname.toLowerCase())
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return { ok: false, reason: 'Refusing a localhost database target' }
  }

  if (devUrlValue) {
    let devTarget
    try {
      devTarget = resolveConnectionTarget(devUrlValue)
    } catch {
      throw new Error('Development DATABASE_URL in packages/db/.env is not a valid URL — refusing')
    }
    if (isSameConnectionTarget(resolveConnectionTarget(parsed), devTarget)) {
      return {
        ok: false,
        reason:
          'PRODUCTION_DATABASE_URL matches the development branch (same Neon endpoint/connection target) — refusing',
      }
    }
  }

  return { ok: true, target: `${parsed.host}${parsed.pathname}` }
}
