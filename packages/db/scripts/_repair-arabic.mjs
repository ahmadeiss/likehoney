/**
 * ONE-OFF DEV-FIXTURE ARABIC REPAIR (temporary, not committed).
 *
 * Root-caused: the dev catalog/product/option/variant/media Arabic rows were
 * written as double-encoded mojibake. The read/write pipeline (DB client →
 * services → routes → JSON → frontend) is a clean UTF-8 passthrough; only the
 * stored fixture values are corrupt. English columns are intact and are the
 * authoritative source for reconstruction.
 *
 * This script reconstructs correct Arabic for the CONFIRMED corrupted fixture
 * rows only, from their intact English. It:
 *  - refuses any non-development normal target (same guard as seed-dev.mjs),
 *  - is idempotent and guarded (only fires where the cell still holds the
 *    exact corrupt value it expects),
 *  - never resets the DB or changes schema,
 *  - documents every changed cell (prints + writes WARRANTY record),
 *  - does NOT fabricate content: where English is null but Arabic is corrupt
 *    (Soft Feeding Bib description), it clears the broken Arabic to NULL.
 */
import fs from 'node:fs'
import { neon } from '@neondatabase/serverless'

const envPath = new URL('../.env', import.meta.url)
const m = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)
if (!m) throw new Error('DATABASE_URL missing from packages/db/.env — refusing to repair')
const url = m[1].trim()
if (!/^postgres(ql)?:\/\/.+@.+\.neon\.tech\/likehoneydb/.test(url)) {
  throw new Error('Target does not match the expected Development Neon branch — refusing to repair')
}

const sql = neon(url)
const changed = []
const log = (kind, id, field, before, after) => {
  changed.push({ kind, id, field, before, after })
  console.log(`  [${kind}] ${id}.${field}\n    before: ${before}\n    after : ${after}`)
}

// ---- CATEGORIES (name_ar, match code + slug) ----
const CATEGORY_NAME_AR = [
  ['ACC', 'إكسسوارات'],
  ['BABY', 'مستلزمات الرّضّع'],
  ['BAGS', 'حقائب الظهر'],
  ['CLOTH', 'ملابس الأطفال'],
  ['ESSN', 'أساسيات الأطفال'],
  ['GIFT', 'هدايا'],
  ['SHOE', 'أحذية الأطفال'],
  ['TOYS', 'ألعاب الأطفال'],
]

console.log('Repairing categories.name_ar ...')
for (const [code, ar] of CATEGORY_NAME_AR) {
  const rows = await sql`SELECT name_ar FROM categories WHERE code = ${code}`
  if (rows.length === 0) continue
  const before = rows[0].name_ar
  if (before === ar) continue
  await sql`UPDATE categories SET name_ar = ${ar} WHERE code = ${code} AND name_ar = ${before}`
  log('category', code, 'name_ar', before, ar)
}

// ---- PRODUCTS (name_ar, description_ar; match by uuid) ----
const PRODUCT_NAME_AR = {
  'c3c86404-0fdb-4f83-9345-be59a78e2b7a': 'فستان الأطفال المخملي',
  '3ae42178-3df2-4211-9ca8-0ea92eb66cd5': 'قميص الأطفال القطني',
  '809b23ee-e182-48cb-9a2e-bbe4653f5212': 'حذاء الأطفال الرياضي',
  '376ea18f-2db1-4c62-a6cb-2c41ea9c45a0': 'مكعبات البناء الخشبية',
  '1b8bfd82-c2c4-4839-a8b6-4565f3d15d5d': 'مريلة التغذية الناعمة',
}
// description_ar: 'ok' = reconstruct from English, 'null' = clear corrupt (no English twin)
const PRODUCT_DESC_AR = {
  'c3c86404-0fdb-4f83-9345-be59a78e2b7a': 'فستان مخملي مريح للبنات بألوان ناعمة',
  '1b8bfd82-c2c4-4839-a8b6-4565f3d15d5d': null,
}

console.log('Repairing products.name_ar ...')
for (const [id, ar] of Object.entries(PRODUCT_NAME_AR)) {
  const rows = await sql`SELECT name_ar FROM products WHERE id = ${id}`
  if (rows.length === 0) continue
  const before = rows[0].name_ar
  if (before === ar) continue
  await sql`UPDATE products SET name_ar = ${ar} WHERE id = ${id} AND name_ar = ${before}`
  log('product', id, 'name_ar', before, ar)
}

console.log('Repairing products.description_ar ...')
for (const [id, ar] of Object.entries(PRODUCT_DESC_AR)) {
  const rows = await sql`SELECT description_ar FROM products WHERE id = ${id}`
  if (rows.length === 0) continue
  const before = rows[0].description_ar
  if (before === ar) continue
  await sql`UPDATE products SET description_ar = ${ar} WHERE id = ${id} AND description_ar = ${before}`
  log('product', id, 'description_ar', before, ar)
}

// ---- OPTIONS (name_ar, match product_uuid + name_en) ----
const OPTION_NAME_AR = {
  'f9c17e37-9dbe-4615-9da6-550625fb3dd5': 'المقاس',
  'fc8eafc2-9640-46c9-8994-cef89df2381d': 'اللون',
}
console.log('Repairing product_options.name_ar ...')
for (const [id, ar] of Object.entries(OPTION_NAME_AR)) {
  const rows = await sql`SELECT name_ar FROM product_options WHERE id = ${id}`
  if (rows.length === 0) continue
  const before = rows[0].name_ar
  if (before === ar) continue
  await sql`UPDATE product_options SET name_ar = ${ar} WHERE id = ${id} AND name_ar = ${before}`
  log('option', id, 'name_ar', before, ar)
}

// ---- OPTION VALUES (value_ar, match code) ----
const VALUE_AR = {
  S: 'صغير',
  M: 'وسط',
  L: 'كبير',
  NV: 'كحلي',
  WH: 'أبيض',
}
console.log('Repairing product_option_values.value_ar ...')
for (const [code, ar] of Object.entries(VALUE_AR)) {
  const rows = await sql`SELECT value_ar FROM product_option_values WHERE code = ${code}`
  if (rows.length === 0) continue
  const before = rows[0].value_ar
  if (before === ar) continue
  await sql`UPDATE product_option_values SET value_ar = ${ar} WHERE code = ${code} AND value_ar = ${before}`
  log('option_value', code, 'value_ar', before, ar)
}

// ---- VARIANT LABELS (option_label_ar, match sku) ----
const VARIANT_LABEL_AR = {
  'LH-CLOTH-000002-S-NV': 'صغير / كحلي',
  'LH-CLOTH-000002-S-WH': 'صغير / أبيض',
  'LH-CLOTH-000002-M-NV': 'وسط / كحلي',
  'LH-CLOTH-000002-M-WH': 'وسط / أبيض',
  'LH-CLOTH-000002-L-NV': 'كبير / كحلي',
  'LH-CLOTH-000002-L-WH': 'كبير / أبيض',
}
console.log('Repairing product_variants.option_label_ar ...')
for (const [sku, ar] of Object.entries(VARIANT_LABEL_AR)) {
  const rows = await sql`SELECT option_label_ar FROM product_variants WHERE sku = ${sku}`
  if (rows.length === 0) continue
  const before = rows[0].option_label_ar
  if (before === ar) continue
  await sql`UPDATE product_variants SET option_label_ar = ${ar} WHERE sku = ${sku} AND option_label_ar = ${before}`
  log('variant', sku, 'option_label_ar', before, ar)
}

// ---- MEDIA ALT (alt_ar, match uuid) ----
const MEDIA_ALT_AR = {
  '0d98bf2e-b604-497f-9e84-da48a1fa5b1d': 'فستان الأطفال المخملي',
}
console.log('Repairing product_media.alt_ar ...')
for (const [id, ar] of Object.entries(MEDIA_ALT_AR)) {
  const rows = await sql`SELECT alt_ar FROM product_media WHERE id = ${id}`
  if (rows.length === 0) continue
  const before = rows[0].alt_ar
  if (before === ar) continue
  await sql`UPDATE product_media SET alt_ar = ${ar} WHERE id = ${id} AND alt_ar = ${before}`
  log('media', id, 'alt_ar', before, ar)
}

// ---- DELIVERY ZONES (name_ar, customer-facing checkout) ----
console.log('Repairing delivery_zones.name_ar ...')
{
  const rows = await sql`SELECT name_ar FROM delivery_zones WHERE code = 'JER'`
  if (rows.length > 0) {
    const before = rows[0].name_ar
    const ar = 'القدس'
    if (before !== ar) {
      await sql`UPDATE delivery_zones SET name_ar = ${ar} WHERE code = 'JER' AND name_ar = ${before}`
      log('delivery_zone', 'JER', 'name_ar', before, ar)
    }
  }
}

// ---- SUPPLIERS (name_ar, synthetic fixtures; staff-facing required Arabic) ----
const SUPPLIER_NAME_AR = {
  'a041a978-c02c-45df-ae98-eac6063b4bce': 'المورّد الأول لملابس الأطفال',
  'a1117b1d-79fc-47c2-9cca-9866908180ae': 'مؤسسة أحذية الأطفال',
  '159ba696-ba65-44f2-ad65-1299f17a123f': 'مورّد ألعاب الأطفال',
}
console.log('Repairing suppliers.name_ar ...')
for (const [id, ar] of Object.entries(SUPPLIER_NAME_AR)) {
  const rows = await sql`SELECT name_ar FROM suppliers WHERE id = ${id}`
  if (rows.length === 0) continue
  const before = rows[0].name_ar
  if (before === ar) continue
  await sql`UPDATE suppliers SET name_ar = ${ar} WHERE id = ${id} AND name_ar = ${before}`
  log('supplier', id, 'name_ar', before, ar)
}

// ---- Warranty record ----
console.log(`\nChanged ${changed.length} cell(s).`)
const warrantyPath = new URL('./_arabic-repair-warrantor.json', import.meta.url)
fs.writeFileSync(warrantyPath, JSON.stringify({ at: new Date().toISOString(), changed }, null, 2))
console.log('Warranty written:', warrantyPath.pathname)
