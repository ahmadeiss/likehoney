/**
 * PRODUCTION-ONLY one-time catalog seed: converge production to EXACTLY
 * `PRODUCTION_CATALOG_TARGET` (100) products using ONLY existing categories
 * and suppliers.
 *
 * Command:
 *   pnpm --filter @likehoney/db db:seed:production-catalog
 *
 * Environment (never on the frontend, never committed):
 *   PRODUCTION_DATABASE_URL            production Neon connection string
 *   CONFIRM_PRODUCTION_CATALOG_SEED    must be exactly "YES" to write
 *   R2_ACCOUNT_ID                      Cloudflare account id (S3 endpoint host)
 *   R2_ACCESS_KEY_ID                   R2 access key for the media bucket
 *   R2_SECRET_ACCESS_KEY               R2 secret key
 *   R2_BUCKET_NAME                     default "likehoney-media"
 *   R2_ENDPOINT                        OPTIONAL full https:// R2 S3 origin
 *                                      (endpoint hostname must end with
 *                                      .r2.cloudflarestorage.com; default is
 *                                      https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com)
 *
 * Modes:
 *   --dry-run (or --verify)  read-only: prints the plan, the observability
 *                            reports (mix / inventory / price-cost /
 *                            categories / suppliers / media preflight /
 *                            sample), validation and the current fingerprint.
 *                            No writes, no confirm needed.
 *   --audit                  read-only: SELECTs + GET/HEAD R2 probes only.
 *                            Reports what an earlier (possibly interrupted)
 *                            seed actually landed — products / variants /
 *                            movement ledger rows / media DB rows / R2
 *                            objects, orphans and gaps — plus the safe nested
 *                            cause of any `fetch failed`. Never requires the
 *                            confirm flag and never uploads, updates or
 *                            deletes anything, in R2 or PostgreSQL.
 *
 * Safety rules (this file + catalog-seed.mjs):
 *   - Fails closed via `validateProductionTarget` (localhost/dev branches
 *     rejected by endpoint identity). Never prints a connection secret.
 *   - The read-only fingerprint is normalized by a STRICT parser
 *     (`lib/production-snapshot.mjs`): counts from `count(*)::int AS *_count`
 *     arrive as plain row objects `[{ product_count: N }]` (Neon returns a bare
 *     rows array — not `{ rows: [...] }`), and any non-finite, fractional or
 *     negative value fails safely with `Unable to parse production ... count`.
 *   - Never writes outside the catalog/media/inventory tables. Nothing is
 *     updated, deleted, or rewritten; seed inserts carry deterministic
 *     UUIDv5 ids + `ON CONFLICT DO NOTHING`, so a rerun completes an
 *     interrupted run instead of duplicating it.
 *   - The seed owns a STABLE namespace of exactly 99 products (#002-#100,
 *     ordinals 1..99) — it is never derived from the live product count, so a
 *     partial write can never shift product identities. The COMPLETE resume
 *     plan (media decision per product) AND the complete DB statement plan
 *     (every INSERT batch) are validated before the first R2 PUT, so a
 *     programming error can never leave MORE partial state behind.
 *   - `lib/resume-plan.mjs` decides each product's action. The media map
 *     contract is camelCase `{ objectKey, isPrimary }`; the writer must never
 *     read the DB snake_case aliases (`object_key`) from it — that mismatch
 *     historically produced an `undefined` key and a "Cannot read properties
 *     of undefined (reading 'split')" crash at `s3Endpoint`. Empty or missing
 *     keys are reported, never defaulted.
 *   - Media actions: an existing media row whose R2 object is missing gets
 *     the logo re-uploaded to THAT key and the existing association is kept
 *     (repair); a product with no media row gets a new `products/<id>/<uuid>.png`
 *     key plus its media row together with the rest of its children.
 *   - Each product (product → options → values → variants → links → media →
 *     balances → movements) is inserted in ONE atomic Neon batch transaction.
 *     The Neon `transaction()` contract requires a plain ARRAY of
 *     `sql.query(...)` results (NeonQueryPromise instances) — an async wrapper
 *     must never wrap them. The R2 logo upload happens first; the media ledger
 *     row references the object key only inside that same transaction.
 *   - The identity-generated `products.sequence` drives each SKU — SKU strings
 *     are built IN SQL from the inserted row (never precomputed), guaranteeing
 *     `LH-{CODE}-{sequence:6}-{suffix}` with the true sequence.
 *   - Zero-stock variants get a balance row (0 / 0) but no movement
 *     (`quantity_change != 0`), matching the inventory ledger rules.
 *   - `--dry-run` exits 0 when the plan is valid, 2 otherwise; the write mode
 *     runs a verification pass and exits 2 on any integrity failure.
 *   - The script NEVER calls `process.exit`: it sets `process.exitCode` and
 *     exits naturally after awaited cleanup, avoiding libuv teardown asserts
 *     (e.g. `UV_HANDLE_CLOSING`) on Windows while fetch/undici handles drain.
 */
import { readFileSync, statSync } from 'node:fs'
import { createHmac, createHash } from 'node:crypto'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'

import {
  formatCategoryDistribution,
  formatInventoryReport,
  formatMediaPreflight,
  formatMixReport,
  formatPriceCostReport,
  formatSample,
  formatSupplierDistribution,
} from './lib/dry-run-report.mjs'
import { catalogDelta, parseProductionSnapshot, pluckCount } from './lib/production-snapshot.mjs'
import { formatAuditReport, runAudit } from './lib/production-audit.mjs'
import { firstDiagnosticCode, isFetchFailure, safeCauseReport } from './lib/safe-errors.mjs'
import { listR2Objects } from './lib/r2-sign.mjs'
import { resolveR2Host, validateR2Config } from './lib/r2-endpoint.mjs'
import { buildResumePlan, validateDbStatements, validateResumePlan } from './lib/resume-plan.mjs'
import { validateProductionTarget } from './lib/connection-target.mjs'
import {
  PRODUCTION_CATALOG_TARGET,
  buildProductStatements,
  fullSeedPlan,
  pngDimensions,
  resolveSeedPlan,
  seedOrdinalLabel,
  seededProductId,
  summarizePlan,
  toTransactionQueries,
  validateSeedPlan,
} from './lib/catalog-seed.mjs'

const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('--verify')
const AUDIT = process.argv.includes('--audit')
const LOGO_PATH = new URL(
  '../../../apps/web/public/brand/merch/like-honey-logo-primary.png',
  import.meta.url,
)
const LOGO_PATH_FALLBACK = new URL(
  '../../../apps/web/public/brand/logo/like-honey-brand.png',
  import.meta.url,
)
const DEFAULT_R2_BUCKET = 'likehoney-media'
const R2_REGION = 'auto'
const R2_ENDPOINT = process.env.R2_ENDPOINT?.trim()
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

const url = process.env.PRODUCTION_DATABASE_URL?.trim()
if (!url) throw new Error('PRODUCTION_DATABASE_URL is required')
if (!DRY_RUN && !AUDIT && process.env.CONFIRM_PRODUCTION_CATALOG_SEED?.trim() !== 'YES') {
  throw new Error('CONFIRM_PRODUCTION_CATALOG_SEED must be exactly "YES" to write')
}

// Validate the production target by endpoint identity — never by the database
// name — and fail closed against local + the known Development connection.
const envPath = new URL('../.env', import.meta.url)
let devUrlValue
try {
  devUrlValue = readFileSync(envPath, 'utf8')
    .match(/^DATABASE_URL=(.+)$/m)?.[1]
    ?.trim()
} catch {
  devUrlValue = undefined
}
const validation = validateProductionTarget(url, { devUrlValue })
if (!validation.ok) throw new Error(validation.reason)
const { target } = validation

const sql = neon(url)

/* --------------------------------------------------------------------------
 * R2 S3-compatible upload (SigV4 via node:crypto + fetch — no AWS SDK here).
 * ------------------------------------------------------------------------ */

// R2 object keys are ALWAYS non-empty strings like `products/<uuid>/<file>.png`.
// An empty or missing key must fail loudly here (never be defaulted), because a
// PUT/DELETE with a broken key would otherwise hit an unexpected S3 path. This
// guard is what turns the historic "undefined (reading 'split')" TypeError into
// a precise contract error instead.
function assertR2Key(key) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error(
      `R2 key must be a non-empty string (got ${JSON.stringify(key)}) — a broken plan reached the S3 layer`,
    )
  }
}

function s3Endpoint(accountId, bucket, key) {
  assertR2Key(key)
  const host = resolveR2Host({ accountId, endpoint: R2_ENDPOINT })
  return {
    host,
    url: `https://${host}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`,
  }
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}
function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function signS3Put({ accessKey, secretKey, accountId, bucket, key, body, contentType }) {
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '')
  const { host } = s3Endpoint(accountId, bucket, key)
  const canonicalUri = `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
  const payloadHash = sha256Hex(body)
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const scope = `${dateStamp}/${R2_REGION}/s3/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`
  const dateKey = hmac(`AWS4${secretKey}`, dateStamp)
  const regionKey = hmac(dateKey, R2_REGION)
  const serviceKey = hmac(regionKey, 's3')
  const signingKey = hmac(serviceKey, 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return { authorization, amzDate, payloadHash }
}

async function putObjectS3({ accountId, accessKey, secretKey, bucket, key, body, contentType }) {
  const { host, url: endpoint } = s3Endpoint(accountId, bucket, key)
  const { authorization, amzDate, payloadHash } = signS3Put({
    accessKey,
    secretKey,
    accountId,
    bucket,
    key,
    body,
    contentType,
  })
  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      Host: host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization,
      'Content-Type': contentType,
      'Content-Length': String(body.byteLength),
    },
    body,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`R2 PUT ${key} failed: ${response.status} ${detail.slice(0, 300)}`)
  }
  return { key, sizeBytes: body.byteLength }
}

async function deleteObjectS3({ accountId, accessKey, secretKey, bucket, key }) {
  const { host, url: endpoint } = s3Endpoint(accountId, bucket, key)
  const payloadHash = sha256Hex('')
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '')
  const canonicalUri = `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = `DELETE\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const scope = `${dateStamp}/${R2_REGION}/s3/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`
  const dateKey = hmac(`AWS4${secretKey}`, dateStamp)
  const regionKey = hmac(dateKey, R2_REGION)
  const serviceKey = hmac(regionKey, 's3')
  const signingKey = hmac(serviceKey, 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: {
      Host: host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization,
    },
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(`R2 DELETE ${key} failed: ${response.status}`)
  }
}

/* --------------------------------------------------------------------------
 * Read-only fingerprint of the production catalog.
 * ------------------------------------------------------------------------ */

async function fingerprint() {
  const [productRows, categoryRows, supplierRows, categoriesRows, suppliersRows] =
    await Promise.all([
      sql`SELECT count(*)::int AS product_count FROM products`,
      sql`SELECT count(*)::int AS category_count FROM categories`,
      sql`SELECT count(*)::int AS supplier_count FROM suppliers`,
      sql`SELECT id, code, name_en, name_ar, status FROM categories ORDER BY code`,
      sql`SELECT id, name_en, name_ar, status FROM suppliers ORDER BY name_ar`,
    ])
  const counts = parseProductionSnapshot({
    products: pluckCount(productRows, 'product_count'),
    categories: pluckCount(categoryRows, 'category_count'),
    suppliers: pluckCount(supplierRows, 'supplier_count'),
  })
  return {
    ...counts,
    categories: categoriesRows.map((r) => ({
      id: r.id,
      code: r.code,
      nameEn: r.name_en,
      nameAr: r.name_ar,
      status: r.status,
    })),
    suppliers: suppliersRows.map((r) => ({
      id: r.id,
      nameEn: r.name_en,
      nameAr: r.name_ar,
      status: r.status,
    })),
  }
}

/* --------------------------------------------------------------------------
 * Logo + media descriptor
 * ------------------------------------------------------------------------ */

function loadLogo() {
  const candidates = [LOGO_PATH, LOGO_PATH_FALLBACK]
  for (const path of candidates) {
    try {
      const bytes = readFileSync(path)
      const dims = pngDimensions(bytes)
      return {
        bytes,
        mimeType: 'image/png',
        sizeBytes: statSync(path).size,
        widthPx: dims?.width ?? null,
        heightPx: dims?.height ?? null,
        source: relative(REPO_ROOT, fileURLToPath(path)),
      }
    } catch {
      // try next candidate
    }
  }
  throw new Error('Like Honey logo asset not found for the media seed')
}

/* --------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */

// Non-async on purpose: the Neon `transaction()` contract requires each array
// element to BE a `sql.query(...)` result (a NeonQueryPromise). An async
// wrapper would return native Promises and the driver rejects them with
// "transaction() expects an array of queries, or a function returning an
// array of queries".
function sqlQuery(sqlText, params) {
  return sql.query(sqlText, params)
}

/**
 * Seed ONE product node, given a pre-built, already-validated decision and its
 * SQL statement plan (see `buildResumePlan`/`validateResumePlan` upstream):
 *   - action `repaired` → upload the logo to the EXISTING media key (the DB
 *     already references it, so the object is never deleted on failure),
 *     keep the existing media DB association (no media insert),
 *   - action `created` → upload a fresh `products/<id>/<uuid>.png` key and
 *     insert the media row inside the same transaction (a brand-new key IS
 *     deleted on transaction failure — nothing references it yet),
 *   - action `ready`   → nothing further; the transaction statements are all
 *     `ON CONFLICT DO NOTHING` no-ops.
 *
 * `mediaByProduct` maps product_id → [{ objectKey, isPrimary }] and `r2KeySet`
 * is the current bucket listing under `products/`, both fetched read-only ONCE
 * before the write loop.
 */
async function seedOneProduct(decision, statements, logo, { putObject, deleteObject }) {
  const { productId, objectKey, insertMedia, action } = decision

  // Upload the logo bytes to R2 BEFORE the media row exists (mirrors the
  // media service order: R2 write first, DB metadata second). An orphaned
  // object is harmless; a DB row pointing at missing bytes is not.
  let uploaded = false
  try {
    if (action !== 'ready') {
      await putObject(objectKey, logo.bytes, logo.mimeType)
      uploaded = true
    }
    await sql.transaction(toTransactionQueries({ statements, query: sqlQuery }))
  } catch (err) {
    // Roll back only brand-new keys (nothing references them). A repaired
    // key is already referenced by an existing media row — leaving it present
    // is strictly better than deleting it.
    if (uploaded && insertMedia) {
      await deleteObject(objectKey).catch(() => undefined)
    }
    throw err
  }
  return { productId, objectKey, action }
}

function printReports({ summary, plan, state, logo, bucket, logoSource }) {
  console.log(formatMixReport(summary))
  console.log()
  console.log(formatInventoryReport(summary))
  console.log()
  console.log(formatPriceCostReport(summary))
  console.log()
  console.log(formatCategoryDistribution(state.categories, plan))
  console.log()
  console.log(formatSupplierDistribution(state.suppliers, plan))
  console.log()
  console.log(
    formatMediaPreflight({
      logoSource,
      logo,
      bucket,
      productsToCreate: plan.length,
      associations: plan.length,
    }),
  )
  console.log()
  console.log(formatSample(plan))
}

async function verifyProductionIntegrity(existingCountBefore) {
  const problems = []
  const stats = await fingerprint()
  if (stats.productCount !== PRODUCTION_CATALOG_TARGET) {
    problems.push(`product count ${stats.productCount} ≠ ${PRODUCTION_CATALOG_TARGET}`)
  }
  if (stats.categoryCount !== existingCountBefore.categoryCount) {
    problems.push('category count changed during the seed — unexpected')
  }
  if (stats.supplierCount !== existingCountBefore.supplierCount) {
    problems.push('supplier count changed during the seed — unexpected')
  }

  const checks = await sql`
    SELECT
      (SELECT count(*)::int FROM products) AS total_products,
      (SELECT count(DISTINCT sku)::int FROM product_variants) AS distinct_skus,
      (SELECT count(*)::int FROM product_variants) AS total_variants,
      (SELECT count(*)::int FROM product_variants WHERE NOT (sku ~ '^LH-[A-Z0-9]{1,8}-[0-9]{6}-[A-Z0-9]{1,8}(-[A-Z0-9]{1,8})*$')) AS bad_skus,
      (SELECT count(*)::int FROM products p
         LEFT JOIN product_media pm ON pm.product_id = p.id AND pm.is_primary = true
       WHERE pm.id IS NULL) AS products_without_primary_image,
      (SELECT count(*)::int FROM product_media WHERE is_primary = true) AS primary_images
  `
  const row = checks[0]
  if (row.total_products !== PRODUCTION_CATALOG_TARGET)
    problems.push(`total products ${row.total_products}`)
  if (row.distinct_skus !== row.total_variants) problems.push('duplicate SKUs detected')
  if (row.bad_skus > 0) problems.push(`${row.bad_skus} SKUs violate the format`)
  if (row.products_without_primary_image > 0) {
    problems.push(`${row.products_without_primary_image} products lack a primary image`)
  }
  if (row.primary_images !== row.total_products) {
    problems.push(`primary images ${row.primary_images} ≠ products ${row.total_products}`)
  }
  return { stats, problems }
}

/* --------------------------------------------------------------------------
 * Main
 * ------------------------------------------------------------------------ */

async function main() {
  console.log(`Catalog seed target: ${target}`)
  const state = await fingerprint()
  const seedPlan = fullSeedPlan()
  const seedIds = seedPlan.products.map((p) => seededProductId(p.ordinal))
  const { atTarget, overTarget } = catalogDelta(PRODUCTION_CATALOG_TARGET, state.productCount)
  const seedRange = `${seedOrdinalLabel(seedPlan.products[0].ordinal)}–${seedOrdinalLabel(seedPlan.products[seedPlan.products.length - 1].ordinal)}`

  console.log(`Current products: ${state.productCount}`)
  console.log(`Existing categories: ${state.categoryCount}`)
  console.log(`Existing suppliers: ${state.supplierCount}`)
  console.log(`Full seed target: ${seedPlan.products.length} products (${seedRange})`)
  console.log(`Final products: ${PRODUCTION_CATALOG_TARGET}`)

  if (AUDIT) {
    const audit = await runAudit({
      sql,
      state,
      target: PRODUCTION_CATALOG_TARGET,
      r2Config: {
        accountId: process.env.R2_ACCOUNT_ID?.trim() || process.env.CLOUDFLARE_ACCOUNT_ID?.trim(),
        accessKey: process.env.R2_ACCESS_KEY_ID?.trim(),
        secretKey: process.env.R2_SECRET_ACCESS_KEY?.trim(),
        bucket: process.env.R2_BUCKET_NAME?.trim() || DEFAULT_R2_BUCKET,
        endpoint: R2_ENDPOINT,
      },
    })
    console.log(formatAuditReport(audit))
    const probeFailures = [...audit.db.diagnosis, ...audit.r2.diagnosis]
    return probeFailures.length === 0 ? 0 : 2
  }

  if (atTarget || overTarget) {
    if (overTarget) {
      console.error(
        `Refusing: production already has ${state.productCount} products (more than ${PRODUCTION_CATALOG_TARGET}). The seed only completes its own namespace and never touches existing rows. No writes were made.`,
      )
      return 2
    }
    console.log(
      `Catalog already at ${PRODUCTION_CATALOG_TARGET} products — nothing to create. No writes were made.`,
    )
    const { problems } = await verifyProductionIntegrity(state)
    console.log(
      problems.length === 0
        ? 'Integrity: OK'
        : `Integrity problems:\n  - ${problems.join('\n  - ')}`,
    )
    return problems.length === 0 ? 0 : 2
  }

  // Read-only presence of the STABLE namespace (read once, used for messaging
  // and later for the per-product media reconcile).
  let presentSeedRows = []
  let presenceUnknown = false
  try {
    presentSeedRows = await sql`SELECT id FROM products WHERE id = ANY(${seedIds}::uuid[])`
  } catch {
    presenceUnknown = true
  }
  console.log(
    presenceUnknown
      ? 'Seed products already present: unknown (presence query failed — safe, no writes made yet)'
      : `Seed products already present: ${presentSeedRows.length} of ${seedPlan.products.length}`,
  )
  console.log(
    `Seed products missing from catalog: ${seedPlan.products.length - presentSeedRows.length}`,
  )

  if (state.productCount === 0) {
    console.error(
      'Refusing to seed into an EMPTY catalog: the stable seed namespace is #002-#100 and expects production to already own its first store product. No writes were made.',
    )
    return 2
  }

  if (state.categoryCount === 0) {
    console.error(
      'Refusing: no existing categories to distribute products across. No writes were made.',
    )
    return 2
  }
  if (state.supplierCount === 0) {
    console.error('Refusing: no existing suppliers to link products to. No writes were made.')
    return 2
  }

  const plan = resolveSeedPlan(seedPlan.products, state.categories, state.suppliers)

  const errors = validateSeedPlan(plan)
  if (errors.length > 0) {
    console.error('Plan validation failed:')
    for (const error of errors) console.error(`  - ${error}`)
    return 2
  }

  const summary = summarizePlan(plan)
  const bucket = process.env.R2_BUCKET_NAME?.trim() || DEFAULT_R2_BUCKET
  let logo
  try {
    logo = loadLogo()
  } catch (err) {
    console.error(`Media preflight failed: ${err.message}. No writes were made.`)
    return 2
  }

  console.log(`Plan: ${plan.length} products (the stable ${seedRange} seed namespace)`)
  console.log(
    `  simple share: ${Math.round((summary.byOptionType.simple / plan.length) * 100)}% (band 35–45%)`,
  )
  console.log(
    `  stock mix (per variant): normal ${summary.stock.normalShare}% · low ${summary.stock.lowShare}% · high ${summary.stock.highShare}% · zero ${summary.stock.zeroShare}% (∑ ${summary.stock.variants} variants)`,
  )
  console.log()
  printReports({ summary, plan, state, logo, bucket, logoSource: logo.source })
  console.log()

  if (DRY_RUN) {
    console.log(
      `Dry-run complete (read-only): plan is valid, media preflight passed. No changes were made.`,
    )
    return 0
  }

  const r2 = {
    accountId: process.env.R2_ACCOUNT_ID?.trim() || process.env.CLOUDFLARE_ACCOUNT_ID?.trim(),
    accessKey: process.env.R2_ACCESS_KEY_ID?.trim(),
    secretKey: process.env.R2_SECRET_ACCESS_KEY?.trim(),
    bucket,
    endpoint: R2_ENDPOINT,
  }
  if (!r2.accountId || !r2.accessKey || !r2.secretKey) {
    console.error(
      'R2 credentials are required for the write run (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY). Nothing was written.',
    )
    return 2
  }
  const endpointCheck = validateR2Config({ accountId: r2.accountId, endpoint: r2.endpoint })
  if (!endpointCheck.ok) {
    console.error(
      `R2 endpoint configuration invalid: ${endpointCheck.reason}. Nothing was written.`,
    )
    return 2
  }

  // Read the media ledger + the CURRENT R2 object listing once, before any
  // write, so every product node is repaired/created against ground truth.
  let mediaRows
  let r2Keys
  try {
    ;[mediaRows, r2Keys] = await Promise.all([
      sql`SELECT product_id AS product_id, object_key AS object_key, is_primary AS is_primary
        FROM product_media
        WHERE product_id = ANY(${seedIds}::uuid[])`,
      listR2Objects({
        accountId: r2.accountId,
        endpoint: r2.endpoint,
        accessKey: r2.accessKey,
        secretKey: r2.secretKey,
        bucket: r2.bucket,
        prefix: 'products/',
      }),
    ])
  } catch (err) {
    console.error(
      `Media reconcile preflight failed (${safeCauseReport(err).join(' ⮑ ')}). Nothing was written.`,
    )
    return 2
  }
  const mediaByProduct = new Map()
  for (const row of mediaRows) {
    const list = mediaByProduct.get(row.product_id) ?? []
    list.push({ objectKey: row.object_key, isPrimary: row.is_primary })
    mediaByProduct.set(row.product_id, list)
  }
  const r2KeySet = new Set(r2Keys)

  const putObject = (key, body, contentType) =>
    putObjectS3({
      accountId: r2.accountId,
      accessKey: r2.accessKey,
      secretKey: r2.secretKey,
      bucket: r2.bucket,
      key,
      body,
      contentType,
    })
  const deleteObject = (key) =>
    deleteObjectS3({
      accountId: r2.accountId,
      accessKey: r2.accessKey,
      secretKey: r2.secretKey,
      bucket: r2.bucket,
      key,
    })

  // The COMPLETE resume plan is built and validated BEFORE the first R2 PUT,
  // so a programming error can never leave additional partial state behind:
  // nothing uploads and nothing is inserted unless every product node and every
  // SQL statement plan across the whole namespace is proven valid.
  const decisions = buildResumePlan({ products: plan, mediaByProduct, r2KeySet })
  const resumeProblems = validateResumePlan(decisions, { mediaByProduct, r2KeySet })
  if (resumeProblems.length > 0) {
    console.error('Resume plan validation failed — nothing was uploaded or inserted:')
    for (const problem of resumeProblems) console.error(`  - ${problem}`)
    return 2
  }

  const productById = new Map(plan.map((product) => [seededProductId(product.ordinal), product]))
  const perProduct = []
  for (const decision of decisions) {
    const product = productById.get(decision.productId)
    const { statements } = buildProductStatements({
      product,
      objectKey: decision.objectKey,
      media: decision.insertMedia
        ? {
            altEn: product.nameEn,
            altAr: product.nameAr,
            widthPx: logo.widthPx,
            heightPx: logo.heightPx,
            sizeBytes: logo.sizeBytes,
            mimeType: logo.mimeType,
          }
        : null,
    })
    const statementProblems = validateDbStatements({ statements })
    if (statementProblems.length > 0) {
      console.error(
        `DB statement plan invalid for ${seedOrdinalLabel(decision.ordinal)} — nothing was uploaded or inserted:`,
      )
      for (const problem of statementProblems) console.error(`  - ${problem}`)
      return 2
    }
    perProduct.push({ decision, statements })
  }
  console.log(
    `Resume plan validated: ${perProduct.length} products, ${
      perProduct.filter((p) => p.decision.action === 'repaired').length
    } to repair, ${perProduct.filter((p) => p.decision.action === 'created').length} to create, ${
      perProduct.filter((p) => p.decision.action === 'ready').length
    } already complete.`,
  )

  const tallies = { created: 0, repaired: 0, ready: 0, skipped: 0 }
  for (const { decision, statements } of perProduct) {
    const { action, productId, objectKey } = await seedOneProduct(decision, statements, logo, {
      putObject,
      deleteObject,
    })
    tallies[action] += 1
    const product = productById.get(productId)
    const marker = action === 'created' ? '✔' : action === 'repaired' ? '↻' : '·'
    console.log(
      `  ${marker} ordinal ${seedOrdinalLabel(decision.ordinal).slice(1)} — ${product.nameEn} (${productId}) ${action === 'ready' ? 'already complete' : action === 'repaired' ? `media object repaired (${objectKey})` : 'created'}`,
    )
  }
  console.log(
    `Seed run: ${tallies.created} created, ${tallies.repaired} repaired, ${tallies.ready} already present`,
  )

  const { stats, problems } = await verifyProductionIntegrity(state)
  console.log(
    `Verify: ${stats.productCount} products, ${stats.categoryCount} categories, ${stats.supplierCount} suppliers, ${stats.distinct_skus ?? '?'} SKUs`,
  )
  if (problems.length > 0) {
    console.error('Integrity problems:')
    for (const problem of problems) console.error(`  - ${problem}`)
    return 2
  }
  console.log('Integrity: OK — production catalog is exactly 100 products.')
  return 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    // Safe, cause-aware reporting: never print the connection string or the
    // R2 keys. Every secret we could ever touch is redacted from the output;
    // the fetch / Neon / S3 cause chain (ECONNRESET, ENOTFOUND, ETIMEDOUT,
    // HTTP status, S3 <Error><Code>, Neon code) is surfaced explicitly.
    const secrets = [
      url,
      process.env.R2_ACCESS_KEY_ID?.trim(),
      process.env.R2_SECRET_ACCESS_KEY?.trim(),
      process.env.R2_ACCOUNT_ID?.trim(),
      devUrlValue,
    ].filter(Boolean)
    const detail = safeCauseReport(err, secrets)
    if (isFetchFailure(err)) {
      const code = firstDiagnosticCode(err)
      console.error(
        `Failed over the network (${code ?? 'fetch failed'}). Safe nested cause:\n  ${detail.join('\n  ')}`,
      )
    } else if (detail.length > 0) {
      console.error(detail.join('\n'))
    } else {
      console.error(err)
    }
    process.exitCode = 1
  },
)
