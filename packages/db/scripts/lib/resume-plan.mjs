/**
 * Pure resume-plan builder for the production catalog write.
 *
 * The write run reconciles EVERY seed product against two ground truths fetched
 * once, read-only, before any I/O:
 *
 *   mediaByProduct: Map<product_id, Array<{ objectKey, isPrimary }>> — the DB
 *     media ledger for the seed namespace (columns object_key / is_primary).
 *   r2KeySet:       Set of object keys currently present under `products/`.
 *
 * Every decision is one of:
 *
 *   ready    — a media DB row exists AND its object_key is already in R2:
 *              no media action; the transaction statements are all no-ops.
 *   repaired — a media DB row exists but its object_key is NOT in R2: the logo
 *              is uploaded to that EXISTING key and the DB association is kept
 *              (no media insert). This repairs a partially-landed product
 *              without inventing a new identity for the object.
 *   created  — no media DB row: a fresh `products/<id>/<uuid>.png` key is
 *              uploaded and the media row is inserted inside the transaction.
 *
 * The DOM contract between the mediaByProduct caller and this module is
 * `{ objectKey, isPrimary }`. The historic production failure — a TypeError
 * "Cannot read properties of undefined (reading 'split')" — was caused by the
 * writer reading `primaryRow.object_key` (`snake_case`, the DB alias) from a
 * map that stores `{ objectKey, isPrimary }` (camelCase). An empty or missing
 * object_key is NEVER replaced with a fallback here: it fails fast or is
 * reported as an invalid plan.
 */

import { randomUUID } from 'node:crypto'
import { SEED_COUNT, seedOrdinalLabel, seededProductId } from './catalog-seed.mjs'

export const OBJECT_KEY_RE =
  /^products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]+\.png$/

const ACTIONS = ['ready', 'repaired', 'created']

/** Decide the media action for one resolved seed product. Pure, deterministic. */
export function decideProductMedia({ product, mediaByProduct, r2KeySet }) {
  const productId = seededProductId(product.ordinal)
  const mediaRows = mediaByProduct.get(productId) ?? []
  const primaryRow = mediaRows.find((row) => row.isPrimary) ?? mediaRows[0]

  if (primaryRow) {
    const objectKey = primaryRow.objectKey
    if (typeof objectKey !== 'string' || objectKey.length === 0) {
      throw new Error(
        `${seedOrdinalLabel(product.ordinal)} (${productId}) has a media DB row with no object_key — ` +
          'that is not a valid repair target; the association must be fixed manually',
      )
    }
    return { objectKey, insertMedia: false, action: r2KeySet.has(objectKey) ? 'ready' : 'repaired' }
  }

  const objectKey = `products/${productId}/${randomUUID()}.png`
  return { objectKey, insertMedia: true, action: 'created' }
}

/**
 * Build the complete per-product decision list for the whole seed namespace
 * BEFORE any R2 PUT or DB write. The caller validates it and the associated
 * DB statement plan, then executes.
 */
export function buildResumePlan({ products, mediaByProduct, r2KeySet }) {
  return products.map((product) => {
    const { objectKey, insertMedia, action } = decideProductMedia({
      product,
      mediaByProduct,
      r2KeySet,
    })
    return {
      ordinal: product.ordinal,
      productId: seededProductId(product.ordinal),
      objectKey,
      insertMedia,
      action,
    }
  })
}

/**
 * Validate the complete resume plan before ANY write. Returns a list of human
 * problems; an empty list means the plan is safe to execute.
 */
export function validateResumePlan(
  decisions,
  { mediaByProduct = new Map(), r2KeySet = new Set() } = {},
) {
  const problems = []
  const seenOrdinal = new Set()
  const seenId = new Set()
  const seenKeys = new Set()

  if (decisions.length !== SEED_COUNT) {
    problems.push(
      `resume plan covers ${decisions.length} products, expected SEED_COUNT ${SEED_COUNT}`,
    )
  }

  for (const decision of decisions) {
    const { ordinal, productId, action, objectKey, insertMedia } = decision
    const label = seedOrdinalLabel(ordinal)

    if (seenOrdinal.has(ordinal)) {
      problems.push(`${label}: duplicate ordinal in the resume plan`)
    }
    seenOrdinal.add(ordinal)

    if (seenId.has(productId)) {
      problems.push(`${label}: duplicate product id in the resume plan`)
    }
    seenId.add(productId)

    if (!ACTIONS.includes(action)) {
      problems.push(`${label}: unknown action ${JSON.stringify(action)}`)
    }

    if (typeof objectKey !== 'string' || !OBJECT_KEY_RE.test(objectKey)) {
      problems.push(
        `${label}: objectKey must match products/<uuid>/<file>.png (got ${JSON.stringify(objectKey)})`,
      )
    } else {
      if (seenKeys.has(objectKey)) {
        problems.push(`${label}: objectKey reused across products`)
      }
      seenKeys.add(objectKey)
    }

    if (insertMedia !== (action === 'created')) {
      problems.push(`${label}: insertMedia=${insertMedia} inconsistent with action=${action}`)
    }

    const mediaRows = mediaByProduct.get(productId) ?? []
    if (action === 'created') {
      if (mediaRows.length > 0) {
        problems.push(`${label}: action=created but a media DB row already exists`)
      }
      if (typeof objectKey === 'string' && r2KeySet.has(objectKey)) {
        problems.push(`${label}: created key already exists in R2 (logic error: key reuse)`)
      }
    } else {
      if (mediaRows.length === 0) {
        problems.push(`${label}: action=${action} but no media DB row exists`)
      } else if (!mediaRows.some((row) => row.objectKey === objectKey)) {
        problems.push(`${label}: ${action} key is not the key of the existing media DB row`)
      }
      if (action === 'repaired' && typeof objectKey === 'string' && r2KeySet.has(objectKey)) {
        problems.push(`${label}: action=repaired but the key is already present in R2`)
      }
    }
  }

  return problems
}

/**
 * Validate a single product's SQL statement plan (already-ordered: product →
 * options/values → variants → variant_options → balances → movements → media).
 * Checks structure and placeholder/params parity so a programming error is
 * caught before any R2 PUT.
 */
export function validateDbStatements({ statements }) {
  const problems = []
  if (!Array.isArray(statements) || statements.length === 0) {
    problems.push('statement plan is empty')
    return problems
  }

  statements.forEach((statement, index) => {
    const tag = `statement ${index + 1}`
    if (!statement || typeof statement.sql !== 'string' || statement.sql.trim().length === 0) {
      problems.push(`${tag}: missing sql`)
      return
    }
    if (!Array.isArray(statement.params)) {
      problems.push(`${tag}: params is not an array`)
      return
    }

    const placeholders = [...statement.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]))
    if (placeholders.length === 0) {
      if (statement.params.length > 0) {
        problems.push(
          `${tag}: ${statement.params.length} params bound but the SQL has no placeholders`,
        )
      }
      return
    }
    const max = Math.max(...placeholders)
    if (max !== statement.params.length) {
      problems.push(
        `${tag}: ${statement.params.length} params bound but the SQL references $${max}`,
      )
    }
    for (let n = 1; n <= max; n++) {
      if (!placeholders.includes(n)) {
        problems.push(`${tag}: placeholder $${n} is never bound`)
      }
    }
  })

  const first = statements[0]
  if (typeof first?.sql === 'string' && !/^\s*INSERT INTO products\b/i.test(first.sql)) {
    problems.push('statement 1 is not the products insert — FK order is broken')
  }
  return problems
}
