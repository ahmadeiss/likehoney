/**
 * Strict, read-only normalization of the production catalog fingerprint.
 *
 * The Neon serverless driver (`@neondatabase/serverless`) resolves
 * `sql\`...\`` to a plain array of row OBJECTS — never `{ rows: [...] }`
 * unless `fullResults: true` is passed, which this script does not. Row keys
 * are the column aliases exactly as written in SQL. Example:
 *
 *   const rows = await sql`SELECT count(*)::int AS product_count FROM products`
 *   // -> [{ product_count: 37 }]
 *
 * This module converts raw Neon/Postgres query bodies into the strict contract
 *
 *   { productCount: number, categoryCount: number, supplierCount: number }
 *
 * where every value is finite, an integer and >= 0. Anything else fails safely
 * with a diagnostic that never includes a connection string or secret.
 */

function toNonNegativeInteger(label, value) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(`Unable to parse production ${label} count`)
  }
  const s = typeof value === 'string' ? value.trim() : value
  if (typeof value === 'string' && s === '') {
    throw new Error(`Unable to parse production ${label} count`)
  }
  const n = typeof value === 'number' ? value : Number(s)
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Unable to parse production ${label} count`)
  }
  return n
}

/**
 * Pull a single scalar out of a Neon/Postgres rows array. Returns undefined for
 * an empty array, a non-array, a row without the column, or a non-object row —
 * all of which downstream parsing rejects as a safe failure.
 */
export function pluckCount(rows, column) {
  if (!Array.isArray(rows) || rows.length === 0) return undefined
  const row = rows[0]
  return row && typeof row === 'object' ? row[column] : undefined
}

/**
 * Normalize raw count values (number from `::int`, or string from bare
 * `count(*)`) into the strict snapshot contract. Throws a per-key diagnostic
 * such as `Unable to parse production product count` — never prints secrets.
 */
export function parseProductionSnapshot({ products, categories, suppliers }) {
  return {
    productCount: toNonNegativeInteger('product', products),
    categoryCount: toNonNegativeInteger('category', categories),
    supplierCount: toNonNegativeInteger('supplier', suppliers),
  }
}

/**
 * Pure delta decision between the immutable target and the current product
 * count. `productsToCreate` is clamped at 0: at/over target means zero writes;
 * the caller decides whether being over target is an error vs. idle.
 */
export function catalogDelta(target, currentCount) {
  const productsToCreate = target - currentCount
  return {
    productsToCreate: Math.max(0, productsToCreate),
    atTarget: productsToCreate === 0,
    overTarget: productsToCreate < 0,
  }
}
