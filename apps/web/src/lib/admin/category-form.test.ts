/**
 * Category editor form helpers regression tests — prove the Admin payloads
 * match the API contract (`categoryCreateSchema` / `categoryUpdateSchema`)
 * so category create/edit no longer 400s on the backend.
 *
 * Run:  node --import tsx --test src/lib/admin/category-form.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { categoryCreateSchema, categoryUpdateSchema } from '@likehoney/shared'

import {
  buildCategoryCreatePayload,
  buildCategoryUpdatePayload,
  type CategoryFormValues,
} from './category-form'

function createValues(overrides: Partial<CategoryFormValues> = {}): CategoryFormValues {
  return {
    nameAr: 'ألعاب',
    nameEn: 'Toys',
    code: 'toys',
    slug: '',
    descriptionAr: '',
    descriptionEn: '',
    status: 'active',
    ...overrides,
  }
}

test('create payload trims names, uppercases the code and omits blank slug and blank descriptions', () => {
  const { payload, errors } = buildCategoryCreatePayload(createValues({ code: '  toys ' }))
  assert.deepEqual(errors, {})
  assert.ok(payload)
  assert.equal(payload.nameEn, 'Toys')
  assert.equal(payload.code, 'TOYS')
  assert.equal('slug' in payload, false)
  assert.equal('descriptionAr' in payload, false)
  assert.equal('descriptionEn' in payload, false)
})

test('create payload sends a valid manual slug (trimmed and normalized)', () => {
  const { payload } = buildCategoryCreatePayload(createValues({ slug: ' wooden-toys ' }))
  assert.ok(payload)
  assert.equal(payload.slug, 'wooden-toys')
})

test('blank descriptions are omitted while filled ones are trimmed and sent', () => {
  const { payload } = buildCategoryCreatePayload(
    createValues({
      descriptionAr: '  وصف العائلة  ',
      descriptionEn: 'Family friendly ',
    }),
  )
  assert.ok(payload)
  assert.equal(payload.descriptionAr, 'وصف العائلة')
  assert.equal(payload.descriptionEn, 'Family friendly')
})

test('a valid create payload parses with the API categoryCreateSchema', () => {
  const { payload } = buildCategoryCreatePayload(createValues())
  assert.ok(payload)
  assert.equal(categoryCreateSchema.safeParse(payload).success, true)
})

test('missing names produce per-field required errors', () => {
  const { payload, errors } = buildCategoryCreatePayload(createValues({ nameAr: '  ', nameEn: '' }))
  assert.equal(payload, undefined)
  assert.equal(errors.nameAr, 'required')
  assert.equal(errors.nameEn, 'required')
})

test('an invalid code produces a codeFormat error, not a silent mutation', () => {
  for (const code of [' A B ', 'TOOLONGCODE']) {
    const { payload, errors } = buildCategoryCreatePayload(createValues({ code }))
    assert.equal(payload, undefined)
    assert.equal(errors.code, 'codeFormat')
  }
})

test('an invalid slug produces a slugFormat error, not a silent mutation', () => {
  const { payload, errors } = buildCategoryCreatePayload(createValues({ slug: 'Big Toys' }))
  assert.equal(payload, undefined)
  assert.equal(errors.slug, 'slugFormat')
})

test('update payload omits blank slug, blank descriptions and the code, and passes the API schema', () => {
  const { payload, errors } = buildCategoryUpdatePayload(createValues())
  assert.deepEqual(errors, {})
  assert.ok(payload)
  assert.equal(payload.nameAr, 'ألعاب')
  assert.equal('code' in payload, false)
  assert.equal('slug' in payload, false)
  assert.equal('descriptionAr' in payload, false)
  assert.equal('descriptionEn' in payload, false)
  assert.equal(categoryUpdateSchema.safeParse(payload).success, true)
})

test('update payload sends a valid manual slug (trimmed and normalized)', () => {
  const { payload } = buildCategoryUpdatePayload(createValues({ slug: ' learning-toys ' }))
  assert.ok(payload)
  assert.equal(payload.slug, 'learning-toys')
})

test('update payload with slug and descriptions parses with the API categoryUpdateSchema', () => {
  const { payload } = buildCategoryUpdatePayload(
    createValues({
      slug: 'learning-toys',
      descriptionAr: 'ألعاب تعليمية',
      descriptionEn: 'Learning toys',
    }),
  )
  assert.ok(payload)
  assert.equal(payload.slug, 'learning-toys')
  assert.equal(categoryUpdateSchema.safeParse(payload).success, true)
})

test('update does not require a category code', () => {
  const { payload } = buildCategoryUpdatePayload(createValues({ code: '' }))
  assert.ok(payload)
  assert.equal('code' in payload, false)
})

test('update rejects an invalid manual slug too', () => {
  const { payload, errors } = buildCategoryUpdatePayload(createValues({ slug: 'Big Toys' }))
  assert.equal(payload, undefined)
  assert.equal(errors.slug, 'slugFormat')
})

test('update still requires the bilingual names', () => {
  const { payload, errors } = buildCategoryUpdatePayload(createValues({ nameEn: '  ' }))
  assert.equal(payload, undefined)
  assert.equal(errors.nameEn, 'required')
})
