import fs from 'node:fs'
import { neon } from '@neondatabase/serverless'

const envPath = new URL('../.env', import.meta.url)
const m = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)
if (!m) throw new Error('DATABASE_URL missing')
const url = m[1].trim()
if (!/^postgres(ql)?:\/\/.+@.+\.neon\.tech\/likehoneydb/.test(url)) {
  throw new Error('Not the development branch — refusing')
}
const sql = neon(url)

// Corruption marker regex: latin-1/1252 chars that the double-encoding injects
const CORRUPT =
  /[\u00A3\u00A5\u00A6\u00A7\u00A8\u00AD\u00AF\u00B0\u00B1\u00B3\u0192\u02C6\u201A\u201E\u2020\u2021\u2026]/u

async function check(table, col, pkey, enCol) {
  const stmt = `SELECT ${pkey} AS k, ${enCol} AS en, ${col} AS ar FROM ${table}`
  const rows = await sql`${sql.unsafe(stmt)}`
  let flagged = 0
  for (const r of rows) {
    const ar = r.ar
    if (ar != null && ar !== '' && CORRUPT.test(ar)) {
      console.log(`CORRUPT ${table}.${col} id=${r.k} en=[${r.en}] ar=[${ar}]`)
      flagged++
    }
  }
  if (flagged === 0) console.log(`clean  ${table}.${col}`)
}

console.log('== DELIVERY ZONES ==')
await check('delivery_zones', 'name_ar', 'code', 'name_en')

console.log('== CONTENT PAGES ==')
check('content_pages', 'title_ar', 'slug', 'title_en')
check('content_pages', 'body_ar', 'slug', 'title_en')

console.log('== CATEGORIES (desc) ==')
check('categories', 'description_ar', 'code', 'name_en')

console.log('== CATEGORIES (name) re-check ==')
check('categories', 'name_ar', 'code', 'name_en')

console.log('== SETTINGS value_json (string values) ==')
const settings = await sql`SELECT key, value_json FROM store_settings`
for (const s of settings) {
  if (s.value_json != null && CORRUPT.test(s.value_json)) {
    console.log(`CORRUPT store_settings.${s.key} = [${s.value_json}]`)
  }
}
console.log('settings scanned')

console.log('== SUPPLIERS (company name_ar — informational) ==')
check('suppliers', 'name_ar', 'id', 'name_en')
