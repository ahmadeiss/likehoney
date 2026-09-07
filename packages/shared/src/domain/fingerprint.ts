/**
 * Deterministic fingerprints for checkout.
 *
 * Two independent axes (Gate B0):
 *  - `request_fingerprint` — the customer's *logical checkout intent* (cart,
 *    zone, method, contact, address, note). Guards the idempotency key: same
 *    key + changed intent ⇒ `idempotency_conflict`.
 *  - `quoteFingerprint` — the server's *commercial truth* (unit prices,
 *    quantities, zone, fee, subtotal, total, currency). Guards price/fee drift:
 *    stale quote at submit ⇒ `checkout_totals_changed`.
 *
 * Both are SHA-256 hex over a canonical JSON string. `crypto.subtle` is
 * available in Cloudflare Workers and Node ≥ 20.
 */

/** NFC-normalize, trim, collapse internal whitespace, casefold. */
export function normalizeIntentText(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Canonical JSON: object keys sorted recursively, arrays keep their order,
 * `undefined` dropped. Stable across engines so the same value always hashes
 * identically.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = sortDeep(v)
    }
    return out
  }
  return value
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** SHA-256 hex of the canonical form of `value`. */
export async function fingerprint(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value))
}
