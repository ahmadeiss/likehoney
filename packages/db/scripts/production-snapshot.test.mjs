/**
 * Regression tests for the read-only production snapshot parsing
 * (`lib/production-snapshot.mjs`) and the dry-run discipline of the catalog
 * seed CLI (`scripts/seed-production-catalog.mjs`).
 *
 * These target the exact failure observed on the production dry-run:
 *   "Read-only fingerprint: undefined products, undefined categories,
 *    undefined suppliers" — the count rows were destructured by the wrong
 *   aliases, because the Neon serverless driver resolves queries to a bare
 *   array of row objects keyed by the literal SQL aliases.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

import { catalogDelta, parseProductionSnapshot, pluckCount } from './lib/production-snapshot.mjs'

test('parseProductionSnapshot maps Neon-style rows arrays into the strict contract', () => {
  const snapshot = parseProductionSnapshot({
    products: pluckCount([{ product_count: 37 }], 'product_count'),
    categories: pluckCount([{ category_count: 12 }], 'category_count'),
    suppliers: pluckCount([{ supplier_count: 4 }], 'supplier_count'),
  })
  assert.deepEqual(snapshot, { productCount: 37, categoryCount: 12, supplierCount: 4 })
})

test('count returned as a string (bare count(*)) is converted to a number', () => {
  const snapshot = parseProductionSnapshot({
    products: pluckCount([{ product_count: '37' }], 'product_count'),
    categories: pluckCount([{ category_count: '12' }], 'category_count'),
    suppliers: pluckCount([{ supplier_count: '4' }], 'supplier_count'),
  })
  assert.deepEqual(snapshot, { productCount: 37, categoryCount: 12, supplierCount: 4 })
})

test('zero counts parse as zero', () => {
  assert.deepEqual(parseProductionSnapshot({ products: '0', categories: 0, suppliers: '0' }), {
    productCount: 0,
    categoryCount: 0,
    supplierCount: 0,
  })
})

test('pluckCount tolerates empty/non-array input', () => {
  assert.equal(pluckCount([], 'product_count'), undefined)
  assert.equal(pluckCount(undefined, 'product_count'), undefined)
  assert.equal(pluckCount('nope', 'product_count'), undefined)
  assert.equal(pluckCount([{ product_count: 1 }], 'wrong_column'), undefined)
})

test('malformed counts fail safely with the diagnostic message', () => {
  for (const bad of ['abc', '-1', '3.5', Number.NaN, Infinity, -Infinity, '  ']) {
    assert.throws(
      () => parseProductionSnapshot({ products: bad, categories: 1, suppliers: 1 }),
      /Unable to parse production product count/,
    )
  }
  assert.throws(
    () => parseProductionSnapshot({ products: 1, categories: 'ten', suppliers: 1 }),
    /Unable to parse production category count/,
  )
  assert.throws(
    () => parseProductionSnapshot({ products: 1, categories: 1, suppliers: -2 }),
    /Unable to parse production supplier count/,
  )
})

test('unknown non-numeric types fail safely (booleans are not counts)', () => {
  assert.throws(
    () => parseProductionSnapshot({ products: false, categories: 1, suppliers: 1 }),
    /Unable to parse production product count/,
  )
  assert.throws(
    () => parseProductionSnapshot({ products: 1, categories: {}, suppliers: 1 }),
    /Unable to parse production category count/,
  )
})

test('undefined/missing result values fail safely', () => {
  for (const bad of [undefined, null]) {
    assert.throws(
      () => parseProductionSnapshot({ products: bad, categories: 1, suppliers: 1 }),
      /Unable to parse production product count/,
    )
  }
  assert.throws(() => parseProductionSnapshot({}), /Unable to parse production product count/)
})

test('errors never contain connection secrets', () => {
  try {
    parseProductionSnapshot({ products: undefined, categories: 0, suppliers: 0 })
    assert.fail('expected parse failure')
  } catch (err) {
    assert.equal(err.message.includes('postgres'), false)
    assert.equal(err.message.includes('://'), false)
  }
})

test('catalogDelta computes the products-to-create gap', () => {
  assert.equal(catalogDelta(100, 37).productsToCreate, 63)
  assert.equal(catalogDelta(100, 60).productsToCreate, 40)
  assert.equal(catalogDelta(100, 0).productsToCreate, 100)
})

test('current count at target → zero products to create', () => {
  const delta = catalogDelta(100, 100)
  assert.equal(delta.productsToCreate, 0)
  assert.equal(delta.atTarget, true)
  assert.equal(delta.overTarget, false)
})

test('current count over target → zero products to create (no writes)', () => {
  const delta = catalogDelta(100, 120)
  assert.equal(delta.productsToCreate, 0)
  assert.equal(delta.atTarget, false)
  assert.equal(delta.overTarget, true)
})

test('dry-run performs zero writes: write-capable work lives after the DRY_RUN gate', () => {
  const source = readFileSync(new URL('./seed-production-catalog.mjs', import.meta.url), 'utf8')
  const dryRunIndex = source.indexOf('if (DRY_RUN) {')
  assert.ok(dryRunIndex !== -1, 'DRY_RUN gate present')
  for (const [label, needle] of [
    ['R2 credential/init block', 'const r2 = {'],
    ['R2 PUT wrapper', 'putObject = (key, body, contentType) =>'],
    ['per-product transaction invocation', 'await seedOneProduct('],
  ]) {
    const at = source.indexOf(needle)
    assert.ok(at !== -1, `${label} present`)
    assert.ok(at > dryRunIndex, `${label} only reached after the dry-run returns`)
  }
  // The dry-run media preflight is a pure local read (logo bytes + bucket),
  // never an S3 PUT/DELETE — R2 PUT/DELETE reach their S3 calls only through
  // the post-gate wrappers asserted above.
  assert.match(source, /logo = loadLogo\(\)/)
  assert.ok(source.indexOf('const r2 = {') > source.indexOf('if (DRY_RUN) {'))
})

test('confirm flag is only required for the write run, never for --dry-run or --audit', () => {
  const source = readFileSync(new URL('./seed-production-catalog.mjs', import.meta.url), 'utf8')
  assert.match(source, /CONFIRM_PRODUCTION_CATALOG_SEED\?\.trim\(\) !== 'YES'/)
  assert.match(source, /!DRY_RUN && !AUDIT && process\.env\.CONFIRM_PRODUCTION_CATALOG_SEED/)
  assert.match(source, /process\.argv\.includes\('--audit'\)/)
})

test('the CLI exits naturally: no process.exit calls', () => {
  const source = readFileSync(new URL('./seed-production-catalog.mjs', import.meta.url), 'utf8')
  assert.equal(source.includes('process.exit('), false)
  assert.match(source, /process\.exitCode = code/)
  assert.match(source, /process\.exitCode = 1/)
})

test('the Neon transaction receives a plain array of sql.query() results, never an async callback', () => {
  const source = readFileSync(new URL('./seed-production-catalog.mjs', import.meta.url), 'utf8')
  assert.match(source, /await sql\.transaction\(toTransactionQueries\(\{/)
  assert.match(source, /query: sqlQuery\s*}\s*\)\)/)
  // the passthrough helper returns the Neon query object DIRECTLY (not async,
  // no native-Promise wrapping — that was the production `transaction()`
  // "expects an array of queries" failure)
  assert.match(source, /function sqlQuery\(sqlText, params\) {/)
  assert.match(source, /return sql\.query\(sqlText, params\)/)
  assert.ok(!source.includes('async function query('), 'no async query wrapper')
  assert.ok(!source.includes('statements.map((s) => query(s.sql, s.params))'))
  assert.ok(!source.includes('statements.map((s) => sql.query('))
})

test('the write path resolves the STABLE full seed namespace, never the current-count tail', () => {
  const source = readFileSync(new URL('./seed-production-catalog.mjs', import.meta.url), 'utf8')
  assert.match(source, /const seedPlan = fullSeedPlan\(\)/)
  assert.match(source, /resolveSeedPlan\(seedPlan\.products, state\.categories, state\.suppliers\)/)
  assert.match(source, /Full seed target: \$\{seedPlan\.products\.length\} products/)
  assert.ok(!source.includes('generateSeedPlan({'), 'delta-tail plan generation removed')
  assert.ok(!source.includes('startIndex: state.productCount'))
})

test('the write path reconciles against the existing media ledger and the current R2 listing', () => {
  const source = readFileSync(new URL('./seed-production-catalog.mjs', import.meta.url), 'utf8')
  assert.match(source, /mediaByProduct = new Map\(\)/)
  assert.match(source, /const r2KeySet = new Set\(r2Keys\)/)
  assert.match(
    source,
    /const decisions = buildResumePlan\(\{ products: plan, mediaByProduct, r2KeySet \}\)/,
  )
  assert.match(source, /validateResumePlan\(decisions, \{ mediaByProduct, r2KeySet \}\)/)
  assert.match(source, /validateDbStatements\(\{ statements \}\)/)
  assert.match(source, /await seedOneProduct\(decision, statements, logo, \{/)
  // the complete resume plan + complete DB statement plan exist BEFORE the
  // write loop that performs each product's R2 PUT + Neon transaction
  const resumeIndex = source.indexOf('const decisions = buildResumePlan(')
  const validateResumeIndex = source.indexOf(
    'validateResumePlan(decisions, { mediaByProduct, r2KeySet })',
  )
  const validateDbIndex = source.indexOf('validateDbStatements({ statements })')
  const loopIndex = source.indexOf('for (const { decision, statements } of perProduct)')
  assert.ok(
    resumeIndex !== -1 && validateResumeIndex !== -1 && validateDbIndex !== -1 && loopIndex !== -1,
  )
  assert.ok(resumeIndex < loopIndex, 'entire resume plan is built before the write loop')
  assert.ok(validateResumeIndex < loopIndex, 'entire resume plan is validated before any write')
  assert.ok(validateDbIndex < loopIndex, 'every DB statement plan is validated before any write')
  const seedCallIndex = source.indexOf('await seedOneProduct(decision, statements, logo, {')
  assert.ok(
    seedCallIndex > loopIndex,
    'the write loop performs each PUT + transaction after validation',
  )
})

test('lib/resume-plan.mjs owns the media decision and its key contract', () => {
  const source = readFileSync(new URL('./lib/resume-plan.mjs', import.meta.url), 'utf8')
  assert.match(
    source,
    /export function decideProductMedia\(\{ product, mediaByProduct, r2KeySet \}\)/,
  )
  assert.match(
    source,
    /export function buildResumePlan\(\{ products, mediaByProduct, r2KeySet \}\)/,
  )
  assert.match(source, /export function validateResumePlan\(/)
  assert.match(source, /export function validateDbStatements\(/)
  // the repair path reads the camelCase map contract … and re-uploads to the
  // EXISTING key; it never invents a new uuid for a row that already exists
  assert.match(source, /const objectKey = primaryRow\.objectKey/)
  assert.match(source, /r2KeySet\.has\(objectKey\) \? 'ready' : 'repaired'/)
  // …and an empty/missing key FAILS CLOSED: never a `` ?? '' ``-style default
  assert.match(source, /has a media DB row with no object_key/)
  assert.ok(!/(value \?\? '')\.split/.test(source), 'no empty-string masking of the object key')
})
