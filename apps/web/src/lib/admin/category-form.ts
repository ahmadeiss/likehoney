/**
 * Category editor form helpers (pure, unit-testable).
 *
 * The API contract (`categoryCreateSchema` / `categoryUpdateSchema` in
 * `@likehoney/shared`) is strict about optional fields: `slug` and the
 * descriptions must be OMITTED when blank — an empty string fails `.min(1)`
 * on the slug, and the descriptions are typed `z.string().optional()` so
 * `null` is rejected too. The backend auto-generates the slug from the
 * English name when `slug` is absent, so the editor simply must not send it.
 *
 * These builders normalize the raw form state into a transport payload and
 * return field-level error codes that the UI localizes.
 */
import type { CategoryCreateInput, CategoryUpdateInput, EntityStatus } from './client'

export interface CategoryFormValues {
  nameAr: string
  nameEn: string
  /** Create only — the API's `code` is immutable and never sent on update. */
  code: string
  slug: string
  descriptionAr: string
  descriptionEn: string
  status: EntityStatus
}

export type CategoryField = 'nameAr' | 'nameEn' | 'code' | 'slug'

export type CategoryFormErrorCode = 'required' | 'codeFormat' | 'slugFormat'

export type CategoryFormErrors = Partial<Record<CategoryField, CategoryFormErrorCode>>

const CODE_PATTERN = /^[A-Z0-9]{1,8}$/
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function trimmed(value: string): string {
  return value.trim()
}

/** Blank → `undefined` so the key is omitted from the payload. */
function optionalTrimmed(value: string): string | undefined {
  const value_ = value.trim()
  return value_.length > 0 ? value_ : undefined
}

/** Blank → `undefined` (auto-generated/unchanged); valid → normalized. */
function optionalSlug(value: string): string | undefined {
  const value_ = value.trim()
  return value_.length > 0 ? value_.toLowerCase() : undefined
}

function validateShared(values: CategoryFormValues, requireCode: boolean): CategoryFormErrors {
  const errors: CategoryFormErrors = {}
  if (values.nameAr.trim().length === 0) errors.nameAr = 'required'
  if (values.nameEn.trim().length === 0) errors.nameEn = 'required'
  if (requireCode) {
    const code = values.code.trim().toUpperCase()
    if (code.length === 0) errors.code = 'required'
    else if (!CODE_PATTERN.test(code)) errors.code = 'codeFormat'
  }
  const slug = values.slug.trim()
  if (slug.length > 0 && !SLUG_PATTERN.test(slug)) errors.slug = 'slugFormat'
  return errors
}

export function buildCategoryCreatePayload(values: CategoryFormValues): {
  payload?: CategoryCreateInput
  errors: CategoryFormErrors
} {
  const errors = validateShared(values, true)
  if (errors.nameAr || errors.nameEn || errors.code || errors.slug) return { errors }

  const payload: CategoryCreateInput = {
    nameAr: trimmed(values.nameAr),
    nameEn: trimmed(values.nameEn),
    code: values.code.trim().toUpperCase(),
    status: values.status,
  }
  const slug = optionalSlug(values.slug)
  if (slug !== undefined) payload.slug = slug
  const descriptionAr = optionalTrimmed(values.descriptionAr)
  if (descriptionAr !== undefined) payload.descriptionAr = descriptionAr
  const descriptionEn = optionalTrimmed(values.descriptionEn)
  if (descriptionEn !== undefined) payload.descriptionEn = descriptionEn
  return { payload, errors }
}

export function buildCategoryUpdatePayload(values: CategoryFormValues): {
  payload?: CategoryUpdateInput
  errors: CategoryFormErrors
} {
  const errors = validateShared(values, false)
  if (errors.nameAr || errors.nameEn || errors.slug) return { errors }

  const payload: CategoryUpdateInput = {
    nameAr: trimmed(values.nameAr),
    nameEn: trimmed(values.nameEn),
    status: values.status,
  }
  const slug = optionalSlug(values.slug)
  if (slug !== undefined) payload.slug = slug
  const descriptionAr = optionalTrimmed(values.descriptionAr)
  if (descriptionAr !== undefined) payload.descriptionAr = descriptionAr
  const descriptionEn = optionalTrimmed(values.descriptionEn)
  if (descriptionEn !== undefined) payload.descriptionEn = descriptionEn
  return { payload, errors }
}
