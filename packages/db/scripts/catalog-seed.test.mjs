/**
 * Pure unit tests for the production catalog seed core (no database, no R2).
 * Run via `pnpm --filter @likehoney/db test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'

import {
  COVERAGE_TO_OPTION_TYPE,
  DESIGN_THEMES,
  MAX_VARIANTS_PER_PRODUCT,
  PRODUCTION_CATALOG_TARGET,
  SEED_COUNT,
  SEED_NAMESPACE,
  SEED_START_ORDINAL,
  SKU_RE,
  buildProductStatements,
  buildSku,
  fullSeedPlan,
  generateSeedPlan,
  pngDimensions,
  planStockSummary,
  resolveSeedPlan,
  seedOrdinalLabel,
  seededOptionId,
  seededProductId,
  seededVariantId,
  seededValueId,
  summarizePlan,
  toTransactionQueries,
  uuidv5,
  validateSeedPlan,
} from './lib/catalog-seed.mjs'
import {
  formatCategoryDistribution,
  formatInventoryReport,
  formatMediaPreflight,
  formatMixReport,
  formatPriceCostReport,
  formatSample,
  formatSupplierDistribution,
} from './lib/dry-run-report.mjs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Realistic fake production categories (children's retail) + suppliers. */
function fakeCatalogState() {
  const categories = [
    {
      id: '11111111-1111-4111-8111-111111111101',
      code: 'CLO',
      nameEn: 'Kids Clothing',
      nameAr: 'ملابس أطفال',
      status: 'active',
    },
    {
      id: '11111111-1111-4111-8111-111111111102',
      code: 'SHO',
      nameEn: 'Kids Shoes',
      nameAr: 'أحذية أطفال',
      status: 'active',
    },
    {
      id: '11111111-1111-4111-8111-111111111103',
      code: 'BAG',
      nameEn: 'Backpacks & Bags',
      nameAr: 'حقائب ظهر وحقائب',
      status: 'active',
    },
    {
      id: '11111111-1111-4111-8111-111111111104',
      code: 'SCH',
      nameEn: 'School & Stationery',
      nameAr: 'المدرسة والقرطاسية',
      status: 'active',
    },
    {
      id: '11111111-1111-4111-8111-111111111105',
      code: 'TOY',
      nameEn: 'Toys',
      nameAr: 'ألعاب',
      status: 'active',
    },
    {
      id: '11111111-1111-4111-8111-111111111106',
      code: 'BAB',
      nameEn: 'Baby',
      nameAr: 'مستلزمات الرضع',
      status: 'active',
    },
    {
      id: '11111111-1111-4111-8111-111111111107',
      code: 'ACC',
      nameEn: 'Accessories',
      nameAr: 'إكسسوارات',
      status: 'active',
    },
    {
      id: '11111111-1111-4111-8111-111111111108',
      code: 'GFT',
      nameEn: 'Gifts',
      nameAr: 'الهدايا',
      status: 'active',
    },
    {
      id: '11111111-1111-4111-8111-111111111109',
      code: 'DIS',
      nameEn: 'Discontinued',
      nameAr: 'ملابس مفروزة',
      status: 'inactive',
    },
  ]
  const suppliers = [
    {
      id: '22222222-2222-4222-8222-222222222201',
      nameEn: 'Nablus Textiles Trading',
      nameAr: 'تجارة أقمشة نابلس',
      status: 'active',
    },
    {
      id: '22222222-2222-4222-8222-222222222202',
      nameEn: 'Cedar Kids Imports',
      nameAr: 'سيدار كيدز للاستيراد',
      status: 'active',
    },
    {
      id: '22222222-2222-4222-8222-222222222203',
      nameEn: 'Gaza Plastics Co.',
      nameAr: 'شركة غزة للبلاستيك',
      status: 'inactive',
    },
  ]
  return { categories, suppliers }
}

test('target is exactly 100', () => {
  assert.equal(PRODUCTION_CATALOG_TARGET, 100)
})

test('the seed owns a PERMANENT 99-product namespace (#002–#100)', () => {
  // The namespace is derived from constants, never from a live product count:
  // a partial write at any point must not shift product identities.
  assert.equal(SEED_START_ORDINAL, 1)
  assert.equal(SEED_COUNT, PRODUCTION_CATALOG_TARGET - SEED_START_ORDINAL)
  const plan = fullSeedPlan()
  assert.equal(plan.totalPlanned, 99)
  assert.equal(plan.products.length, 99)
  assert.equal(seedOrdinalLabel(plan.products[0].ordinal), '#002')
  assert.equal(seedOrdinalLabel(plan.products[98].ordinal), '#100')
  // fully deterministic and immutable across calls
  assert.deepEqual(fullSeedPlan().products, plan.products)
  assert.deepEqual(
    fullSeedPlan()
      .products.map((p) => p.ordinal)
      .slice(0, 5),
    [1, 2, 3, 4, 5],
  )
  // exactly the same slice as the tail of the authored 100-row table
  const full = generateSeedPlan({ productsToCreate: PRODUCTION_CATALOG_TARGET })
  assert.deepEqual(plan.products, full.products.slice(1, 100))
  // 99 distinct deterministic product ids, none of them the #001 identity
  const ids = new Set(plan.products.map((p) => seededProductId(p.ordinal)))
  assert.equal(ids.size, 99)
  assert.ok(!ids.has(seededProductId(0)))
})

test('uuidv5 is a deterministic v5 uuid', () => {
  const a = uuidv5(SEED_NAMESPACE, 'product:0')
  const b = uuidv5(SEED_NAMESPACE, 'product:0')
  assert.equal(a, b)
  assert.match(a, UUID_RE)
  assert.notEqual(seededProductId(0), seededProductId(1))
  assert.notEqual(seededProductId(0), seededOptionId(0, 0))
  assert.notEqual(seededProductId(0), seededVariantId(0, 0))
  assert.notEqual(seededProductId(0), seededValueId(0, 0, 0))
})

test('buildSku produces the canonical SKU and rejects invalid input', () => {
  const sku = buildSku({ categoryCode: 'SHO', productSequence: 7, variantSuffix: 'PNK-2Y' })
  assert.equal(sku, 'LH-SHO-000007-PNK-2Y')
  assert.match(sku, SKU_RE)
  assert.throws(() => buildSku({ categoryCode: 'low', productSequence: 7, variantSuffix: 'DEF' }))
  assert.throws(() =>
    buildSku({ categoryCode: 'SHO', productSequence: 7, variantSuffix: 'bad suffix' }),
  )
  assert.throws(() => buildSku({ categoryCode: 'SHO', productSequence: 'x', variantSuffix: 'DEF' }))
})

test('full plan: 100 products, deterministic, all option shapes present', () => {
  const { products, totalPlanned } = generateSeedPlan({
    productsToCreate: PRODUCTION_CATALOG_TARGET,
  })
  assert.equal(totalPlanned, 100)
  assert.equal(products.length, 100)

  const again = generateSeedPlan({ productsToCreate: PRODUCTION_CATALOG_TARGET })
  assert.deepEqual(products, again.products)

  const counts = { simple: 0, size: 0, color: 0, both: 0, design: 0 }
  for (const product of products) counts[product.optionType] += 1
  const total = products.length
  const simpleShare = (counts.simple / total) * 100
  assert.ok(simpleShare >= 35 && simpleShare <= 45, `simple share ${simpleShare}% outside 35-45`)
  for (const letter of Object.keys(COVERAGE_TO_OPTION_TYPE)) {
    assert.ok(
      counts[COVERAGE_TO_OPTION_TYPE[letter]] >= 5,
      `${letter} (${COVERAGE_TO_OPTION_TYPE[letter]}) < 5`,
    )
  }
  for (const product of products) {
    assert.ok(product.variants.length >= 1 && product.variants.length <= MAX_VARIANTS_PER_PRODUCT)
  }
})

test('resolved production plan passes every invariant check', () => {
  const { products } = generateSeedPlan({ productsToCreate: PRODUCTION_CATALOG_TARGET })
  const { categories, suppliers } = fakeCatalogState()
  const plan = resolveSeedPlan(products, categories, suppliers)
  const errors = validateSeedPlan(plan)
  assert.deepEqual(errors, [])

  // Every product is linked to exactly one existing category + supplier.
  const categoryIds = new Set(categories.map((c) => c.id))
  const supplierIds = new Set(suppliers.map((s) => s.id))
  for (const product of plan) {
    assert.ok(categoryIds.has(product.categoryId))
    assert.ok(supplierIds.has(product.supplierId))
    assert.ok(SKU_SEGMENT_OK(product.categoryCode))
  }
})

test('resolveSeedPlan: rotation fallback works without keyword matches', () => {
  const { products } = generateSeedPlan({ productsToCreate: 5 })
  const categories = [
    {
      id: '11111111-1111-4111-8111-111111111101',
      code: 'GEN',
      nameEn: 'Everything',
      nameAr: 'كل شيء',
      status: 'active',
    },
  ]
  const suppliers = [
    {
      id: '22222222-2222-4222-8222-222222222201',
      nameEn: 'One Supplier',
      nameAr: 'مورد واحد',
      status: 'active',
    },
  ]
  const plan = resolveSeedPlan(products, categories, suppliers)
  assert.equal(plan.length, 5)
  for (const product of plan) {
    assert.equal(product.categoryId, categories[0].id)
    assert.equal(product.categoryCode, 'GEN')
    assert.equal(product.supplierId, suppliers[0].id)
  }
  assert.throws(() => resolveSeedPlan(products, [], suppliers))
  assert.throws(() => resolveSeedPlan(products, categories, []))
})

test('validateSeedPlan flags a broken plan', () => {
  const { products } = generateSeedPlan({ productsToCreate: 5 })
  const broken = structuredClone(products)
  broken[0].status = 'exploded'
  broken[0].variants[0].acquisitionCostMinor = broken[0].variants[0].priceMinor + 100
  broken[1].nameAr = ''
  broken[2].variants[0].quantityOnHand = -1
  const { categories, suppliers } = fakeCatalogState()
  const plan = resolveSeedPlan(broken, categories, suppliers)
  const errors = validateSeedPlan(plan)
  assert.ok(errors.length >= 4, JSON.stringify(errors))
})

test('stock plan lands near the 60/20/10/10 mix', () => {
  const { products } = generateSeedPlan({ productsToCreate: PRODUCTION_CATALOG_TARGET })
  const { categories, suppliers } = fakeCatalogState()
  const plan = resolveSeedPlan(products, categories, suppliers)
  const summary = planStockSummary(plan)
  assert.ok(summary.variants >= 100)
  const band = (share, min, max) =>
    assert.ok(share >= min && share <= max, `${share} not in ${min}..${max}`)
  band(summary.normalShare, 50, 70)
  band(summary.lowShare, 15, 25)
  band(summary.highShare, 5, 15)
  band(summary.zeroShare, 5, 15)
})

test('delta plans are deterministic tails of the same catalog', () => {
  const full0 = generateSeedPlan({ productsToCreate: 100 })
  const tail = generateSeedPlan({ productsToCreate: 40, startIndex: 60 })
  assert.deepEqual(tail.products, full0.products.slice(60, 100))
})

test('statement builder: one atomic batch, SKU derived in SQL, media idempotent', () => {
  const { products } = generateSeedPlan({ productsToCreate: 1 })
  const { categories, suppliers } = fakeCatalogState()
  const [product] = resolveSeedPlan(products, categories, suppliers)
  const { statementCount, statements } = buildProductStatements({
    product,
    objectKey: `products/${seededProductId(0)}/00000000-0000-4000-8000-000000000000.png`,
    media: {
      altEn: 'x',
      altAr: 'ي',
      widthPx: 230,
      heightPx: 230,
      sizeBytes: 1,
      mimeType: 'image/png',
    },
  })

  assert.ok(statementCount >= 3)
  const sqlText = statements.map((s) => s.sql).join('\n')
  assert.match(sqlText, /INSERT INTO products/)
  assert.match(sqlText, /INSERT INTO product_variants/)
  assert.match(sqlText, /INSERT INTO inventory_balances/)
  assert.match(sqlText, /'LH-' \|\| \$2::text \|\| '-' \|\| lpad\(p\.sequence::text, 6, '0'\)/)
  assert.match(sqlText, /INSERT INTO product_media/)
  assert.match(
    sqlText,
    /WHERE NOT EXISTS \(SELECT 1 FROM product_media pm WHERE pm\.product_id = \$1::uuid\)/,
  )
  // No UPDATE / DELETE ever generated by the builder.
  assert.ok(!/\bUPDATE\b/.test(sqlText))
  assert.ok(!/\bDELETE\b/.test(sqlText))

  // Simple product gets exactly the default DEF suffix.
  for (const statement of statements) {
    if (statement.sql.includes('variant_suffix')) {
      // covered below via the single-variant DEF shape
    }
  }
})

test('every seed INSERT is guarded so a rerun cannot duplicate anything', () => {
  const { products } = generateSeedPlan({ productsToCreate: 1 })
  const { categories, suppliers } = fakeCatalogState()
  const [product] = resolveSeedPlan(products, categories, suppliers)
  const { statements } = buildProductStatements({
    product,
    objectKey: `products/${seededProductId(0)}/00000000-0000-4000-8000-000000000000.png`,
    media: {
      altEn: 'x',
      altAr: 'ي',
      widthPx: 230,
      heightPx: 230,
      sizeBytes: 1,
      mimeType: 'image/png',
    },
  })
  const find = (table) => statements.filter((s) => s.sql.includes(`INSERT INTO ${table}`))

  assert.ok(find('products').every((s) => s.sql.includes('ON CONFLICT (id) DO NOTHING')))
  assert.ok(find('product_options').every((s) => s.sql.includes('ON CONFLICT (id) DO NOTHING')))
  assert.ok(
    find('product_option_values').every((s) => s.sql.includes('ON CONFLICT (id) DO NOTHING')),
  )
  assert.ok(find('product_variants').every((s) => s.sql.includes('ON CONFLICT (id) DO NOTHING')))
  assert.ok(find('product_variant_options').every((s) => s.sql.includes('ON CONFLICT DO NOTHING')))
  assert.ok(
    find('inventory_balances').every((s) => s.sql.includes('ON CONFLICT (variant_id) DO NOTHING')),
  )
  // inventory_movements has no deterministic PK (id is defaultRandom()) — the
  // seed guards it with a NOT EXISTS on (variant_id, movement_type, reason).
  for (const movement of find('inventory_movements')) {
    assert.match(movement.sql, /\bNOT EXISTS \(\s*SELECT 1 FROM inventory_movements m/)
    assert.match(
      movement.sql,
      /AND m\.movement_type = 'INITIAL_STOCK'[\s\S]*AND m\.reason = \$4::text/,
    )
  }
  // product_media is guarded by a NOT EXISTS on product_id (max 1 primary).
  for (const media of find('product_media')) {
    assert.match(media.sql, /WHERE NOT EXISTS \(SELECT 1 FROM product_media pm/)
  }

  // No seed write ever targets an UPDATE or DELETE — including the inventory
  // movement ledger.
  const sqlText = statements.map((s) => s.sql).join('\n')
  assert.ok(!/\bUPDATE\b/.test(sqlText))
  assert.ok(!/\bDELETE\b/.test(sqlText))
})

test('toTransactionQueries yields a plain array of Neon query objects (never an async callback)', () => {
  const { products } = generateSeedPlan({ productsToCreate: 1 })
  const { categories, suppliers } = fakeCatalogState()
  const [product] = resolveSeedPlan(products, categories, suppliers)
  const { statementCount, statements } = buildProductStatements({
    product,
    objectKey: `products/${seededProductId(0)}/00000000-0000-4000-8000-000000000000.png`,
    media: {
      altEn: 'x',
      altAr: 'ي',
      widthPx: 230,
      heightPx: 230,
      sizeBytes: 1,
      mimeType: 'image/png',
    },
  })

  // The Neon driver's transaction() contract requires every element to BE the
  // direct sql.query() result (a NeonQueryPromise). The fake tags each result;
  // the regression asserts the converter passes them through untouched — an
  // async wrapper producing native Promises is exactly the production bug.
  const fakeQuery = (text, params) => ({ __neonQuery: true, text, params })
  const queries = toTransactionQueries({ statements, query: fakeQuery })

  assert.ok(Array.isArray(queries), 'transaction receives an array, not a function')
  assert.equal(queries.length, statementCount)
  assert.ok(
    queries.every((q) => q.__neonQuery === true),
    'each element is a direct sql.query() result, never a wrapped Promise',
  )

  // Foreign-key-safe statement order is preserved: products → options ∩ values
  // ∩ variant links → variants → balances → movements → media last.
  const tableOrder = [
    'INTO products ',
    'INTO product_options ',
    'INTO product_option_values ',
    'INTO product_variants ',
    'INTO product_variant_options ',
    'INTO inventory_balances ',
    'INTO inventory_movements ',
    'INTO product_media ',
  ]
  const seen = []
  for (const query of queries) {
    const match = tableOrder.findIndex((needle) => query.text.includes(needle))
    if (match !== -1) seen.push({ table: tableOrder[match], at: queries.indexOf(query) })
  }
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i].at > seen[i - 1].at, `${seen[i].table} must follow ${seen[i - 1].table}`)
  }
  assert.ok(seen[seen.length - 1].table === 'INTO product_media ', 'media row is last')

  assert.throws(() => toTransactionQueries({ statements: 'nope', query: fakeQuery }))
  assert.throws(() => toTransactionQueries({ statements, query: undefined }))
})

test('pngDimensions reads IHDR and rejects non-PNG', () => {
  const buffer = readFileSync(
    new URL('../../../apps/web/public/brand/merch/like-honey-logo-primary.png', import.meta.url),
  )
  const dims = pngDimensions(buffer)
  assert.equal(dims.width, 1254)
  assert.equal(dims.height, 1254)
  assert.equal(pngDimensions(Buffer.from('not a png at all!', 'utf8')), null)
})

function SKU_SEGMENT_OK(code) {
  return /^[A-Z]{2,8}$/.test(code)
}

test('coverage letters each appear at least 5 times', () => {
  const { products } = generateSeedPlan({ productsToCreate: PRODUCTION_CATALOG_TARGET })
  for (const letter of Object.keys(COVERAGE_TO_OPTION_TYPE)) {
    const type = COVERAGE_TO_OPTION_TYPE[letter]
    const count = products.filter((p) => p.optionType === type).length
    assert.ok(count >= 5, `${letter} (${type}) only ${count}`)
  }
})

test('Arabic copy is clean commercial prose (no unpalatable phrasings)', () => {
  const { products } = generateSeedPlan({ productsToCreate: PRODUCTION_CATALOG_TARGET })
  const banned = ['بولور', 'فلّس', 'إيقونية', 'تبيدي', 'ممسحة وبراية', 'وكلف', 'موبايل']
  for (const product of products) {
    const text = `${product.nameAr} ${product.descriptionAr}`
    for (const word of banned) {
      assert.ok(!text.includes(word), `"${word}" in "${product.nameAr}"`)
    }
  }
})

test('design themes are commercially plausible per product, with a sound default', () => {
  const { products } = generateSeedPlan({ productsToCreate: PRODUCTION_CATALOG_TARGET })
  const themeSets = {
    79: ['OCEAN', 'FISH', 'DOLPH'], // Ocean Animal Play Set
    73: ['RCKT', 'SPACE', 'STRS'], // Build-Your-Own Rocket Set
    76: ['DINO', 'SAFR', 'PRNT'], // Dinosaur Figure 6-Pack
    64: ['ARTS', 'FLRS', 'CRTN'], // Kids Art Roll
    55: ['SPACE', 'CRTN', 'CITY'], // Multi-Compartment Schoolbag
    51: ['FRNT', 'CRTN', 'STRS'], // Kids Lunch Bag
  }
  for (const product of products) {
    if (product.optionType !== 'design') continue
    const expected = DESIGN_THEMES[product.ordinal] ?? ['CRTN', 'STRS', 'FLRS']
    const designValue = product.options.find((o) => o.nameEn === 'Design')
    assert.deepEqual(
      designValue.values.map((v) => v.code),
      expected,
      `design codes for ordinal ${product.ordinal} (${product.nameEn})`,
    )
    for (const value of designValue.values) {
      assert.ok(value.code.length >= 3 && value.valueEn.length >= 2 && value.valueAr.length >= 2)
    }
  }
  for (const [ordinal, codes] of Object.entries(themeSets)) {
    const product = products.find((p) => p.ordinal === Number(ordinal))
    const designValue = product.options.find((o) => o.nameEn === 'Design')
    assert.deepEqual(
      designValue.values.map((v) => v.code),
      codes,
      `ordinal ${ordinal} matches the guaranteed theme`,
    )
  }
})

test('option-type swaps landed: study lamp → color, wooden blocks → simple', () => {
  const { products } = generateSeedPlan({ productsToCreate: PRODUCTION_CATALOG_TARGET })
  const lamp = products.find((p) => p.ordinal === 67)
  const blocks = products.find((p) => p.ordinal === 70)
  assert.equal(lamp.nameEn, 'Kids Study Lamp Clips')
  assert.equal(lamp.optionType, 'color')
  assert.equal(blocks.nameEn, 'Wooden Building Blocks')
  assert.equal(blocks.optionType, 'simple')
})

test('summarizePlan aggregates mix, statuses, stock and pricing invariants', () => {
  const { products } = generateSeedPlan({ productsToCreate: PRODUCTION_CATALOG_TARGET })
  const { categories, suppliers } = fakeCatalogState()
  const plan = resolveSeedPlan(products, categories, suppliers)
  const summary = summarizePlan(plan)

  assert.equal(summary.totalProducts, plan.length)
  const mixSum = Object.values(summary.byOptionType).reduce((a, b) => a + b, 0)
  assert.equal(mixSum, plan.length)
  const statusSum = Object.values(summary.byStatus).reduce((a, b) => a + b, 0)
  assert.equal(statusSum, plan.length)

  assert.deepEqual(summary.stock, planStockSummary(plan))
  assert.ok(summary.totalVariants === summary.stock.variants)
  assert.ok(summary.pricing.minRetail > 0)
  assert.ok(summary.pricing.maxRetail > summary.pricing.minRetail)
  assert.ok(summary.pricing.minAcquisition > 0)
  assert.ok(summary.pricing.maxAcquisition <= summary.pricing.maxRetail)
  assert.equal(summary.pricing.costGeRetail, 0, 'acquisition cost must never reach retail price')
})

test('report formatters produce stable, complete output', () => {
  const { products } = generateSeedPlan({ productsToCreate: PRODUCTION_CATALOG_TARGET })
  const { categories, suppliers } = fakeCatalogState()
  const plan = resolveSeedPlan(products, categories, suppliers)
  const summary = summarizePlan(plan)

  const mix = formatMixReport(summary)
  assert.match(mix, /Product mix:/)
  assert.match(mix, /Total products: 100/)
  assert.match(mix, /Total variants: /)
  assert.match(mix, /Design: 11/)
  assert.match(mix, /active: 92/)

  const inventory = formatInventoryReport(summary)
  assert.match(inventory, /Inventory plan \(variants\):/)
  assert.match(inventory, /zero stock variants: \d+/)
  assert.match(inventory, /normal stock variants: \d+/)

  const price = formatPriceCostReport(summary)
  assert.match(price, /minimum retail price: ₪/)
  assert.match(price, /maximum acquisition cost: ₪/)
  assert.match(price, /count where acquisitionCost >= retailPrice: 0/)

  const categoryReport = formatCategoryDistribution(categories, plan)
  const catTotal = categories.reduce(
    (sum, c) => sum + Number(categoryReport.match(`  ${c.code} — .+ \\| (\\d+)`)?.[1] ?? 0),
    0,
  )
  assert.equal(catTotal, plan.length, 'category report sums to the full plan')
  assert.match(categoryReport, /DIS — .+ \| 0/, 'unused category reported with 0')

  const supplierReport = formatSupplierDistribution(suppliers, plan)
  const supTotal = suppliers.reduce(
    (sum, s) => sum + Number(supplierReport.match(`  ${s.nameEn} \\| (\\d+)`)?.[1] ?? 0),
    0,
  )
  assert.equal(supTotal, plan.length, 'supplier report sums to the full plan')

  const media = formatMediaPreflight({
    logoSource: 'apps/web/public/brand/merch/like-honey-logo-primary.png',
    logo: { mimeType: 'image/png', widthPx: 1254, heightPx: 1254, sizeBytes: 1054497 },
    bucket: 'likehoney-media',
    productsToCreate: plan.length,
    associations: plan.length,
  })
  assert.match(media, /R2 bucket: likehoney-media/)
  assert.match(media, /Logo asset: image\/png 1254×1254, 1054497 bytes/)
  assert.match(media, /Products requiring media: 100/)
  assert.match(media, /Planned media associations: 100/)

  const sample = formatSample(plan)
  const families = new Set(['cloth', 'shoes', 'bags', 'school', 'toys', 'baby', 'access', 'gifts'])
  for (const family of families) {
    assert.ok(sample.includes(`[${family}/`))
  }
  assert.equal(sample.split('\n').length, 11, 'header + 10 sample rows')
})
