import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProductStatements,
  fullSeedPlan,
  resolveSeedPlan,
  seedOrdinalLabel,
  seededProductId,
} from './lib/catalog-seed.mjs'
import {
  OBJECT_KEY_RE,
  buildResumePlan,
  decideProductMedia,
  validateDbStatements,
  validateResumePlan,
} from './lib/resume-plan.mjs'

const PRESEED_PRODUCT = '00000000-0000-4000-8000-000000000001' // catalog #001 — never in the seed namespace

const CATEGORIES = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'CLO',
    nameEn: 'Kids Clothing',
    nameAr: 'ملابس أطفال',
    status: 'active',
  },
]
const SUPPLIERS = [
  {
    id: '22222222-2222-4222-8222-222222222222',
    nameEn: 'Cedar Kids Imports',
    nameAr: 'سيدار',
    status: 'active',
  },
]

// EXACT CURRENT LIVE STATE (2026-09-09, confirmed by --audit):
//   products = 2 (pre-seed #001 + partially-landed #002)
//   #002: product row ✓, variants 0/1, movements 0/1, media DB rows 1/1,
//         referenced R2 object MISSING
//   #003–#100: absent
//   R2 connectivity OK, orphan objects 0  → the listing under products/ is EMPTY
function liveStateFixture() {
  const products = resolveSeedPlan(fullSeedPlan().products, CATEGORIES, SUPPLIERS)
  const partialId = seededProductId(1)
  const partialMediaKey = `products/${partialId}/b24ec361-db86-41a2-9f11-fe949116604b.png`
  const mediaByProduct = new Map()
  mediaByProduct.set(partialId, [{ objectKey: partialMediaKey, isPrimary: true }])
  return { products, partialId, partialMediaKey, mediaByProduct, r2KeySet: new Set() }
}

test('the write plan repairs partial #002 with its EXISTING media key (regression: undefined .split crash)', () => {
  const { products, partialId, partialMediaKey, mediaByProduct, r2KeySet } = liveStateFixture()
  const decisions = buildResumePlan({ products, mediaByProduct, r2KeySet })

  assert.equal(decisions.length, 99)
  const repair = decisions.find((d) => d.ordinal === 1)
  assert.equal(repair.productId, partialId)
  assert.equal(repair.action, 'repaired')
  assert.equal(repair.insertMedia, false)
  // THE regression: the old writer read `primaryRow.object_key` off a map that
  // stores `{ objectKey }`, so this was `undefined` and s3Endpoint crashed with
  // "Cannot read properties of undefined (reading 'split')". The key must be
  // the existing DB key, non-empty, repairable.
  assert.equal(repair.objectKey, partialMediaKey)
  assert.equal(typeof repair.objectKey, 'string')
  assert.ok(repair.objectKey.length > 0)

  for (const decision of decisions) {
    if (decision.ordinal === 1) continue
    assert.equal(decision.action, 'created')
    assert.equal(decision.insertMedia, true)
    assert.match(decision.objectKey, OBJECT_KEY_RE)
    assert.equal(r2KeySet.has(decision.objectKey), false, 'created key must be fresh')
    assert.notEqual(decision.objectKey, partialMediaKey)
  }

  // the pre-seed catalog product is outside the namespace and never included
  assert.equal(
    decisions.some((d) => d.productId === PRESEED_PRODUCT),
    false,
  )
  const problems = validateResumePlan(decisions, { mediaByProduct, r2KeySet })
  assert.deepEqual(problems, [])
})

test('#002 repair DB plan keeps the existing media association and creates the missing children', () => {
  const { products, partialId, mediaByProduct, r2KeySet } = liveStateFixture()
  const decisions = buildResumePlan({ products, mediaByProduct, r2KeySet })
  const repair = decisions.find((d) => d.ordinal === 1)
  const product = products.find((p) => seededProductId(p.ordinal) === repair.productId)
  const { statements } = buildProductStatements({
    product,
    objectKey: repair.objectKey,
    media: null, // existing media DB association is KEPT — no media insert
  })

  assert.ok(statements.some((s) => /INSERT INTO products\b/.test(s.sql)))
  assert.ok(statements.some((s) => /INSERT INTO product_variants\b/.test(s.sql)))
  assert.ok(!statements.some((s) => /INSERT INTO product_media\b/.test(s.sql)))
  const hasMovement = product.variants.some((v) => v.quantityOnHand > 0)
  assert.equal(
    statements.some((s) => /INSERT INTO inventory_movements\b/.test(s.sql)),
    hasMovement,
  )
  assert.deepEqual(validateDbStatements({ statements }), [])
  assert.equal(partialId, repair.productId)
})

test('a created product DB plan appends the media insert last and validates', () => {
  const { products, partialMediaKey, mediaByProduct, r2KeySet } = liveStateFixture()
  const decisions = buildResumePlan({ products, mediaByProduct, r2KeySet })
  const created = decisions.find((d) => d.ordinal === 2)
  assert.equal(created.action, 'created')
  const product = products.find((p) => p.ordinal === created.ordinal)
  const { statements } = buildProductStatements({
    product,
    objectKey: created.objectKey,
    media: {
      altEn: product.nameEn,
      altAr: product.nameAr,
      widthPx: 512,
      heightPx: 512,
      sizeBytes: 1234,
      mimeType: 'image/png',
    },
  })
  const mediaIndex = statements.findIndex((s) => /INSERT INTO product_media\b/.test(s.sql))
  assert.notEqual(mediaIndex, -1)
  assert.equal(mediaIndex, statements.length - 1, 'media insert is the final statement')
  assert.deepEqual(validateDbStatements({ statements }), [])
  assert.notEqual(created.objectKey, partialMediaKey)
})

test('the complete 99-product DB statement plan validates before any PUT', () => {
  const { products, mediaByProduct, r2KeySet } = liveStateFixture()
  const decisions = buildResumePlan({ products, mediaByProduct, r2KeySet })
  assert.deepEqual(validateResumePlan(decisions, { mediaByProduct, r2KeySet }), [])
  for (const decision of decisions) {
    const product = products.find((p) => p.ordinal === decision.ordinal)
    const { statements } = buildProductStatements({
      product,
      objectKey: decision.objectKey,
      media: decision.insertMedia
        ? {
            altEn: product.nameEn,
            altAr: product.nameAr,
            widthPx: 512,
            heightPx: 512,
            sizeBytes: 1234,
            mimeType: 'image/png',
          }
        : null,
    })
    assert.deepEqual(
      validateDbStatements({ statements }),
      [],
      `statement plan for ${seedOrdinalLabel(decision.ordinal)} must validate`,
    )
  }
})

test('a corrupt media row with a missing/empty object_key fails closed (never defaulted, never masked)', () => {
  const product = fullSeedPlan().products[0]
  for (const broken of [undefined, null, '']) {
    const badMap = new Map()
    badMap.set(seededProductId(1), [{ objectKey: broken, isPrimary: true }])
    assert.throws(
      () => decideProductMedia({ product, mediaByProduct: badMap, r2KeySet: new Set() }),
      /no object_key/i,
    )
  }
})

test('validateResumePlan flags contract violations: reused keys, rows for created products, empty keys', () => {
  const { products, partialMediaKey, mediaByProduct, r2KeySet } = liveStateFixture()
  const decisions = buildResumePlan({ products, mediaByProduct, r2KeySet })
  const repair = decisions.find((d) => d.ordinal === 1)

  const tampered = decisions.map((d, i) =>
    i === 0 ? { ...d, objectKey: undefined, insertMedia: true } : { ...d },
  )
  let problems = validateResumePlan(tampered, { mediaByProduct, r2KeySet })
  assert.ok(problems.some((p) => /must match products/.test(p)))

  const reused = decisions.map((d) =>
    d.ordinal === 2 ? { ...d, objectKey: repair.objectKey } : { ...d },
  )
  problems = validateResumePlan(reused, { mediaByProduct, r2KeySet })
  assert.ok(problems.some((p) => /reused across products/.test(p)))

  // a created product that already has a media DB row must be flagged
  const withRow = new Map(mediaByProduct)
  withRow.set(seededProductId(2), [
    { objectKey: 'products/00000000-0000-4000-8000-000000000000/a.png', isPrimary: true },
  ])
  problems = validateResumePlan(decisions, { mediaByProduct: withRow, r2KeySet })
  assert.ok(problems.some((p) => /media DB row already exists/.test(p)))

  // a decision claiming repair while the key is already present must be flagged
  const alreadyThere = decisions.map((d, i) => (i === 0 ? { ...d, action: 'repaired' } : { ...d }))
  problems = validateResumePlan(alreadyThere, {
    mediaByProduct,
    r2KeySet: new Set([partialMediaKey]),
  })
  assert.ok(problems.some((p) => /already present in R2/.test(p)))

  // an already-present object reports ready, never a duplicate upload
  const existingMap = new Map()
  existingMap.set(seededProductId(1), [{ objectKey: partialMediaKey, isPrimary: true }])
  const ready = decideProductMedia({
    product: products[0],
    mediaByProduct: existingMap,
    r2KeySet: new Set([partialMediaKey]),
  })
  assert.equal(ready.action, 'ready')
  assert.equal(ready.insertMedia, false)
})

test('validateDbStatements catches a broken statement plan (placeholder parity / FK order)', () => {
  assert.deepEqual(validateDbStatements({ statements: [] }), ['statement plan is empty'])
  const badParity = [
    {
      sql: 'INSERT INTO products (id) VALUES ($1::uuid, $2::uuid)',
      params: [seededProductId(1)],
    },
  ]
  assert.ok(
    validateDbStatements({ statements: badParity }).some((p) =>
      /params bound but the SQL references \$2/.test(p),
    ),
  )

  const gap = [
    {
      sql: 'INSERT INTO products (id) VALUES ($1::uuid, $3::uuid)',
      params: [seededProductId(1), seededProductId(2)],
    },
  ]
  assert.ok(
    validateDbStatements({ statements: gap }).some((p) => /placeholder \$2 is never bound/.test(p)),
  )

  const badOrder = [
    {
      sql: 'INSERT INTO product_variants (id) VALUES ($1::uuid)',
      params: [seededProductId(1)],
    },
  ]
  assert.ok(
    validateDbStatements({ statements: badOrder }).some((p) =>
      /statement 1 is not the products insert/.test(p),
    ),
  )
})

test('the resume-plan analysis agrees with the read-only audit that #002 is partial', async () => {
  const { products, partialMediaKey, mediaByProduct, r2KeySet } = liveStateFixture()
  const repair = buildResumePlan({ products, mediaByProduct, r2KeySet }).find(
    (d) => d.ordinal === 1,
  )
  assert.equal(repair.action, 'repaired')
  assert.equal(repair.objectKey, partialMediaKey)
  assert.ok(mediaByProduct.get(seededProductId(1)).length === 1, 'exactly one media DB row')
})
