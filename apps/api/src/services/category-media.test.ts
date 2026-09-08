/**
 * Regression tests for the category display-image service.
 *
 * Covers the upload/replace/remove sequences and their safety guarantees:
 *  - set: new object put FIRST → DB row updated (truth) → old object deleted
 *    best-effort after. DB failure compensates by deleting the fresh object.
 *  - remove: DB cleared first → object deleted best-effort; idempotent when
 *    no image is set.
 *  - Unsupported mime / oversized uploads rejected before any write.
 *
 * Run:  node --import tsx --test src/services/category-media.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DbClient } from '@likehoney/db'

import type { MediaStorage } from '../media/storage'
import { removeCategoryImageService, setCategoryImageService } from './category-media'
import { auditActor } from './audit'
import { NotFoundError, ValidationError } from '@likehoney/shared'

interface FakeCategory {
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
  createdAt: Date
  updatedAt: Date
}

function baseCategory(overrides: Partial<FakeCategory> = {}): FakeCategory {
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
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

/** Fake DbClient covering exactly the query shapes the service uses:
 *  `select().from().where().limit()`, `update().set().where().returning()`,
 *  `insert().values().returning()` (audit). Never touches real Postgres. */
function fakeDb(initial: FakeCategory, options: { missing?: boolean } = {}): DbClient {
  const state: FakeCategory = { ...initial }
  let failUpdate: Error | null = null
  const db = {
    select: () =>
      ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(options.missing === true ? [] : [{ ...state }]),
          }),
        }),
      }) as DbClient['select'],
    update: () =>
      ({
        set: (values: Partial<FakeCategory>) => ({
          where: () => ({
            returning: () => {
              if (failUpdate !== null) {
                const caught = failUpdate
                failUpdate = null
                return Promise.reject(caught)
              }
              for (const [key, value] of Object.entries(values)) {
                if (value !== undefined) (state as Record<string, unknown>)[key] = value
              }
              return Promise.resolve([{ ...state }])
            },
          }),
        }),
      }) as unknown as DbClient['update'],
    insert: () =>
      ({
        values: () => ({
          returning: () => Promise.resolve([{ id: 'audit-1' }]),
        }),
      }) as unknown as DbClient['insert'],
  }
  return {
    ...(db as unknown as Omit<DbClient, 'transaction'>),
    transaction: async <T>(fn: (tx: DbClient) => Promise<T>): Promise<T> =>
      fn(db as unknown as DbClient),
    failNextUpdate: (err: Error) => {
      failUpdate = err
    },
  } as unknown as DbClient & { failNextUpdate: (err: Error) => void }
}

interface StorageLog {
  puts: string[]
  deletes: string[]
}

function fakeStorage(log: StorageLog): MediaStorage {
  return {
    async putObject(key, data, contentType) {
      log.puts.push(key)
      return { key, contentType, sizeBytes: data.byteLength }
    },
    async getObject() {
      return null
    },
    async deleteObject(key) {
      log.deletes.push(key)
    },
  }
}

const actor = auditActor(undefined)
const ORIGIN = 'http://localhost:8787'

const upload = {
  name: 'toys.png',
  mimeType: 'image/png',
  sizeBytes: 1024,
  data: new ArrayBuffer(1024),
}

test('§1 upload to a category with no image sets the image and does not delete anything', async () => {
  const log: StorageLog = { puts: [], deletes: [] }
  const db = fakeDb(baseCategory())
  const storage = fakeStorage(log)

  const doc = await setCategoryImageService(db, storage, 'cat-1', upload, actor, ORIGIN)

  assert.equal(log.puts.length, 1)
  assert.ok(log.puts[0]!.startsWith('categories/cat-1/'))
  assert.equal(log.deletes.length, 0)
  assert.match(doc.imageObjectKey ?? '', /^categories\/cat-1\//)
  assert.equal(doc.imageMimeType, 'image/png')
  assert.equal(doc.imageSizeBytes, 1024)
  assert.equal(doc.imageUrl, `/api/v1/media/stream?key=${encodeURIComponent(doc.imageObjectKey!)}`)
})

test('§2 replace: new object written and DB updated before old object is removed', async () => {
  const entries: { action: string; key: string }[] = []
  const log: StorageLog = {
    puts: [],
    deletes: [],
  }
  const storage = {
    async putObject(key: string, data: ArrayBuffer, contentType: string) {
      log.puts.push(key)
      entries.push({ action: 'put', key })
      return { key, contentType, sizeBytes: data.byteLength }
    },
    async getObject() {
      return null
    },
    async deleteObject(key: string) {
      log.deletes.push(key)
      entries.push({ action: 'delete', key })
    },
  } satisfies MediaStorage
  const db = fakeDb(
    baseCategory({
      imageObjectKey: 'categories/cat-1/old-uuid.webp',
      imageMimeType: 'image/webp',
      imageSizeBytes: 2048,
    }),
  )

  const doc = await setCategoryImageService(db, storage, 'cat-1', upload, actor, ORIGIN)

  assert.equal(log.puts.length, 1)
  assert.equal(log.deletes.length, 1)
  assert.equal(log.deletes[0], 'categories/cat-1/old-uuid.webp')
  const putIndex = entries.findIndex((e) => e.action === 'put')
  const deleteIndex = entries.findIndex((e) => e.action === 'delete')
  assert.ok(
    putIndex !== -1 && deleteIndex !== -1 && putIndex < deleteIndex,
    'put must precede delete',
  )
  assert.match(doc.imageObjectKey ?? '', /^categories\/cat-1\/[a-f0-9-]{36}\./)
  assert.notEqual(doc.imageObjectKey, 'categories/cat-1/old-uuid.webp')
})

test('§3 DB-update failure compensates: fresh object is deleted, old object untouched', async () => {
  const log: StorageLog = { puts: [], deletes: [] }
  const storage = fakeStorage(log)
  const db = fakeDb(
    baseCategory({
      imageObjectKey: 'categories/cat-1/old-uuid.webp',
    }),
  )
  db.failNextUpdate(new Error('simulated db failure'))

  await assert.rejects(
    setCategoryImageService(db, storage, 'cat-1', upload, actor, ORIGIN),
    /simulated db failure/,
  )
  assert.deepEqual(log.deletes, [log.puts[0]], 'compensation deletes exactly the newly put object')
})

test('§4 remove: DB cleared first, then the object is deleted best-effort', async () => {
  const log: StorageLog = { puts: [], deletes: [] }
  const db = fakeDb(
    baseCategory({
      imageObjectKey: 'categories/cat-1/to-remove.webp',
      imageMimeType: 'image/webp',
      imageSizeBytes: 2048,
    }),
  )
  const storage = fakeStorage(log)

  const doc = await removeCategoryImageService(db, storage, 'cat-1', actor, ORIGIN)

  assert.equal(doc.imageObjectKey, null)
  assert.equal(doc.imageMimeType, null)
  assert.equal(doc.imageSizeBytes, null)
  assert.equal(doc.imageUrl, null)
  assert.deepEqual(log.deletes, ['categories/cat-1/to-remove.webp'])
})

test('§5 remove is idempotent when no image is set — no DB write, no delete', async () => {
  const log: StorageLog = { puts: [], deletes: [] }
  const db = fakeDb(baseCategory())
  const storage = fakeStorage(log)

  const doc = await removeCategoryImageService(db, storage, 'cat-1', actor, ORIGIN)

  assert.equal(doc.imageObjectKey, null)
  assert.deepEqual(log.deletes, [])
})

test('§6 unknown category: set and remove both raise NotFound and never touch storage', async () => {
  const log: StorageLog = { puts: [], deletes: [] }
  const db = fakeDb(baseCategory(), { missing: true })
  const storage = fakeStorage(log)

  await assert.rejects(
    setCategoryImageService(db, storage, 'missing', upload, actor, ORIGIN),
    (err) => err instanceof NotFoundError,
  )
  await assert.rejects(
    removeCategoryImageService(db, storage, 'missing', actor, ORIGIN),
    (err) => err instanceof NotFoundError,
  )
  assert.deepEqual(log.puts, [])
  assert.deepEqual(log.deletes, [])
})

test('§7 unsupported mime type is rejected before any write', async () => {
  const log: StorageLog = { puts: [], deletes: [] }
  const db = fakeDb(baseCategory())
  const storage = fakeStorage(log)

  await assert.rejects(
    setCategoryImageService(
      db,
      storage,
      'cat-1',
      { ...upload, mimeType: 'application/octet-stream' },
      actor,
      ORIGIN,
    ),
    (err) => err instanceof ValidationError,
  )
  assert.deepEqual(log.puts, [])
})

test('§8 oversized image is rejected before any write', async () => {
  const log: StorageLog = { puts: [], deletes: [] }
  const db = fakeDb(baseCategory())
  const storage = fakeStorage(log)

  await assert.rejects(
    setCategoryImageService(
      db,
      storage,
      'cat-1',
      { ...upload, sizeBytes: 11 * 1024 * 1024 },
      actor,
      ORIGIN,
    ),
    (err) => err instanceof ValidationError,
  )
  assert.deepEqual(log.puts, [])
})
