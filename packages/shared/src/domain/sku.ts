/**
 * Internal Like Honey SKU standard.
 *
 * A SKU exists for every sellable variant and is the primary identity used on
 * the shop floor, in orders, in store-sale recording and (later) as Code 128
 * barcode content. It is an INTERNAL inventory identifier — it is not a GS1 /
 * EAN / UPC global registration and must never be presented as one.
 *
 * Format:  LH-{CATEGORY_CODE}-{PRODUCT_SEQUENCE}-{VARIANT_SUFFIX}
 * Example: LH-SHO-000123-PNK-30
 *
 * See docs/architecture/SKU_STANDARD.md for the full standard.
 */
import { IDENTIFIER_PREFIX, IDENTIFIER_SEPARATOR, IDENTIFIER_DIGIT_WIDTH } from './identifiers'

export const SKU_PREFIX = IDENTIFIER_PREFIX
export const SKU_SEPARATOR = IDENTIFIER_SEPARATOR

/** Category code used when a product has no category (or its category has no code). */
export const SKU_CATEGORY_FALLBACK_CODE = 'GEN'

/** Suffix used for the single default variant of a product with no options. */
export const SKU_DEFAULT_VARIANT_SUFFIX = 'DEF'

/** Width of the zero-padded product sequence inside a SKU. */
export const SKU_PRODUCT_SEQUENCE_WIDTH = IDENTIFIER_DIGIT_WIDTH

/** Maximum total SKU length (barcode-friendly). */
export const SKU_MAX_LENGTH = 32

/** A single SKU segment: uppercase ASCII letters/digits, 1–8 chars, no spaces. */
export const SKU_SEGMENT_RE = /^[A-Z0-9]{1,8}$/

/** A full variant suffix: one or more hyphen-joined segments. */
export const SKU_VARIANT_SUFFIX_RE = /^[A-Z0-9]{1,8}(?:-[A-Z0-9]{1,8})*$/

/** Full valid SKU shape against this document's format. */
export const SKU_RE = /^LH(?:-[A-Z0-9]{1,8}){3,5}$/

export interface SkuParts {
  /** Uppercase ASCII category code (typically 2–4 letters). */
  categoryCode: string
  /** Product sequence (see products.sequence); zero-padded automatically. */
  productSequence: number | string
  /** Variant suffix such as `PNK-30` or `DEF`. */
  variantSuffix: string
}

/** Validate a single SKU segment (uppercase alphanumeric, 1–8 chars). */
export function isValidSkuSegment(segment: string): boolean {
  return SKU_SEGMENT_RE.test(segment)
}

/**
 * Build a variant suffix from option-value codes (e.g. `['PNK', '30']` →
 * `PNK-30`). A variant with no option values uses the default `DEF` suffix.
 */
export function buildVariantSuffix(segments: readonly string[]): string {
  if (segments.length === 0) return SKU_DEFAULT_VARIANT_SUFFIX

  for (const segment of segments) {
    if (!isValidSkuSegment(segment)) {
      throw new Error(`Invalid SKU segment "${segment}"`)
    }
  }

  return segments.join(SKU_SEPARATOR)
}

/**
 * Build a full SKU from its parts. Throws on any part that violates the
 * standard. Uniqueness is enforced by the database (variants.sku unique).
 */
export function buildSku({ categoryCode, productSequence, variantSuffix }: SkuParts): string {
  if (!isValidSkuSegment(categoryCode)) {
    throw new Error(`Invalid SKU category code "${categoryCode}"`)
  }
  if (!SKU_VARIANT_SUFFIX_RE.test(variantSuffix)) {
    throw new Error(`Invalid SKU variant suffix "${variantSuffix}"`)
  }

  const sequenceRaw = String(productSequence)
  if (!/^\d+$/.test(sequenceRaw)) {
    throw new Error(`Invalid SKU product sequence "${productSequence}"`)
  }
  const sequence = sequenceRaw.padStart(SKU_PRODUCT_SEQUENCE_WIDTH, '0')

  const sku = `${SKU_PREFIX}${SKU_SEPARATOR}${categoryCode}${SKU_SEPARATOR}${sequence}${SKU_SEPARATOR}${variantSuffix}`

  if (sku.length > SKU_MAX_LENGTH || !SKU_RE.test(sku)) {
    throw new Error(`SKU "${sku}" violates the Like Honey SKU standard`)
  }

  return sku
}

/** Validate an existing SKU against the standard shape and length. */
export function isValidSku(sku: string): boolean {
  return sku.length <= SKU_MAX_LENGTH && SKU_RE.test(sku)
}
