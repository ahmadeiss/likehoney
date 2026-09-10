/**
 * READ-ONLY audit of the production catalog seed outcome.
 *
 * No INSERT / UPDATE / DELETE / DELETE-OBJECT here — only SELECT queries and
 * GET/HEAD against the R2 media bucket. The module exists to answer, after an
 * interrupted or failed write run:
 *
 *   what of the planned seed actually landed (products / variants /
 *   movements / media associations / R2 objects),
 *   what a partially-landed seed product looks like (which ordinal, which
 *   children rows, which R2 media object is missing),
 *   what is orphaned or missing,
 *   and what safe, nested cause produced a bare `fetch failed`.
 *
 * The audit target is the STABLE 99-product namespace (#002-#100) from
 * `fullSeedPlan()` — it is derived from the immutable seed constants, never
 * from the live product count, so a partial write can never silently rename
 * seeded products. Each seed product is reconciled individually into
 * complete / partial / missing.
 *
 * Everything is designed so the same functions are exercised by unit tests
 * against fake rows + a fake object listing.
 */

import {
  SEED_START_ORDINAL,
  fullSeedPlan,
  seededProductId,
  seedOrdinalLabel,
} from './catalog-seed.mjs'
import { safeCauseReport } from './safe-errors.mjs'
import { headR2Bucket, listR2Objects } from './r2-sign.mjs'
import { resolveR2Host } from './r2-endpoint.mjs'

export const SEED_MOVEMENT_TYPE = 'INITIAL_STOCK'
export const SEED_MOVEMENT_REASON = 'Initial stock from Like Honey catalog seed'
export const SEED_OBJECT_PREFIX = 'products/'
export const SEED_OBJECT_KEY_RE =
  /^products\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f-]+\.png$/

/** Expected counts derived purely from the (deterministic) plan. */
export function expectedFromPlan(plan) {
  const variants = plan.reduce((sum, p) => sum + p.variants.length, 0)
  const movements = plan.reduce(
    (sum, p) => sum + p.variants.filter((v) => v.quantityOnHand > 0).length,
    0,
  )
  return { products: plan.length, variants, movements, media: plan.length }
}

/** Parse the seeded product id embedded in an object key, or undefined. */
export function objectKeyProductId(key) {
  const match = SEED_OBJECT_KEY_RE.exec(key ?? '')
  return match ? match[1] : undefined
}

/**
 * Pure comparison of the R2 listing against the DB media ledger.
 * - missing = DB objects the bucket does not contain
 * - orphan  = bucket objects no DB row references
 * - seeded  = bucket objects whose embedded product id is one of the planned
 */
export function classifyR2Objects({ listed, dbKeys, seededIds }) {
  const seededIdSet = new Set(seededIds)
  const dbKeySet = new Set(dbKeys)
  const listedSet = new Set(listed)
  const seeded = []
  const orphan = []
  for (const key of listed) {
    const productId = objectKeyProductId(key)
    if (productId && seededIdSet.has(productId)) seeded.push(key)
    if (!dbKeySet.has(key)) orphan.push(key)
  }
  const missing = dbKeys.filter((key) => !listedSet.has(key))
  return { seeded, orphan, missing }
}

/**
 * Reconcile every seed product against what actually landed (read-only).
 * Each plan entry is classified:
 *   - `missing`  — no products row exists,
 *   - `complete` — products row + all variants + all movements + ≥1 media row
 *                  and (when the R2 listing was provided) every referenced R2
 *                  media object exists,
 *   - `partial`  — anything in between (the DB rows that did land are still
 *                  reported exactly, including which R2 object is missing).
 *
 * `listed` undefined means the R2 side could not be probed — R2 completeness
 * is then not part of the classification (and missingR2 is left empty).
 */
export function reconcileSeedStates({
  plan,
  productRows = [],
  variantRows = [],
  movementRows = [],
  mediaRows = [],
  listed,
}) {
  const canCheckR2 = Array.isArray(listed)
  const listedSet = new Set(canCheckR2 ? listed : [])

  const productMap = new Map(productRows.map((row) => [row.id, row]))
  const variantsByProduct = new Map()
  for (const row of variantRows) {
    const list = variantsByProduct.get(row.product_id) ?? []
    list.push({ sku: row.sku })
    variantsByProduct.set(row.product_id, list)
  }
  const movementsByProduct = new Map()
  for (const row of movementRows) movementsByProduct.set(row.product_id, row.n)
  const mediaByProduct = new Map()
  for (const row of mediaRows) {
    const list = mediaByProduct.get(row.product_id) ?? []
    list.push({ objectKey: row.object_key, isPrimary: row.is_primary })
    mediaByProduct.set(row.product_id, list)
  }

  const perProduct = []
  for (const product of plan) {
    const id = seededProductId(product.ordinal)
    const row = productMap.get(id)
    const variants = variantsByProduct.get(id) ?? []
    const movements = movementsByProduct.get(id) ?? 0
    const media = mediaByProduct.get(id) ?? []
    const expectedVariants = product.variants.length
    const expectedMovements = product.variants.filter((v) => v.quantityOnHand > 0).length
    const mediaKeys = media.map((m) => m.objectKey)
    const missingR2 = canCheckR2 ? mediaKeys.filter((key) => !listedSet.has(key)) : []

    let state
    if (!row) {
      state = 'missing'
    } else if (
      variants.length === expectedVariants &&
      movements === expectedMovements &&
      mediaKeys.length >= 1 &&
      missingR2.length === 0
    ) {
      state = 'complete'
    } else {
      state = 'partial'
    }

    perProduct.push({
      ordinal: product.ordinal,
      label: seedOrdinalLabel(product.ordinal),
      id,
      nameEn: row?.name_en ?? product.nameEn,
      nameAr: row?.name_ar ?? product.nameAr,
      status: row?.status ?? null,
      categoryCode: row?.category_code ?? null,
      categoryName: row?.category_name_en ?? null,
      supplierName: row?.supplier_name_en ?? null,
      state,
      expected: { variants: expectedVariants, movements: expectedMovements, media: 1 },
      found: {
        variants: row ? variants.length : 0,
        movements: row ? movements : 0,
        media: row ? mediaKeys.length : 0,
      },
      skus: variants.map((v) => v.sku),
      mediaKeys,
      missingR2,
    })
  }

  const complete = perProduct.filter((p) => p.state === 'complete').length
  const partial = perProduct.filter((p) => p.state === 'partial').length
  const missing = perProduct.filter((p) => p.state === 'missing').length
  return { perProduct, complete, partial, missing }
}

async function runDbSection(sql, ids, plan, state) {
  const db = {
    currentProducts: state.productCount,
    fullSeedTarget: plan.length,
    seededProductsFound: 0,
    seededVariantsFound: 0,
    distinctSkus: 0,
    skuDuplicates: 0,
    seededMovementsFound: 0,
    seededMediaFound: 0,
    expected: expectedFromPlan(plan),
    complete: 0,
    partial: 0,
    missing: 0,
    perProduct: [],
    diagnosis: [],
  }
  const guard = async (label, run) => {
    try {
      return await run()
    } catch (err) {
      db.diagnosis.push(`[${label}] ${safeCauseReport(err).join(' ⮑ ')}`)
      return undefined
    }
  }

  if (ids.length === 0) return db

  const productRows =
    (await guard(
      'products',
      () =>
        sql`SELECT p.id, p.name_en, p.name_ar, p.status,
             c.code AS category_code, c.name_en AS category_name_en,
             s.name_en AS supplier_name_en
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.id = ANY(${ids}::uuid[])`,
    )) ?? []
  db.seededProductsFound = productRows.length

  const variantRows =
    (await guard(
      'variants',
      () =>
        sql`SELECT v.product_id AS product_id, v.sku AS sku
        FROM product_variants v
        WHERE v.product_id = ANY(${ids}::uuid[])`,
    )) ?? []
  const skus = new Set(variantRows.map((row) => row.sku))
  db.seededVariantsFound = variantRows.length
  db.distinctSkus = skus.size
  db.skuDuplicates = variantRows.length - skus.size

  const movementRows =
    (await guard(
      'movements',
      () =>
        sql`SELECT v.product_id AS product_id, count(*)::int AS n
        FROM inventory_movements m
        JOIN product_variants v ON v.id = m.variant_id
        WHERE v.product_id = ANY(${ids}::uuid[])
          AND m.movement_type = ${SEED_MOVEMENT_TYPE}
          AND m.reason = ${SEED_MOVEMENT_REASON}
        GROUP BY v.product_id`,
    )) ?? []
  db.seededMovementsFound = movementRows.reduce((sum, row) => sum + row.n, 0)

  const mediaRows =
    (await guard(
      'media',
      () =>
        sql`SELECT product_id AS product_id, object_key AS object_key, is_primary AS is_primary
        FROM product_media
        WHERE product_id = ANY(${ids}::uuid[])
          AND object_key LIKE 'products/%'`,
    )) ?? []
  db.seededMediaFound = mediaRows.length

  const dbKeys = await guard(
    'media-object-keys',
    () =>
      sql`SELECT object_key AS object_key FROM product_media WHERE object_key LIKE 'products/%'`,
  )
  db.dbObjectKeys = dbKeys ? dbKeys.map((row) => row.object_key) : undefined
  db._rows = { productRows, variantRows, movementRows, mediaRows }
  return db
}

/**
 * Audit one read-only pass. `sql` is a Neon client, `state` the current
 * fingerprint ({ productCount, ... }), `r2Config` carries credentials when
 * present (may be partial/missing → probes are skipped, never fail hard).
 *
 * The `target` parameter is accepted for call-site compatibility but the plan
 * is always the stable `fullSeedPlan()` — never the count remainder.
 */
export async function runAudit({ sql, state, r2Config }) {
  const { products: plan } = fullSeedPlan()
  const ids = plan.map((p) => seededProductId(p.ordinal))
  const db = await runDbSection(sql, ids, plan, state)
  const { productRows, variantRows, movementRows, mediaRows } = db._rows

  const bucket = r2Config.bucket ?? 'likehoney-media'
  const r2 = {
    configured: Boolean(r2Config.accountId && r2Config.accessKey && r2Config.secretKey),
    bucket,
    connectivity:
      r2Config.accountId && r2Config.accessKey && r2Config.secretKey ? 'pending' : 'not configured',
    connectivityDetail: [],
    seededObjects: 0,
    orphanObjects: [],
    missingObjects: [],
    listedTotal: 0,
    referencedInDb: db.dbObjectKeys?.length ?? 0,
    diagnosis: [],
  }

  let listed
  if (r2.configured) {
    try {
      r2.endpointHost = resolveR2Host({
        accountId: r2Config.accountId,
        endpoint: r2Config.endpoint,
      })
    } catch (err) {
      r2.connectivity = 'failed'
      r2.connectivityDetail = [err.message]
      r2.diagnosis.push(`[R2 configuration] ${err.message}`)
    }
  }
  if (r2.configured && r2.connectivity === 'pending') {
    try {
      await headR2Bucket({
        accountId: r2Config.accountId,
        endpoint: r2Config.endpoint,
        accessKey: r2Config.accessKey,
        secretKey: r2Config.secretKey,
        bucket,
      })
      r2.connectivity = 'ok'
    } catch (err) {
      r2.connectivity = 'failed'
      r2.connectivityDetail = safeCauseReport(err)
      r2.diagnosis.push(`[R2 head bucket] ${r2.connectivityDetail.join(' ⮑ ')}`)
    }
    if (r2.connectivity === 'ok') {
      try {
        listed = await listR2Objects({
          accountId: r2Config.accountId,
          endpoint: r2Config.endpoint,
          accessKey: r2Config.accessKey,
          secretKey: r2Config.secretKey,
          bucket,
          prefix: SEED_OBJECT_PREFIX,
        })
        r2.listedTotal = listed.length
        if (db.dbObjectKeys === undefined) {
          r2.diagnosis.push('DB media-object-key query failed — orphan/missing checks skipped')
        } else {
          const classified = classifyR2Objects({
            listed,
            dbKeys: db.dbObjectKeys,
            seededIds: ids,
          })
          r2.seededObjects = classified.seeded.length
          r2.orphanObjects = classified.orphan
          r2.missingObjects = classified.missing
        }
      } catch (err) {
        r2.connectivity = 'list-failed'
        r2.connectivityDetail = safeCauseReport(err)
        r2.diagnosis.push(`[R2 list objects] ${r2.connectivityDetail.join(' ⮑ ')}`)
      }
    }
  }

  const reconciled = reconcileSeedStates({
    plan,
    productRows,
    variantRows,
    movementRows,
    mediaRows,
    listed,
  })
  db.complete = reconciled.complete
  db.partial = reconciled.partial
  db.missing = reconciled.missing
  db.perProduct = reconciled.perProduct

  return { db, r2, planLength: plan.length }
}

/** Human report matching the operator-facing audit checklist. */
export function formatAuditReport(audit) {
  const { db, r2 } = audit
  const lines = []
  const r2Checked = r2.configured && r2.connectivity === 'ok'

  lines.push('Catalog seed audit (READ-ONLY — no writes were made or attempted)')
  lines.push('')
  lines.push(`  Current production product count: ${db.currentProducts}`)
  lines.push(
    `  Full seed target: ${db.fullSeedTarget} products (${seedOrdinalLabel(SEED_START_ORDINAL)}–${seedOrdinalLabel(SEED_START_ORDINAL + db.fullSeedTarget - 1)})`,
  )
  lines.push(`  Seeded products found: ${db.seededProductsFound} of ${db.fullSeedTarget}`)
  lines.push(`  Seeded products complete: ${db.complete}`)
  lines.push(`  Seeded products partial: ${db.partial}`)
  lines.push(`  Seeded products missing: ${db.missing}`)
  lines.push(
    `  Seeded variants found: ${db.seededVariantsFound} of ${db.expected.variants} planned (distinct SKUs ${db.distinctSkus}${db.seededVariantsFound === 0 ? '' : `, duplicate SKUs ${db.skuDuplicates}`})`,
  )
  lines.push(
    `  Seeded inventory movements found: ${db.seededMovementsFound} of ${db.expected.movements} planned`,
  )
  lines.push(
    `  Seeded media DB associations found: ${db.seededMediaFound} of ${db.expected.media} planned`,
  )

  const details = db.perProduct.filter((entry) => entry.state !== 'missing')
  if (details.length > 0) {
    lines.push('')
    lines.push('  Seed product details:')
    for (const entry of details) {
      lines.push(
        `    - ${entry.label} · ${entry.id} · ${entry.nameEn} (${entry.categoryCode ?? '?'}${entry.categoryName ? ` · ${entry.categoryName}` : ''}${entry.supplierName ? ` · ${entry.supplierName}` : ''}, status=${entry.status ?? 'missing'})`,
      )
      lines.push(
        `      state: ${entry.state} — found ${entry.found.variants}/${entry.expected.variants} variants, ${entry.found.movements}/${entry.expected.movements} movements, ${entry.found.media}/${entry.expected.media} media rows`,
      )
      if (entry.skus.length > 0) lines.push(`      SKUs: ${entry.skus.join(', ')}`)
      for (const key of entry.mediaKeys) {
        const present = entry.missingR2.includes(key)
          ? 'NO (repair required)'
          : r2Checked
            ? 'yes'
            : 'not checked (no R2 listing)'
        lines.push(`      media DB: ${key} → R2 object present: ${present}`)
      }
    }
  }

  lines.push('')
  lines.push(`  R2 connectivity: ${r2.connectivity}`)
  lines.push(`  R2 bucket used: ${r2.bucket}`)
  if (r2.endpointHost) lines.push(`  R2 S3 endpoint host: ${r2.endpointHost}`)
  lines.push(
    r2.configured
      ? `  Seeded R2 objects found: ${r2.seededObjects} of ${r2.listedTotal} listed under '${SEED_OBJECT_PREFIX}'`
      : `  R2 object checks: skipped — no R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY provided (checks are read-only GET/HEAD)`,
  )
  lines.push(`  Orphan R2 objects found: ${r2.orphanObjects.length}`)
  for (const key of r2.orphanObjects.slice(0, 20)) lines.push(`    - ${key}`)
  lines.push(`  Missing R2 objects referenced by DB: ${r2.missingObjects.length}`)
  for (const key of r2.missingObjects.slice(0, 20)) lines.push(`    - ${key}`)

  const diag = [...db.diagnosis, ...r2.diagnosis]
  if (diag.length > 0) {
    lines.push('')
    lines.push('  Safe diagnosis of earlier failures:')
    for (const line of diag) lines.push(`    - ${line}`)
  } else {
    lines.push('')
    lines.push(
      '  Diagnosis: no live-probe errors. The earlier `fetch failed` came from a transport leg ' +
        'that now passes read-only checks; future failures carry their safe nested cause via the same probes.',
    )
  }
  return lines.join('\n')
}
