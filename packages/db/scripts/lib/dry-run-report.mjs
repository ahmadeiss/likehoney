/**
 * Pure dry-run report formatting (no I/O, no network).
 *
 * These formatters turn a resolved seed plan + the existing production
 * categories/suppliers + the logo preflight facts into the human-readable
 * reports the dry-run prints. Everything is pure so the exact same text is
 * unit-testable and can be rendered identically by the CLI.
 */

/** Minor units → `₪12.34`. */
export function minorILS(minor) {
  return `₪${(minor / 100).toFixed(2)}`
}

export function formatMixReport(summary) {
  const { byOptionType, byStatus } = summary
  const lines = [
    'Product mix:',
    `  Simple: ${byOptionType.simple}`,
    `  Size only: ${byOptionType.size}`,
    `  Color only: ${byOptionType.color}`,
    `  Size × Color: ${byOptionType.both}`,
    `  Design: ${byOptionType.design}`,
    `  Total products: ${summary.totalProducts}`,
    `  Total variants: ${summary.totalVariants}`,
    '  By status (products):',
    `    active: ${byStatus.active}`,
    `    inactive: ${byStatus.inactive}`,
    `    archived: ${byStatus.archived}`,
    `    draft: ${byStatus.draft}`,
  ]
  return lines.join('\n')
}

export function formatInventoryReport(summary) {
  const s = summary.stock
  return [
    'Inventory plan (variants):',
    `  zero stock variants: ${s.zero}`,
    `  low stock variants: ${s.low}`,
    `  normal stock variants: ${s.normal}`,
    `  high stock variants: ${s.high}`,
  ].join('\n')
}

export function formatPriceCostReport(summary) {
  const p = summary.pricing
  return [
    'Price / cost:',
    `  minimum retail price: ${minorILS(p.minRetail)}`,
    `  maximum retail price: ${minorILS(p.maxRetail)}`,
    `  minimum acquisition cost: ${minorILS(p.minAcquisition)}`,
    `  maximum acquisition cost: ${minorILS(p.maxAcquisition)}`,
    `  count where acquisitionCost >= retailPrice: ${p.costGeRetail}`,
  ].join('\n')
}

export function formatCategoryDistribution(categories, products) {
  const counts = new Map(categories.map((c) => [c.id, 0]))
  for (const product of products) {
    counts.set(product.categoryId, (counts.get(product.categoryId) ?? 0) + 1)
  }
  const lines = ['Category distribution (code — name | products created):']
  for (const category of [...categories].sort((a, b) => a.code.localeCompare(b.code))) {
    lines.push(
      `  ${category.code} — ${category.nameEn ?? category.nameAr} | ${counts.get(category.id) ?? 0}`,
    )
  }
  return lines.join('\n')
}

export function formatSupplierDistribution(suppliers, products) {
  const counts = new Map(suppliers.map((s) => [s.id, 0]))
  for (const product of products) {
    counts.set(product.supplierId, (counts.get(product.supplierId) ?? 0) + 1)
  }
  const lines = ['Supplier distribution (name | products created):']
  for (const supplier of [...suppliers].sort((a, b) =>
    (a.nameEn ?? '').localeCompare(b.nameEn ?? ''),
  )) {
    lines.push(`  ${supplier.nameEn} | ${counts.get(supplier.id) ?? 0}`)
  }
  return lines.join('\n')
}

export function formatMediaPreflight({ logoSource, logo, bucket, productsToCreate, associations }) {
  const dimensions =
    logo.widthPx && logo.heightPx ? `${logo.widthPx}×${logo.heightPx}` : 'valid image'
  return [
    'Media preflight:',
    `  Logo source: ${logoSource}`,
    `  Logo asset: ${logo.mimeType} ${dimensions}, ${logo.sizeBytes} bytes`,
    `  R2 bucket: ${bucket}`,
    `  Media strategy: product-owned object copies — the same immutable logo bytes uploaded once per product`,
    `  Products requiring media: ${productsToCreate}`,
    `  Planned media associations: ${associations}`,
  ].join('\n')
}

/**
 * A representative sample for the report: the first product of every family
 * (cloth, shoes, bags, school, toys, baby, access, gifts) then fill to
 * `limit` from the start of the plan so the sample stays deterministic.
 */
export function formatSample(products, limit = 10) {
  const leads = new Map()
  for (const product of products) {
    if (!leads.has(product.family)) leads.set(product.family, product)
  }
  const sample = []
  const used = new Set()
  for (const lead of leads.values()) {
    if (sample.length >= limit) break
    sample.push(lead)
    used.add(lead.ordinal)
  }
  for (const product of products) {
    if (sample.length >= limit) break
    if (used.has(product.ordinal)) continue
    sample.push(product)
  }
  const lines = [
    `Sample (${sample.length} of ${products.length}) — representative family coverage:`,
  ]
  for (const product of sample) {
    const suffix = product.variants.length === 1 ? 'variant' : 'variants'
    lines.push(
      `  #${String(product.ordinal + 1).padStart(3, '0')} | ${product.nameEn} — ${product.nameAr} | ${minorILS(product.priceMinor)} | [${product.family}/${product.optionType}] | ${product.status} | ${product.variants.length} ${suffix}`,
    )
  }
  return lines.join('\n')
}
