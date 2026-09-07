/**
 * Catalog sellability — the single authoritative derivation of "can this be
 * sold?" from the three independent facts the database stores:
 *
 *   product.status           — the operator's publish intent
 *   variant.status           — per-variant sellability intent
 *   inventory quantity_on_hand — physical stock (never implies sellability)
 *
 * Sellability is DERIVED, never stored. Every Admin surface (Products,
 * Inventory, Product detail, Store Sales, Dashboard) must resolve it through
 * these helpers so the same catalog state produces the same words and colour
 * everywhere. Raw enum values are never shown to operators — resolve with the
 * label maps below.
 */
import type { BilingualLabelMap, Locale } from './localization'

// ---------------------------------------------------------------------------
// Variant-level sellability
// ---------------------------------------------------------------------------

/**
 * - `sellable`      product active + option active + stock > 0 → can be rung up now  → "جاهز للبيع"
 * - `out_of_stock`  product active + option active + stock = 0                       → "نافد"
 * - `not_ready`     product is a draft, OR the option is draft/deactivated on an
 *                   otherwise-active product — intentionally not sellable            → "غير جاهز للبيع"
 * - `inactive`      the whole product is inactive / archived                        → "غير نشط"
 */
export type Sellability = 'sellable' | 'out_of_stock' | 'not_ready' | 'inactive'

export interface SellabilityInput {
  productStatus: string
  variantStatus: string
  quantityOnHand: number
}

export function deriveSellability(input: SellabilityInput): Sellability {
  if (input.productStatus === 'inactive' || input.productStatus === 'archived') return 'inactive'
  if (input.productStatus !== 'active') return 'not_ready' // draft product
  if (input.variantStatus !== 'active') return 'not_ready' // draft or deactivated option
  if (input.quantityOnHand <= 0) return 'out_of_stock'
  return 'sellable'
}

/** True only when a physical store sale can be completed right now. */
export function canSellNow(input: SellabilityInput): boolean {
  return deriveSellability(input) === 'sellable'
}

// ---------------------------------------------------------------------------
// Product-level readiness (rollup across a product's variants)
// ---------------------------------------------------------------------------

/**
 * - `sellable`      at least one variant is sellable now (active + in stock)  → "جاهز للبيع"
 * - `sellable_out`  every active variant is out of stock                     → "جاهز — نافد من المخزون"
 * - `needs_setup`   product is active but no variant is active yet (e.g. a
 *                   simple product whose default variant never got published,
 *                   or an options product with no activated option)          → "يحتاج إعداد"
 * - `draft`         product is still a draft — not published yet             → "غير جاهز للبيع"
 * - `inactive`      product was deactivated / archived                       → "غير نشط"
 */
export type ProductReadiness = 'sellable' | 'sellable_out' | 'needs_setup' | 'draft' | 'inactive'

export function deriveProductReadiness(
  productStatus: string,
  variants: readonly { status: string; quantityOnHand: number }[],
): ProductReadiness {
  if (productStatus === 'inactive' || productStatus === 'archived') return 'inactive'
  if (productStatus !== 'active') return 'draft'
  const active = variants.filter((v) => v.status === 'active')
  if (active.length === 0) return 'needs_setup'
  if (active.some((v) => v.quantityOnHand > 0)) return 'sellable'
  return 'sellable_out'
}

// ---------------------------------------------------------------------------
// Bilingual labels (Arabic-first). Never render the raw union value.
// ---------------------------------------------------------------------------

export const SELLABILITY_LABELS: BilingualLabelMap<Sellability> = {
  sellable: { ar: 'جاهز للبيع', en: 'Ready to sell' },
  out_of_stock: { ar: 'نافد', en: 'Out of stock' },
  not_ready: { ar: 'غير جاهز للبيع', en: 'Not ready to sell' },
  inactive: { ar: 'غير نشط', en: 'Inactive' },
}

export const PRODUCT_READINESS_LABELS: BilingualLabelMap<ProductReadiness> = {
  sellable: { ar: 'جاهز للبيع', en: 'Ready to sell' },
  sellable_out: { ar: 'جاهز — نافد من المخزون', en: 'Ready — out of stock' },
  needs_setup: { ar: 'يحتاج إعداد', en: 'Needs setup' },
  draft: { ar: 'غير جاهز للبيع', en: 'Not ready to sell' },
  inactive: { ar: 'غير نشط', en: 'Inactive' },
}

/** One-line reason an operator can act on (hover / detail). */
export const SELLABILITY_HINTS: BilingualLabelMap<Sellability> = {
  sellable: {
    ar: 'المنتج والخيار نشطان وتوجد كمية.',
    en: 'Product and option are active and in stock.',
  },
  out_of_stock: {
    ar: 'جاهز للبيع لكن لا توجد كمية في المخزون.',
    en: 'Ready to sell but nothing is in stock.',
  },
  not_ready: {
    ar: 'فعّل المنتج وهذا الخيار ليصبح متاحًا للبيع في المحل.',
    en: 'Activate the product and this option to make it sellable in store.',
  },
  inactive: {
    ar: 'المنتج غير نشط — لا يمكن بيعه حتى يُفعَّل.',
    en: 'The product is inactive — it cannot be sold until activated.',
  },
}

export const PRODUCT_READINESS_HINTS: BilingualLabelMap<ProductReadiness> = {
  sellable: {
    ar: 'يوجد خيار واحد على الأقل نشط وبه كمية.',
    en: 'At least one option is active and in stock.',
  },
  sellable_out: {
    ar: 'كل الخيارات النشطة نافدة من المخزون.',
    en: 'Every active option is out of stock.',
  },
  needs_setup: {
    ar: 'فعّل خيارات المنتج ليصبح متاحًا للبيع.',
    en: 'Activate the product’s options to make it sellable.',
  },
  draft: {
    ar: 'المنتج ما زال مسودة — انشره ليصبح متاحًا للبيع.',
    en: 'The product is still a draft — publish it to make it sellable.',
  },
  inactive: {
    ar: 'المنتج غير نشط.',
    en: 'The product is inactive.',
  },
}

export function sellabilityLabel(value: Sellability, locale: Locale): string {
  return SELLABILITY_LABELS[value][locale]
}

export function productReadinessLabel(value: ProductReadiness, locale: Locale): string {
  return PRODUCT_READINESS_LABELS[value][locale]
}
