import fs from 'node:fs'
import { neon } from '@neondatabase/serverless'

const repoRoot = 'C:/Users/asus/Desktop/LikeHoney'
const envPath = repoRoot + '/packages/db/.env'
const m = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)
if (!m) throw new Error('DATABASE_URL missing')
const url = m[1].trim()
if (!/^postgres(ql)?:\/\/.+@.+\.neon\.tech\/likehoneydb/.test(url)) {
  throw new Error('Not the development branch — refusing')
}
const sql = neon(url)

// Arabic letter detection: any char in U+0600..U+06FF (Arabic block) or U+0750..U+077F
function hasArabic(s) {
  if (s == null) return false
  return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(s)
}
function show(label, en, ar) {
  const corrupt = ar != null && ar !== '' && !hasArabic(ar)
  console.log(`${corrupt ? 'CORRUPT' : 'ok     '}  ${label}\n    en=[${en}]\n    ar=[${ar}]\n`)
}

console.log('========== CATEGORIES ==========')
const cats =
  await sql`SELECT code, slug, name_en, name_ar, description_en, description_ar FROM categories ORDER BY code`
for (const c of cats) {
  show(`category ${c.code} (${c.slug})`, c.name_en, c.name_ar)
  show(`  description`, c.description_en, c.description_ar)
}

console.log('========== PRODUCTS ==========')
const prods =
  await sql`SELECT id, sequence, name_en, name_ar, description_en, description_ar, short_blurb_en, short_blurb_ar FROM products ORDER BY sequence`
for (const p of prods) {
  show(`product ${p.id} (${p.name_en})`, p.name_en, p.name_ar)
  show(`  description`, p.description_en, p.description_ar)
  show(`  blurb`, p.short_blurb_en, p.short_blurb_ar)
}

console.log('========== OPTIONS ==========')
const opts =
  await sql`SELECT o.id, o.product_id, o.name_en, o.name_ar FROM product_options o ORDER BY o.product_id, o.display_order`
for (const o of opts) show(`option ${o.id} product ${o.product_id}`, o.name_en, o.name_ar)

console.log('========== OPTION VALUES ==========')
const vals =
  await sql`SELECT v.id, v.option_id, v.code, v.value_en, v.value_ar FROM product_option_values v ORDER BY v.option_id, v.display_order`
for (const v of vals) show(`value ${v.id} (${v.code})`, v.value_en, v.value_ar)

console.log('========== VARIANT LABELS ==========')
const vars =
  await sql`SELECT v.id, v.product_id, v.sku, v.option_label_en, v.option_label_ar FROM product_variants v ORDER BY v.sku`
for (const v of vars) show(`variant ${v.sku}`, v.option_label_en, v.option_label_ar)

console.log('========== MEDIA ALT ==========')
const media =
  await sql`SELECT id, product_id, object_key, alt_en, alt_ar FROM product_media ORDER BY product_id, sort_order`
for (const md of media) show(`media ${md.id}`, md.alt_en, md.alt_ar)
