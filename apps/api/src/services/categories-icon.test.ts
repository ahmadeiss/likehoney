/**
 * Category icon-key regression tests.
 *
 * Proves the safe-icon pipeline end to end at the API boundary:
 *  - the wire schemas (what `routes/categories.ts` runs on every create/update)
 *    accept only canonical keys from the approved icon registry — curated grid
 *    AND registry-only icons (e.g. `camera`) — never arbitrary names, URLs,
 *    casing variants, or anything outside the registry;
 *  - the services persist `iconKey` on create, set/clear it on update via
 *    `null`, and serialize it back in both admin and public documents;
 *  - the `visualMode` enum (`auto`/`image`/`icon`) defaults to `auto`, persists
 *    on create and update, and is exposed to the storefront;
 *  - a name-only update preserves a stored icon (icons live independently of
 *    images, so removing/never-setting an image reveals the icon).
 *
 * Run:  node --import tsx --test src/services/categories-icon.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CATEGORY_ICON_KEYS,
  CATEGORY_ICON_REGISTRY,
  categoryCreateSchema,
  categoryUpdateSchema,
} from '@likehoney/shared'
import type { DbClient } from '@likehoney/db'

import { auditActor } from './audit'
import { createCategoryService, updateCategoryService } from './categories'
import { listPublicCategoriesService } from './public-catalog'

interface CategoryState {
  id: string
  code: string
  slug: string
  nameEn: string
  nameAr: string
  descriptionEn: string | null
  descriptionAr: string | null
  status: 'active' | 'inactive'
  imageObjectKey: string | null
  imageMimeType: string | null
  imageSizeBytes: number | null
  iconKey: string | null
  visualMode: 'auto' | 'image' | 'icon'
  createdAt: Date
  updatedAt: Date
}

function baseState(overrides: Partial<CategoryState> = {}): CategoryState {
  return {
    id: 'cat-1',
    code: 'TOYS',
    slug: 'toys',
    nameEn: 'Toys',
    nameAr: 'ألعاب',
    descriptionEn: null,
    descriptionAr: null,
    status: 'active',
    imageObjectKey: null,
    imageMimeType: null,
    imageSizeBytes: null,
    iconKey: null,
    visualMode: 'auto',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

/** Fake DbClient covering the query shapes the category service + audit use:
 *  `select().from().where().limit()`, `select().from().where().orderBy()`,
 *  `insert().values().returning()`, `update().set().where().returning()`.
 *  Category inserts carry a `code`; audit inserts do not — that distinguishes
 *  the two `.returning()` shapes without real Postgres. */
function fakeDb(options: { existing?: CategoryState; emptySelects?: boolean } = {}): DbClient & {
  createdRow?: CategoryState
} {
  const state = options.existing ? { ...options.existing } : baseState()
  let createdRow: CategoryState | null = null
  const db: DbClient & { createdRow?: CategoryState } = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(options.emptySelects === true ? [] : [{ ...state }]),
          orderBy: () => Promise.resolve(options.emptySelects === true ? [] : [{ ...state }]),
        }),
      }),
    }),
    update: () => ({
      set: (values: Partial<CategoryState>) => ({
        where: () => ({
          returning: () => {
            for (const [key, value] of Object.entries(values)) {
              if (value !== undefined) (state as Record<string, unknown>)[key] = value
            }
            return Promise.resolve([{ ...state }])
          },
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          if ('code' in values) {
            createdRow = { ...baseState(), ...values }
            return Promise.resolve([{ ...createdRow }])
          }
          return Promise.resolve([{ id: 'audit-1' }])
        },
      }),
    }),
  }
  Object.defineProperty(db, 'createdRow', {
    get: () => createdRow,
  })
  return db
}

const actor = auditActor(undefined)
const ORIGIN = 'http://localhost:8787'

const base = { nameEn: 'Toys', nameAr: 'ألعاب', code: 'TOYS' }

// ---------------------------------------------------------------------------
// §1-4 — wire schema: the backend boundary (routes/categories.ts)
// ---------------------------------------------------------------------------

test('§1 every curated icon key is accepted verbatim', () => {
  for (const key of CATEGORY_ICON_KEYS) {
    const parsed = categoryCreateSchema.parse({ ...base, iconKey: key })
    assert.equal(parsed.iconKey, key)
  }
})

test('§1b every registry-only key is accepted verbatim by the API (Advanced)', () => {
  for (const key of CATEGORY_ICON_REGISTRY.filter(
    (k) => !(CATEGORY_ICON_KEYS as readonly string[]).includes(k),
  )) {
    const parsed = categoryCreateSchema.parse({ ...base, iconKey: key })
    assert.equal(parsed.iconKey, key, `registry-only key "${key}" must be accepted`)
    assert.equal(categoryUpdateSchema.parse({ iconKey: key }).iconKey, key)
  }
})

test('§1c the API accepts at least one specific registry-only icon through Advanced', () => {
  const parsed = categoryCreateSchema.parse({ ...base, iconKey: 'camera' })
  assert.equal(parsed.iconKey, 'camera')
})

test('§2 non-whitelisted / unsafe icon values are rejected', () => {
  for (const key of [
    'shoe',
    'teddy',
    'hat',
    'dress',
    'not-an-icon',
    'shirt-pants',
    'javascript:alert(1)',
    'https://evil.example/x',
    '/etc/passwd',
    'shirt<script>',
  ]) {
    assert.throws(
      () => categoryCreateSchema.parse({ ...base, iconKey: key }),
      `expected iconKey "${key}" to be rejected`,
    )
  }
})

test('§3 only canonical lowercase keys are accepted — casing variants are rejected', () => {
  for (const key of ['SHIRT', ' Shirt ', 'Backpack', 'Sport-Shoe']) {
    assert.throws(
      () => categoryCreateSchema.parse({ ...base, iconKey: key }),
      `expected non-canonical iconKey "${key}" to be rejected`,
    )
  }
})

test('§4 iconKey is optional and `null` (clear) is allowed', () => {
  assert.equal('iconKey' in categoryCreateSchema.parse({ ...base }), false)
  assert.equal(categoryCreateSchema.parse({ ...base, iconKey: null }).iconKey, null)
  assert.equal('iconKey' in categoryUpdateSchema.parse({ iconKey: null }), true)
  assert.equal(categoryUpdateSchema.parse({ iconKey: null }).iconKey, null)
  assert.equal(categoryUpdateSchema.parse({ iconKey: 'shirt' }).iconKey, 'shirt')
  assert.throws(() => categoryUpdateSchema.parse({ iconKey: 'nope' }))
})

test('§4b visual mode: only auto/image/icon are accepted; absent defaults to auto', () => {
  assert.equal('visualMode' in categoryCreateSchema.parse({ ...base }), false)
  for (const mode of ['auto', 'image', 'icon'] as const) {
    assert.equal(categoryCreateSchema.parse({ ...base, visualMode: mode }).visualMode, mode)
    assert.equal(categoryUpdateSchema.parse({ visualMode: mode }).visualMode, mode)
  }
  for (const mode of ['automatic', 'IMAGE', 'icon2', 1, null]) {
    assert.throws(
      () => categoryCreateSchema.parse({ ...base, visualMode: mode }),
      `expected visualMode "${String(mode)}" to be rejected`,
    )
  }
})

// ---------------------------------------------------------------------------
// §5-8 — service round-trip through a fake DbClient
// ---------------------------------------------------------------------------

test('§5 create persists the curated icon and serializes it in the admin doc', async () => {
  const input = categoryCreateSchema.parse({ ...base, iconKey: 'shirt' })
  const db = fakeDb({ emptySelects: true })

  const doc = await createCategoryService(db, input, actor, ORIGIN)

  assert.equal(doc.iconKey, 'shirt')
  assert.equal(db.createdRow?.iconKey, 'shirt')
})

test('§5b create persists a registry-only icon and the chosen visual mode', async () => {
  const input = categoryCreateSchema.parse({ ...base, iconKey: 'camera', visualMode: 'icon' })
  const db = fakeDb({ emptySelects: true })

  const doc = await createCategoryService(db, input, actor, ORIGIN)

  assert.equal(doc.iconKey, 'camera')
  assert.equal(doc.visualMode, 'icon')
  assert.equal(db.createdRow?.iconKey, 'camera')
  assert.equal(db.createdRow?.visualMode, 'icon')
})

test('§5c create without a visual mode stores auto', async () => {
  const input = categoryCreateSchema.parse({ ...base })
  const db = fakeDb({ emptySelects: true })

  const doc = await createCategoryService(db, input, actor, ORIGIN)

  assert.equal(doc.visualMode, 'auto')
  assert.equal(db.createdRow?.visualMode, 'auto')
})

test('§7b update persists a registry-only icon and switches visual modes', async () => {
  const db = fakeDb({ existing: baseState({ iconKey: 'camera', visualMode: 'auto' }) })
  const doc = await updateCategoryService(
    db,
    'cat-1',
    categoryUpdateSchema.parse({ iconKey: 'camera', visualMode: 'icon' }),
    actor,
    ORIGIN,
  )
  assert.equal(doc.iconKey, 'camera')
  assert.equal(doc.visualMode, 'icon')
})

test('§6 create with no icon stores null (auto fallback)', async () => {
  const input = categoryCreateSchema.parse({ ...base })
  const db = fakeDb({ emptySelects: true })

  const doc = await createCategoryService(db, input, actor, ORIGIN)

  assert.equal(doc.iconKey, null)
  assert.equal(db.createdRow?.iconKey, null)
})

test('§7 update with iconKey null clears the icon; value sets it', async () => {
  const clearing = fakeDb({ existing: baseState({ iconKey: 'backpack' }) })
  const cleared = await updateCategoryService(
    clearing,
    'cat-1',
    categoryUpdateSchema.parse({ iconKey: null }),
    actor,
    ORIGIN,
  )
  assert.equal(cleared.iconKey, null)

  const setting = fakeDb({ existing: baseState({ iconKey: null }) })
  const set = await updateCategoryService(
    setting,
    'cat-1',
    categoryUpdateSchema.parse({ iconKey: 'shirt' }),
    actor,
    ORIGIN,
  )
  assert.equal(set.iconKey, 'shirt')
})

test('§8 a name-only update preserves the stored icon and image (icons persist across edits)', async () => {
  const db = fakeDb({
    existing: baseState({
      iconKey: 'shirt',
      imageObjectKey: 'categories/cat-1/saved.webp',
    }),
  })

  const doc = await updateCategoryService(
    db,
    'cat-1',
    categoryUpdateSchema.parse({ nameEn: 'Renamed' }),
    actor,
    ORIGIN,
  )

  assert.equal(doc.nameEn, 'Renamed')
  assert.equal(doc.iconKey, 'shirt', 'icon survives an unrelated edit')
  assert.equal(doc.imageObjectKey, 'categories/cat-1/saved.webp')
})

test('§9 the public category document exposes iconKey and visualMode to the storefront', async () => {
  const db = fakeDb({
    existing: baseState({ iconKey: 'camera', visualMode: 'image' }),
  })

  const rows = await listPublicCategoriesService(db, ORIGIN)

  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.iconKey, 'camera')
  assert.equal(rows[0]!.visualMode, 'image')
  assert.equal(rows[0]!.imageUrl, null, 'no image → storefront falls back to the icon')
})
