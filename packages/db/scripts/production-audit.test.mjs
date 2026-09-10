/**
 * Unit tests for the READ-ONLY production audit (no real database, no real
 * R2 — canned rows and listings only). Run via `pnpm --filter @likehoney/db test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  fullSeedPlan,
  SEED_START_ORDINAL,
  seedOrdinalLabel,
  seededProductId,
} from './lib/catalog-seed.mjs'
import { headR2Bucket, listR2Objects } from './lib/r2-sign.mjs'
import {
  SEED_MOVEMENT_REASON,
  SEED_MOVEMENT_TYPE,
  SEED_OBJECT_KEY_RE,
  classifyR2Objects,
  expectedFromPlan,
  formatAuditReport,
  objectKeyProductId,
  reconcileSeedStates,
  runAudit,
} from './lib/production-audit.mjs'
import {
  findErrorCauses,
  firstDiagnosticCode,
  isFetchFailure,
  redactSecrets,
  safeCauseReport,
} from './lib/safe-errors.mjs'

test('the audit target is the STABLE full 99-product namespace (#002–#100), never the count remainder', () => {
  const plan = fullSeedPlan().products
  assert.equal(fullSeedPlan().totalPlanned, 99)
  assert.equal(plan.length, 99)
  assert.equal(SEED_START_ORDINAL, 1)
  assert.equal(seedOrdinalLabel(plan[0].ordinal), '#002')
  assert.equal(seedOrdinalLabel(plan[plan.length - 1].ordinal), '#100')
  const again = fullSeedPlan()
  assert.deepEqual(again.products, plan)
  // KEY REGRESSION: the planned set must never shrink or shift with the live
  // product count. A partial write (current=2) reporting 98 remaining products
  // that excludes #002 is exactly the bug being guarded against.
  for (const liveCount of [1, 2, 50, 99]) {
    const ids = fullSeedPlan().products.map((p) => seededProductId(p.ordinal))
    assert.equal(ids.length, 99)
    assert.equal(
      ids[0],
      seededProductId(1),
      `live count ${liveCount} never shifts the first seed (#002)`,
    )
    assert.equal(
      ids[98],
      seededProductId(99),
      `live count ${liveCount} never shifts the last seed (#100)`,
    )
  }
})

test('expectedFromPlan counts products, variants, movements, media', () => {
  const plan = fullSeedPlan().products
  const expected = expectedFromPlan(plan)
  assert.equal(expected.products, 99)
  assert.equal(expected.media, 99)
  assert.equal(
    expected.variants,
    plan.reduce((sum, p) => sum + p.variants.length, 0),
  )
  assert.equal(
    expected.movements,
    plan.reduce((sum, p) => sum + p.variants.filter((v) => v.quantityOnHand > 0).length, 0),
  )
  assert.ok(expected.movements < expected.variants, 'zero-stock variants have no movement')
})

test('objectKeyProductId parses seeded keys and rejects foreign shapes', () => {
  const id = seededProductId(7)
  const good = `products/${id}/00000000-0000-4000-8000-000000000000.png`
  assert.equal(objectKeyProductId(good), id)
  assert.match(good, SEED_OBJECT_KEY_RE)
  assert.equal(objectKeyProductId('products/not-a-uuid/x.png'), undefined)
  assert.equal(objectKeyProductId('avatar/logo.png'), undefined)
  assert.equal(objectKeyProductId(''), undefined)
  assert.equal(objectKeyProductId(undefined), undefined)
})

test('classifyR2Objects: seeded, orphan and missing buckets', () => {
  const seededId = seededProductId(1)
  const otherId = seededProductId(5) // exists in DB but NOT in this plan's list
  const listed = [
    `products/${seededId}/aaaa.png`, // seeded + referenced
    `products/${seededId}/bbbb.png`, // seeded, NOT referenced → orphan
    `products/${otherId}/cccc.png`, // referenced by db key? no — db has dddd
  ]
  const dbKeys = [
    `products/${seededId}/aaaa.png`,
    `products/${otherId}/dddd.png`, // NOT in listing → missing
  ]
  const { seeded, orphan, missing } = classifyR2Objects({
    listed,
    dbKeys,
    seededIds: [seededId],
  })
  assert.deepEqual(seeded, [`products/${seededId}/aaaa.png`, `products/${seededId}/bbbb.png`])
  assert.deepEqual(orphan, [`products/${seededId}/bbbb.png`, `products/${otherId}/cccc.png`])
  assert.deepEqual(missing, [`products/${otherId}/dddd.png`])
})

/**
 * Deterministic DB rows mirroring what the seed writes for the first `count`
 * products of the stable namespace (products incl. real names, one SKU per
 * variant, one aggregated movement row per product, one media row per product).
 */
function buildRows({ count = 0 } = {}) {
  const plan = fullSeedPlan().products
  const productRows = []
  const variantRows = []
  const movementRows = []
  const mediaRows = []
  for (const product of plan.slice(0, count)) {
    const id = seededProductId(product.ordinal)
    productRows.push({
      id,
      name_en: product.nameEn,
      name_ar: product.nameAr,
      status: product.status,
      category_code: 'CLO',
      category_name_en: 'Kids Clothing',
      supplier_name_en: 'Cedar Kids Imports',
    })
    for (const variant of product.variants) {
      variantRows.push({
        product_id: id,
        sku: `LH-CLO-${String(product.ordinal + 1).padStart(6, '0')}-${variant.suffix}`,
      })
    }
    movementRows.push({
      product_id: id,
      n: product.variants.filter((v) => v.quantityOnHand > 0).length,
    })
    mediaRows.push({ product_id: id, object_key: `products/${id}/media.png`, is_primary: true })
  }
  return { productRows, variantRows, movementRows, mediaRows }
}

/** Canned Neon client answering the audit's tagged-template queries. */
function fakeSql({
  productRows = [],
  variantRows = [],
  movementRows = [],
  mediaRows = [],
  objectKeys = [],
} = {}) {
  return async (strings) => {
    const sqlText = typeof strings === 'string' ? strings : strings.join('?')
    if (sqlText.includes('LEFT JOIN categories c')) return productRows
    if (sqlText.includes('FROM product_variants v')) return variantRows
    if (sqlText.includes('FROM inventory_movements m')) return movementRows
    if (sqlText.includes('product_id = ANY') && sqlText.includes("object_key LIKE 'products/%'")) {
      return mediaRows
    }
    if (sqlText.includes('SELECT object_key')) {
      return objectKeys.map((key) => ({ object_key: key }))
    }
    throw new Error(`unexpected fake SQL: ${sqlText}`)
  }
}

test('runAudit reconciles the full namespace and aggregates DB rows without R2 credentials (no network)', async () => {
  const rows = buildRows({ count: 20 })
  const audit = await runAudit({
    sql: fakeSql(rows),
    state: { productCount: 2 },
    target: 100,
    r2Config: {},
  })
  assert.equal(audit.db.currentProducts, 2)
  assert.equal(audit.db.fullSeedTarget, 99)
  assert.equal(audit.db.seededProductsFound, 20)
  // R2 not probed → completeness is decided by the DB rows alone
  assert.equal(audit.db.complete, 20)
  assert.equal(audit.db.partial, 0)
  assert.equal(audit.db.missing, 79)
  assert.equal(audit.db.seededVariantsFound, rows.variantRows.length)
  assert.equal(audit.db.distinctSkus, rows.variantRows.length)
  assert.equal(audit.db.skuDuplicates, 0)
  assert.equal(
    audit.db.seededMovementsFound,
    rows.movementRows.reduce((sum, row) => sum + row.n, 0),
  )
  assert.equal(audit.db.seededMediaFound, 20)
  assert.equal(audit.db.expected.products, 99)
  assert.ok(audit.db.diagnosis.length === 0, JSON.stringify(audit.db.diagnosis))
  assert.equal(audit.db.perProduct.length, 99)
  assert.equal(audit.db.perProduct[0].label, '#002')
  assert.equal(audit.db.perProduct[0].id, seededProductId(1))
  assert.equal(audit.db.perProduct[0].state, 'complete')
  assert.equal(audit.r2.configured, false)
  assert.equal(audit.r2.connectivity, 'not configured')
  assert.equal(audit.r2.bucket, 'likehoney-media')
  assert.equal(audit.r2.orphanObjects.length, 0)
})

test('runAudit surfaces safe diagnosis when a Neon query rejects', async () => {
  const failing = async () => {
    const err = new Error('fetch failed')
    err.cause = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
      errno: -111,
    })
    throw err
  }
  const audit = await runAudit({
    sql: failing,
    state: { productCount: 1 },
    target: 100,
    r2Config: { accountId: '', accessKey: '', secretKey: '' },
  })
  assert.equal(audit.r2.configured, false)
  assert.ok(audit.db.diagnosis.length > 0)
  assert.match(audit.db.diagnosis[0], /\[products\][\s\S]*ECONNREFUSED/)
  assert.match(formatAuditReport(audit), /Catalog seed audit \(READ-ONLY/)
  assert.match(formatAuditReport(audit), /Orphan R2 objects found: 0/)
})

test('R2 connectivity failure is reported with its safe cause', async () => {
  const audit = await runAudit({
    sql: fakeSql({}),
    state: { productCount: 1 },
    target: 100,
    r2Config: {
      accountId: '77b859059ea00d59cb87601928865b20',
      accessKey: 'dummy',
      secretKey: 'dummy',
      bucket: 'likehoney-media',
    },
  })
  assert.equal(audit.r2.configured, true)
  assert.equal(audit.r2.connectivity, 'failed')
  assert.equal(audit.r2.endpointHost, '77b859059ea00d59cb87601928865b20.r2.cloudflarestorage.com')
  assert.match(formatAuditReport(audit), /R2 connectivity: failed/)
  assert.match(formatAuditReport(audit), /\[R2 head bucket\]/)
  assert.match(formatAuditReport(audit), /R2 S3 endpoint host:/)
})

test('R2 GET/HEAD requests target the canonical S3 endpoint, never the raw account id', async (t) => {
  const accountId = '77b859059ea00d59cb87601928865b20'
  let requested = ''
  t.mock.method(globalThis, 'fetch', async (input) => {
    requested = String(input)
    const err = new Error('fetch failed')
    err.cause = Object.assign(
      new Error(`getaddrinfo ENOTFOUND ${new URL(String(input)).hostname}`),
      { code: 'ENOTFOUND', errno: -4058, syscall: 'getaddrinfo' },
    )
    throw err
  })
  const audit = await runAudit({
    sql: fakeSql({}),
    state: { productCount: 1 },
    target: 100,
    r2Config: {
      accountId,
      accessKey: 'dummy',
      secretKey: 'dummy',
      bucket: 'likehoney-media',
      endpoint: '',
    },
  })
  const host = new URL(requested).hostname
  assert.equal(host, `${accountId}.r2.cloudflarestorage.com`)
  assert.ok(!host.includes(accountId) || host.startsWith(`${accountId}.r2.cloudflarestorage.com`))
  assert.notEqual(host, accountId)
  assert.equal(audit.r2.connectivity, 'failed')
  assert.match(formatAuditReport(audit), /\[R2 head bucket\]/)
  assert.match(formatAuditReport(audit), /ENOTFOUND/)
})

test('invalid R2_ENDPOINT fails closed with a configuration diagnosis', async (t) => {
  let requested = ''
  t.mock.method(globalThis, 'fetch', async (input) => {
    requested = String(input)
    throw new Error('should not be reached')
  })
  const audit = await runAudit({
    sql: fakeSql({}),
    state: { productCount: 1 },
    target: 100,
    r2Config: {
      accountId: '77b859059ea00d59cb87601928865b20',
      accessKey: 'dummy',
      secretKey: 'dummy',
      bucket: 'likehoney-media',
      endpoint: '77b859059ea00d59cb87601928865b20',
    },
  })
  assert.equal(requested, '', 'no network request must be attempted for a malformed endpoint')
  assert.equal(audit.r2.connectivity, 'failed')
  assert.match(formatAuditReport(audit), /\[R2 configuration\]/)
  assert.match(formatAuditReport(audit), /R2_ENDPOINT/)
})

test('the on-wire query string matches the signed canonical query (no double-encoding)', async (t) => {
  const accountId = '77b859059ea00d59cb87601928865b20'
  const seen = []
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    seen.push({ url: String(input), method: init?.method ?? 'GET' })
    if ((init?.method ?? 'GET') === 'HEAD') {
      return { status: 200, text: async () => '' }
    }
    return {
      status: 200,
      text: async () =>
        '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>products/x/y.png</Key></Contents></ListBucketResult>',
    }
  })

  const { body } = await headR2Bucket({
    accountId,
    endpoint: '',
    accessKey: 'dummy',
    secretKey: 'dummy',
    bucket: 'likehoney-media',
  })
  assert.equal(body, '')
  const head = new URL(seen[0].url)
  assert.equal(
    head.pathname,
    '/likehoney-media/',
    'bucket-root HEAD must use the trailing-slash URI',
  )

  const keys = await listR2Objects({
    accountId,
    endpoint: '',
    accessKey: 'dummy',
    secretKey: 'dummy',
    bucket: 'likehoney-media',
    prefix: 'products/',
  })
  assert.deepEqual(keys, ['products/x/y.png'])
  const list = new URL(seen[1].url)
  assert.equal(list.pathname, '/likehoney-media/', 'list must use the trailing-slash URI')
  assert.equal(
    list.search,
    '?list-type=2&max-keys=1000&prefix=products%2F',
    'query values must be encoded exactly once (products%2F, never products%252F)',
  )
})

test('reconcileSeedStates classifies each product as complete / partial / missing', () => {
  const plan = fullSeedPlan().products
  const id1 = seededProductId(plan[0].ordinal) // #002
  const rows = buildRows({ count: 3 })

  // R2 listing holds every DB-referenced media object → all present products complete.
  const listing = rows.mediaRows.map((row) => row.object_key)
  const full = reconcileSeedStates({ plan, ...rows, listed: listing })
  assert.equal(full.complete, 3)
  assert.equal(full.partial, 0)
  assert.equal(full.missing, 96)
  assert.equal(full.perProduct.filter((e) => e.state === 'complete')[0].label, '#002')

  // Drop #002's R2 object AND one of its variants → it becomes partial; the
  // report still records exactly which rows landed and which object is missing.
  const partialListing = rows.mediaRows.filter((row) => row.product_id !== id1)
  const trimmed = reconcileSeedStates({
    plan,
    ...rows,
    variantRows: rows.variantRows.filter((row) => row.product_id !== id1),
    movementRows: rows.movementRows.filter((row) => row.product_id !== id1),
    mediaRows: partialListing,
    listed: partialListing.map((row) => row.object_key),
  })
  assert.equal(trimmed.complete, 2)
  assert.equal(trimmed.partial, 1)
  assert.equal(trimmed.missing, 96)
  const partialEntry = trimmed.perProduct.find((e) => e.id === id1)
  assert.equal(partialEntry.state, 'partial')
  assert.equal(partialEntry.found.variants, 0)
  assert.equal(partialEntry.found.movements, 0)
  assert.equal(partialEntry.found.media, 0)

  // A product whose products row never landed is 'missing', its children absent.
  const missingRows = reconcileSeedStates({
    plan,
    ...rows,
    productRows: rows.productRows.filter((row) => row.id !== id1),
    listed: undefined,
  })
  assert.equal(missingRows.missing, 97) // 99 − the two products that did land
  assert.ok(missingRows.perProduct.find((e) => e.id === id1).state === 'missing')

  // R2 listing undefined → R2 completeness is not part of the classification.
  const noR2 = reconcileSeedStates({ plan, ...rows, listed: undefined })
  assert.equal(noR2.complete, 3)
  assert.ok(noR2.perProduct.find((e) => e.id === id1).missingR2.length === 0)
})

test('a partially-landed seed product is identified precisely with its missing R2 object', async (t) => {
  const rows = buildRows({ count: 1 }) // exactly seed #002 landed
  const mediaKey = rows.mediaRows[0].object_key
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if ((init?.method ?? 'GET') === 'HEAD') {
      return { status: 200, text: async () => '' }
    }
    return {
      status: 200,
      text: async () =>
        '<ListBucketResult><IsTruncated>false</IsTruncated>' +
        `<Contents><Key>products/${seededProductId(2)}/other.png</Key></Contents>` +
        '</ListBucketResult>',
    }
  })
  const audit = await runAudit({
    sql: fakeSql({ ...rows, objectKeys: rows.mediaRows.map((row) => row.object_key) }),
    state: { productCount: 2 },
    target: 100,
    r2Config: {
      accountId: '77b859059ea00d59cb87601928865b20',
      accessKey: 'dummy',
      secretKey: 'dummy',
      bucket: 'likehoney-media',
    },
  })
  assert.equal(audit.db.seededProductsFound, 1)
  assert.equal(audit.db.complete, 0)
  assert.equal(audit.db.partial, 1)
  assert.equal(audit.db.missing, 98)
  const entry = audit.db.perProduct[0]
  assert.equal(entry.ordinal, 1)
  assert.equal(entry.label, '#002')
  assert.equal(entry.id, seededProductId(1))
  assert.equal(entry.state, 'partial')
  assert.equal(entry.nameEn, "Boys' Cotton Crew T-Shirt")
  assert.equal(entry.found.variants, 1)
  assert.equal(entry.found.movements, rows.movementRows[0].n)
  assert.deepEqual(entry.missingR2, [mediaKey])
  assert.deepEqual(audit.r2.missingObjects, [mediaKey])

  const report = formatAuditReport(audit)
  assert.match(report, /Full seed target: 99 products \(#002–#100\)/)
  assert.match(report, /Seeded products partial: 1/)
  assert.match(report, /Seeded products missing: 98/)
  const escaped = mediaKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  assert.match(report, new RegExp(`${escaped} → R2 object present: NO \\(repair required\\)`))
  assert.match(report, /Missing R2 objects referenced by DB: 1/)
})

test('signed movement-marker constants used by both writer and auditor agree', () => {
  assert.equal(SEED_MOVEMENT_TYPE, 'INITIAL_STOCK')
  assert.equal(SEED_MOVEMENT_REASON, 'Initial stock from Like Honey catalog seed')
})

test('safe error walker surfaces nested transport codes and HTTP status', () => {
  const inner = Object.assign(new Error('getaddrinfo ENOTFOUND r2.cloudflarestorage.com'), {
    code: 'ENOTFOUND',
    errno: -4058,
    syscall: 'getaddrinfo',
  })
  const outer = new Error('fetch failed', { cause: inner })
  assert.equal(isFetchFailure(outer), true)
  assert.equal(firstDiagnosticCode(outer), 'ENOTFOUND')
  const report = safeCauseReport(outer)
  assert.match(report.join('\n'), /ENOTFOUND/)
  assert.match(report.join('\n'), /syscall=getaddrinfo/)

  const s3 = new Error('R2 GET /media failed: HTTP 403 NoSuchBucket')
  s3.response = { status: 403 }
  assert.equal(findErrorCauses(s3)[0].tags.includes('HTTP 403'), true)
})

test('redaction hides connection strings, passwords and secrets', () => {
  const url = 'postgresql://lh-admin:SuperSecret@ep-ephemeral.eu-central-1.aws.neon.tech/db'
  const secrets = [url, 'WXYZsecretkey', 'acct123.r2.cloudflarestorage.com']
  const text = `failed on ${url} key=WXYZsecretkey host=acct123.r2.cloudflarestorage.com password=hunter2`
  const out = redactSecrets(text, secrets)
  assert.ok(!out.includes('SuperSecret'))
  assert.ok(!out.includes('WXYZsecretkey'))
  assert.ok(!out.includes('acct123.r2.cloudflarestorage.com'))
  assert.ok(!out.includes('hunter2'))
  assert.match(out, /password=\*\*\*/)

  const clean = redactSecrets('postgresql://user:pass@host/db')
  assert.ok(!/user:pass/.test(clean))
  assert.match(clean, /postgresql:\/\/\*\*\*:\*\*\*@/)
})
