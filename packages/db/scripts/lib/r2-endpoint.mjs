/**
 * Shared, validated Cloudflare R2 S3 endpoint resolution for the catalog
 * seed CLI (write path) and the read-only audit (r2-sign.mjs).
 *
 * The Cloudflare R2 S3 endpoint is always
 *
 *   https://<ACCOUNT_ID>.r2.cloudflarestorage.com
 *
 * The raw Cloudflare Account ID is never a valid hostname on its own —
 * pointing the S3 client at the bare id produces `getaddrinfo ENOTFOUND
 * <account-id>`. This resolver fails closed instead.
 *
 * `R2_ENDPOINT` may override the default origin (e.g. a jurisdiction-specific
 * endpoint such as `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`) but it
 * must be a full https:// URL whose hostname ends with
 * `.r2.cloudflarestorage.com` — a bare account id is never accepted there.
 */

export const R2_ENDPOINT_SUFFIX = '.r2.cloudflarestorage.com'

const BARE_ACCOUNT_ID_RE = /^[A-Za-z0-9-]+$/

/**
 * Resolve the S3 hostname for a configured account. Throws with a clear,
 * secret-free reason on anything that would otherwise be sent to the network.
 *
 * @param {{ accountId?: string, endpoint?: string }} config
 * @returns {string} hostname, e.g. `77b859059ea00d59cb87601928865b20.r2.cloudflarestorage.com`
 */
export function resolveR2Host({ accountId, endpoint }) {
  const override = endpoint?.trim()
  if (override) {
    let parsed
    try {
      parsed = new URL(override)
    } catch {
      throw new Error(
        `R2_ENDPOINT must be a full https:// URL whose hostname ends with ${R2_ENDPOINT_SUFFIX} (the value did not parse as a URL)`,
      )
    }
    if (parsed.protocol !== 'https:') {
      throw new Error(`R2_ENDPOINT must use https:// (got protocol ${parsed.protocol})`)
    }
    if (!parsed.hostname.endsWith(R2_ENDPOINT_SUFFIX)) {
      throw new Error(
        `R2_ENDPOINT hostname must end with ${R2_ENDPOINT_SUFFIX} (got ${parsed.hostname}). A bare Cloudflare account id is not a valid endpoint.`,
      )
    }
    const id = String(accountId ?? '').trim()
    if (id && parsed.hostname.split('.')[0] !== id) {
      throw new Error(
        `R2_ENDPOINT hostname must begin with the configured R2_ACCOUNT_ID (first label ${parsed.hostname.split('.')[0]} ≠ ${id})`,
      )
    }
    if (parsed.pathname !== '/') {
      throw new Error('R2_ENDPOINT must not include a path, query or fragment')
    }
    return parsed.hostname
  }

  const id = String(accountId ?? '').trim()
  if (!id) {
    throw new Error('R2_ACCOUNT_ID is required (a bare Cloudflare account id)')
  }
  if (!BARE_ACCOUNT_ID_RE.test(id)) {
    throw new Error(
      'R2_ACCOUNT_ID must be a bare Cloudflare account id (alphanumeric + hyphens only — no scheme, dots, slashes or @). For a custom origin set R2_ENDPOINT to a full https:// URL.',
    )
  }
  return `${id}${R2_ENDPOINT_SUFFIX}`
}

/**
 * Fail-fast wrapper for the CLI: never throws.
 * @returns {{ ok: true, host: string } | { ok: false, reason: string }}
 */
export function validateR2Config({ accountId, endpoint }) {
  try {
    return { ok: true, host: resolveR2Host({ accountId, endpoint }) }
  } catch (err) {
    return { ok: false, reason: err.message }
  }
}
