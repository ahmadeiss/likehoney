/**
 * Variant + option data access (product options, option values, variants,
 * and the variant↔option-value join).
 */
import { asc, eq, inArray } from 'drizzle-orm'

import type { DbClient } from '../client'
import {
  productOptionValues,
  productOptions,
  productVariantOptions,
  productVariants,
} from '../schema'

export type ProductOptionRow = typeof productOptions.$inferSelect
export type ProductOptionValueRow = typeof productOptionValues.$inferSelect
export type ProductVariantRow = typeof productVariants.$inferSelect

export type VariantStatusValue = 'draft' | 'active' | 'inactive'

export interface OptionValueOrdered {
  optionId: string
  optionValueId: string
  optionDisplayOrder: number
  valueDisplayOrder: number
  code: string
  valueEn: string
  valueAr: string
}

// ---------------------------------------------------------------------------
// Options and values
// ---------------------------------------------------------------------------

export async function insertOption(
  db: DbClient,
  values: {
    productId: string
    nameEn: string
    nameAr: string
    displayOrder: number
  },
): Promise<ProductOptionRow> {
  const rows = await db.insert(productOptions).values(values).returning()
  return rows[0] as ProductOptionRow
}

export async function insertOptionValues(
  db: DbClient,
  optionId: string,
  values: Array<{
    valueEn: string
    valueAr: string
    code: string
    displayOrder: number
  }>,
): Promise<ProductOptionValueRow[]> {
  if (values.length === 0) return []
  const rows = await db
    .insert(productOptionValues)
    .values(values.map((value) => ({ optionId, ...value })))
    .returning()
  return rows
}

export async function listOptionsForProduct(
  db: DbClient,
  productId: string,
): Promise<ProductOptionRow[]> {
  return db
    .select()
    .from(productOptions)
    .where(eq(productOptions.productId, productId))
    .orderBy(asc(productOptions.displayOrder))
}

export async function listOptionValuesForProduct(
  db: DbClient,
  productId: string,
): Promise<ProductOptionValueRow[]> {
  const options = await listOptionsForProduct(db, productId)
  const optionIds = options.map((option) => option.id)
  if (optionIds.length === 0) return []
  return db
    .select()
    .from(productOptionValues)
    .where(inArray(productOptionValues.optionId, optionIds))
    .orderBy(asc(productOptionValues.displayOrder))
}

export async function getOption(
  db: DbClient,
  optionId: string,
): Promise<ProductOptionRow | undefined> {
  const rows = await db
    .select()
    .from(productOptions)
    .where(eq(productOptions.id, optionId))
    .limit(1)
  return rows[0]
}

export async function updateOption(
  db: DbClient,
  optionId: string,
  values: Partial<ProductOptionRow>,
): Promise<ProductOptionRow | undefined> {
  const rows = await db
    .update(productOptions)
    .set(values)
    .where(eq(productOptions.id, optionId))
    .returning()
  return rows[0]
}

export async function getOptionValue(
  db: DbClient,
  optionValueId: string,
): Promise<ProductOptionValueRow | undefined> {
  const rows = await db
    .select()
    .from(productOptionValues)
    .where(eq(productOptionValues.id, optionValueId))
    .limit(1)
  return rows[0]
}

export async function updateOptionValue(
  db: DbClient,
  optionValueId: string,
  values: Partial<ProductOptionValueRow>,
): Promise<ProductOptionValueRow | undefined> {
  const rows = await db
    .update(productOptionValues)
    .set(values)
    .where(eq(productOptionValues.id, optionValueId))
    .returning()
  return rows[0]
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export interface NewVariant {
  productId: string
  sku: string
  priceMinor: number
  /** Acquisition cost, minor units. `null`/absent = unknown (never 0). */
  acquisitionCostMinor?: number | null
  status: VariantStatusValue
  optionLabelEn?: string | null
  optionLabelAr?: string | null
}

export async function insertVariant(db: DbClient, values: NewVariant): Promise<ProductVariantRow> {
  const rows = await db
    .insert(productVariants)
    .values({ ...values, status: values.status ?? 'draft' })
    .returning()
  return rows[0] as ProductVariantRow
}

export async function insertVariantOptionLinks(
  db: DbClient,
  variantId: string,
  optionValueIds: string[],
): Promise<void> {
  if (optionValueIds.length === 0) return
  await db
    .insert(productVariantOptions)
    .values(optionValueIds.map((optionValueId) => ({ variantId, optionValueId })))
    .onConflictDoNothing()
}

export async function listVariantsForProduct(
  db: DbClient,
  productId: string,
): Promise<ProductVariantRow[]> {
  return db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.createdAt))
}

export async function getVariant(
  db: DbClient,
  variantId: string,
): Promise<ProductVariantRow | undefined> {
  const rows = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, variantId))
    .limit(1)
  return rows[0]
}

export async function getVariantBySku(
  db: DbClient,
  sku: string,
): Promise<ProductVariantRow | undefined> {
  const rows = await db.select().from(productVariants).where(eq(productVariants.sku, sku)).limit(1)
  return rows[0]
}

export async function updateVariant(
  db: DbClient,
  variantId: string,
  values: Partial<{
    sku: string
    status: VariantStatusValue
    priceMinor: number
    /**
     * `undefined` → left untouched (Drizzle `.set()` drops undefined keys).
     * `null` → cost cleared to "unknown". `0` → an explicit zero cost.
     * The service must pass exactly what the client sent, never a coalesce.
     */
    acquisitionCostMinor: number | null
    optionLabelEn: string | null
    optionLabelAr: string | null
  }>,
): Promise<ProductVariantRow | undefined> {
  const rows = await db
    .update(productVariants)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(productVariants.id, variantId))
    .returning()
  return rows[0]
}

export async function getVariantProductId(
  db: DbClient,
  variantId: string,
): Promise<string | undefined> {
  const rows = await db
    .select({ productId: productVariants.productId })
    .from(productVariants)
    .where(eq(productVariants.id, variantId))
    .limit(1)
  return rows[0]?.productId
}

/** Ordered option-value payload for a variant (used for SKU suffix + labels). */
export async function variantOptionValuesOrdered(
  db: DbClient,
  variantId: string,
): Promise<OptionValueOrdered[]> {
  const rows = await db
    .select({
      optionId: productOptions.id,
      optionValueId: productOptionValues.id,
      optionDisplayOrder: productOptions.displayOrder,
      valueDisplayOrder: productOptionValues.displayOrder,
      code: productOptionValues.code,
      valueEn: productOptionValues.valueEn,
      valueAr: productOptionValues.valueAr,
    })
    .from(productVariantOptions)
    .innerJoin(productOptionValues, eq(productVariantOptions.optionValueId, productOptionValues.id))
    .innerJoin(productOptions, eq(productOptionValues.optionId, productOptions.id))
    .where(eq(productVariantOptions.variantId, variantId))
    .orderBy(asc(productOptions.displayOrder), asc(productOptionValues.displayOrder))
  return rows
}

/** Distinct variants linked to an option value (to recompute labels). */
export async function variantIdsForOptionValue(
  db: DbClient,
  optionValueId: string,
): Promise<string[]> {
  const rows = await db
    .select({ variantId: productVariantOptions.variantId })
    .from(productVariantOptions)
    .where(eq(productVariantOptions.optionValueId, optionValueId))
  return rows.map((row) => row.variantId)
}

/** Whether any variant references a value of the given option. */
export async function countVariantsForOption(db: DbClient, optionId: string): Promise<number> {
  const rows = await db
    .select({ variantId: productVariantOptions.variantId })
    .from(productVariantOptions)
    .innerJoin(productOptionValues, eq(productVariantOptions.optionValueId, productOptionValues.id))
    .where(eq(productOptionValues.optionId, optionId))
    .limit(1)
  return rows.length
}

export async function getVariantOptionValueIds(db: DbClient, variantId: string): Promise<string[]> {
  const rows = await db
    .select({ optionValueId: productVariantOptions.optionValueId })
    .from(productVariantOptions)
    .where(eq(productVariantOptions.variantId, variantId))
  return rows.map((row) => row.optionValueId)
}
