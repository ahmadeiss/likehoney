/**
 * Product + variant service.
 *
 * Owns the SKU standard invariant: every product carries at least one variant,
 * each uniquely SKU'd as LH-{CATEGORY_CODE}-{SEQUENCE}-{SUFFIX}. Product
 * creation materializes the requested pricing shape:
 * - `simple`  → one default variant (suffix `DEF`)
 * - `options` → option definitions + one variant per option-value combination
 *
 * Option display order is embedded in SKU suffix order and is therefore
 * immutable once a variant exists. Category code is embedded in SKUs, so a
 * product's category cannot change after any variant exists.
 */
import {
  buildSku,
  buildVariantSuffix,
  ConflictError,
  isValidSkuSegment,
  NotFoundError,
  SKU_CATEGORY_FALLBACK_CODE,
  ValidationError,
  type OptionValueAddInput,
  type ProductCreateInput,
  type ProductListQuery,
  type ProductUpdateInput,
  type ProductPricing,
  type VariantCreateInput,
  type VariantUpdateInput,
} from '@likehoney/shared'
import type { DbClient } from '@likehoney/db'
import {
  countVariantsForOption,
  createProduct,
  getBalance,
  getCategory,
  getCategoryCode,
  getOption,
  getOptionValue,
  getProduct,
  getProductSequence,
  getSupplier,
  getVariant,
  getVariantOptionValueIds,
  hasAnyVariant,
  insertOption,
  insertOptionValues,
  insertVariant,
  insertVariantOptionLinks,
  listOptionValuesForProduct,
  listOptionsForProduct,
  listProducts,
  listVariantsForProduct,
  updateOption,
  updateOptionValue,
  updateProduct,
  updateVariant,
  variantIdsForOptionValue,
  variantOptionValuesOrdered,
  type ProductOptionValueRow,
  type ProductVariantRow,
} from '@likehoney/db'

import { auditMeta, recordAudit, type AuditActor } from './audit'

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export async function listProductsService(db: DbClient, query: ProductListQuery) {
  const { rows, total } = await listProducts(db, query)
  return { data: rows, meta: { page: query.page, pageSize: query.pageSize, total } }
}

export async function getProductDetailService(
  db: DbClient,
  productId: string,
  /** Gate C — only include per-variant `acquisitionCostMinor` for a caller
   *  that holds `catalog-cost:read`. Never serialized otherwise. */
  includeCost = false,
) {
  const product = await getProduct(db, productId)
  if (product === undefined) throw new NotFoundError('product not found')

  const [category, supplier, options, values, variants] = await Promise.all([
    product.categoryId !== null ? getCategory(db, product.categoryId) : undefined,
    product.supplierId !== null ? getSupplier(db, product.supplierId) : undefined,
    listOptionsForProduct(db, productId),
    listOptionValuesForProduct(db, productId),
    listVariantsForProduct(db, productId),
  ])

  const balances = new Map<string, { quantityOnHand: number; quantityReserved: number }>()
  for (const variant of variants) {
    const balance = await getBalance(db, variant.id)
    balances.set(variant.id, {
      quantityOnHand: balance?.quantityOnHand ?? 0,
      quantityReserved: balance?.quantityReserved ?? 0,
    })
  }

  return {
    ...product,
    category:
      category === undefined
        ? null
        : {
            id: category.id,
            code: category.code,
            slug: category.slug,
            nameEn: category.nameEn,
            nameAr: category.nameAr,
          },
    supplier:
      supplier === undefined
        ? null
        : { id: supplier.id, nameEn: supplier.nameEn, nameAr: supplier.nameAr },
    options: options.map((option) => ({
      id: option.id,
      nameEn: option.nameEn,
      nameAr: option.nameAr,
      displayOrder: option.displayOrder,
      values: values
        .filter((value) => value.optionId === option.id)
        .map((value) => ({
          id: value.id,
          code: value.code,
          valueEn: value.valueEn,
          valueAr: value.valueAr,
          displayOrder: value.displayOrder,
        })),
    })),
    /** True only when the caller may see acquisition cost — lets the UI show
     *  the field as "not editable" vs "hidden" honestly. */
    costVisible: includeCost,
    variants: variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      status: variant.status,
      priceMinor: variant.priceMinor,
      ...(includeCost ? { acquisitionCostMinor: variant.acquisitionCostMinor } : {}),
      optionLabelEn: variant.optionLabelEn,
      optionLabelAr: variant.optionLabelAr,
      optionValueIds: [] as string[],
      quantityOnHand: balances.get(variant.id)?.quantityOnHand ?? 0,
      /** Held for pending electronic orders (Gate B4 Stage 5 §28/§31) — a
       *  commercial hold, never a physical deduction. */
      quantityReserved: balances.get(variant.id)?.quantityReserved ?? 0,
    })),
  }
}

export async function createProductService(
  db: DbClient,
  input: ProductCreateInput,
  actor: AuditActor,
) {
  const product = await db.transaction(async (tx) => {
    if (input.categoryId !== undefined) {
      const category = await getCategory(tx, input.categoryId)
      if (category === undefined) throw new NotFoundError('category not found')
    }
    if (input.supplierId !== undefined) {
      const supplier = await getSupplier(tx, input.supplierId)
      if (supplier === undefined) throw new NotFoundError('supplier not found')
    }

    const created = await createProduct(tx, {
      categoryId: input.categoryId ?? null,
      supplierId: input.supplierId ?? null,
      nameEn: input.nameEn,
      nameAr: input.nameAr,
      descriptionEn: input.descriptionEn ?? null,
      descriptionAr: input.descriptionAr ?? null,
      shortBlurbEn: input.shortBlurbEn ?? null,
      shortBlurbAr: input.shortBlurbAr ?? null,
      status: input.status ?? 'draft',
    })

    await materializePricing(
      tx,
      created.id,
      created.sequence,
      created.categoryId,
      input.pricing,
      created.status,
    )
    return created
  })

  await recordAudit(
    db,
    actor,
    'product.created',
    'product',
    product.id,
    auditMeta({ sequence: product.sequence }),
  )
  return product
}

export async function updateProductService(
  db: DbClient,
  productId: string,
  input: ProductUpdateInput,
  actor: AuditActor,
) {
  const existing = await getProduct(db, productId)
  if (existing === undefined) throw new NotFoundError('product not found')

  if (input.categoryId !== undefined) {
    const target = input.categoryId
    if (target !== null) {
      const category = await getCategory(db, target)
      if (category === undefined) throw new NotFoundError('category not found')
    }
    if (target !== existing.categoryId) {
      const anyVariant = await hasAnyVariant(db, productId)
      if (anyVariant) {
        throw new ConflictError('category is embedded in SKUs; cannot change once variants exist')
      }
    }
  }

  if (input.supplierId !== undefined && input.supplierId !== null) {
    const supplier = await getSupplier(db, input.supplierId)
    if (supplier === undefined) throw new NotFoundError('supplier not found')
  }

  const fields = {
    categoryId: input.categoryId,
    supplierId: input.supplierId,
    nameEn: input.nameEn,
    nameAr: input.nameAr,
    descriptionEn: input.descriptionEn,
    descriptionAr: input.descriptionAr,
    shortBlurbEn: input.shortBlurbEn,
    shortBlurbAr: input.shortBlurbAr,
    status: input.status,
  }

  // Publishing/unpublishing a SIMPLE product (no options) must keep its hidden
  // default variant coherent, in ONE transaction — one business action, one
  // authoritative result. Any save that carries a `status` reconciles the
  // default variant to match (`active` → variant `active`; anything else →
  // variant `inactive`). Stock is never touched. Options products are left
  // alone: each variant is activated deliberately by the operator.
  const carriesStatus = input.status !== undefined
  const statusChanged = carriesStatus && input.status !== existing.status
  const product = carriesStatus
    ? await db.transaction(async (tx) => {
        const updated = await updateProduct(tx, productId, fields)
        if (updated === undefined) throw new NotFoundError('product not found')

        const options = await listOptionsForProduct(tx, productId)
        if (options.length === 0) {
          const variants = await listVariantsForProduct(tx, productId)
          const nextVariantStatus = input.status === 'active' ? 'active' : 'inactive'
          for (const variant of variants) {
            if (variant.status !== nextVariantStatus) {
              await updateVariant(tx, variant.id, { status: nextVariantStatus })
            }
          }
        }
        return updated
      })
    : await updateProduct(db, productId, fields)
  if (product === undefined) throw new NotFoundError('product not found')

  await recordAudit(
    db,
    actor,
    statusChanged ? 'product.status_changed' : 'product.updated',
    'product',
    product.id,
    statusChanged ? auditMeta({ from: existing.status, to: input.status }) : undefined,
  )
  return product
}

// ---------------------------------------------------------------------------
// Pricing materialization / SKU generation
// ---------------------------------------------------------------------------

function cartesian<T>(groups: readonly T[][]): T[][] {
  return groups.reduce<T[][]>(
    (accumulator, group) => accumulator.flatMap((prefix) => group.map((item) => [...prefix, item])),
    [[]],
  )
}

async function categoryCodeFor(tx: DbClient, categoryId: string | null): Promise<string> {
  if (categoryId === null) return SKU_CATEGORY_FALLBACK_CODE
  return (await getCategoryCode(tx, categoryId)) ?? SKU_CATEGORY_FALLBACK_CODE
}

async function materializePricing(
  tx: DbClient,
  productId: string,
  sequence: number,
  categoryId: string | null,
  pricing: ProductPricing,
  productStatus: string,
) {
  const categoryCode = await categoryCodeFor(tx, categoryId)

  if (pricing.mode === 'simple') {
    const sku = buildSku({
      categoryCode,
      productSequence: sequence,
      variantSuffix: buildVariantSuffix([]),
    })
    // A simple product has one hidden "default" variant — an implementation
    // detail the operator never manages. Its lifecycle follows the product:
    // publishing an active simple product publishes its only sellable unit.
    await insertVariant(tx, {
      productId,
      sku,
      priceMinor: pricing.priceMinor,
      status: productStatus === 'active' ? 'active' : 'draft',
      optionLabelEn: null,
      optionLabelAr: null,
    })
    return
  }

  for (const [optionIndex, option] of pricing.options.entries()) {
    const inserted = await insertOption(tx, {
      productId,
      nameEn: option.nameEn,
      nameAr: option.nameAr,
      displayOrder: option.displayOrder ?? optionIndex,
    })
    await insertOptionValues(
      tx,
      inserted.id,
      option.values.map((value, valueIndex) => ({
        code: value.code,
        valueEn: value.valueEn,
        valueAr: value.valueAr,
        displayOrder: valueIndex,
      })),
    )
  }

  const options = await listOptionsForProduct(tx, productId)
  const allValues = await listOptionValuesForProduct(tx, productId)
  const valuesByOption = new Map<string, typeof allValues>()
  for (const value of allValues) {
    const group = valuesByOption.get(value.optionId) ?? []
    group.push(value)
    valuesByOption.set(value.optionId, group)
  }

  const combos = cartesian(options.map((option) => valuesByOption.get(option.id) ?? []))

  for (const combo of combos) {
    if (combo.length !== options.length) continue
    const sku = buildSku({
      categoryCode,
      productSequence: sequence,
      variantSuffix: buildVariantSuffix(combo.map((value) => value.code)),
    })
    const variant = await insertVariant(tx, {
      productId,
      sku,
      priceMinor: pricing.priceMinor,
      status: 'draft',
      optionLabelEn: combo.map((value) => value.valueEn).join(' / '),
      optionLabelAr: combo.map((value) => value.valueAr).join(' / '),
    })
    await insertVariantOptionLinks(
      tx,
      variant.id,
      combo.map((value) => value.id),
    )
  }
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

interface OptionValueOrdered {
  optionId: string
  optionValueId: string
  valueEn: string
  valueAr: string
  code: string
}

async function orderedOptionValuesForIds(
  db: DbClient,
  optionValueIds: string[],
): Promise<OptionValueOrdered[]> {
  const values = await Promise.all(optionValueIds.map((id) => getOptionValue(db, id)))
  const optionIds = new Set<string>()
  for (const value of values) {
    if (value !== undefined) optionIds.add(value.optionId)
  }
  const options = await Promise.all([...optionIds].map((id) => getOption(db, id)))

  const optionsById = new Map(options.map((option) => [option?.id ?? '', option]))
  const ordered: OptionValueOrdered[] = []
  for (const value of values) {
    if (value === undefined) continue
    const option = optionsById.get(value.optionId)
    if (option === undefined) continue
    ordered.push({
      optionId: option.id,
      optionValueId: value.id,
      valueEn: value.valueEn,
      valueAr: value.valueAr,
      code: value.code,
    })
  }
  ordered.sort((a, b) => {
    const option = optionsById.get(a.optionId)
    const other = optionsById.get(b.optionId)
    if (option === undefined || other === undefined) return 0
    if (option.displayOrder !== other.displayOrder) return option.displayOrder - other.displayOrder
    const aValue = values.find((v) => v?.id === a.optionValueId)
    const bValue = values.find((v) => v?.id === b.optionValueId)
    return (aValue?.displayOrder ?? 0) - (bValue?.displayOrder ?? 0)
  })
  return ordered
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((id, index) => id === sortedB[index])
}

async function validateOptionCombo(db: DbClient, productId: string, optionValueIds: string[]) {
  const options = await listOptionsForProduct(db, productId)
  if (options.length === 0) {
    if (optionValueIds.length > 0) {
      throw new ValidationError('this product has no options; optionValueIds must be empty')
    }
    return
  }

  const allowed = new Set(
    (await listOptionValuesForProduct(db, productId)).map((value) => value.id),
  )
  for (const id of optionValueIds) {
    if (!allowed.has(id)) {
      throw new ValidationError('option value does not belong to this product', {
        optionValueId: id,
      })
    }
  }

  const perOption = new Map<string, number>()
  for (const id of optionValueIds) {
    const value = await getOptionValue(db, id)
    if (value === undefined) continue
    perOption.set(value.optionId, (perOption.get(value.optionId) ?? 0) + 1)
  }

  if (perOption.size !== options.length) {
    throw new ValidationError('exactly one value per option is required')
  }
  for (const option of options) {
    if ((perOption.get(option.id) ?? 0) !== 1) {
      throw new ValidationError('exactly one value per option is required', { optionId: option.id })
    }
  }
}

export async function addVariantService(
  db: DbClient,
  productId: string,
  input: VariantCreateInput,
  actor: AuditActor,
) {
  const product = await getProduct(db, productId)
  if (product === undefined) throw new NotFoundError('product not found')

  const options = await listOptionsForProduct(db, productId)
  const existing = await listVariantsForProduct(db, productId)

  await validateOptionCombo(db, productId, input.optionValueIds)

  if (options.length === 0) {
    if (existing.length > 0) {
      throw new ConflictError('the default variant already exists for this product')
    }
  } else {
    for (const variant of existing) {
      const ids = await getVariantOptionValueIds(db, variant.id)
      if (sameIds(ids, input.optionValueIds)) {
        throw new ConflictError('a variant for this option combination already exists')
      }
    }
  }

  const sequence = await getProductSequence(db, productId)
  if (sequence === undefined) throw new NotFoundError('product not found')

  const categoryCode = await categoryCodeFor(db, product.categoryId)
  const ordered = await orderedOptionValuesForIds(db, input.optionValueIds)
  const sku = buildSku({
    categoryCode,
    productSequence: sequence,
    variantSuffix: buildVariantSuffix(ordered.map((value) => value.code)),
  })

  const variant = await insertVariant(db, {
    productId,
    sku,
    priceMinor: input.priceMinor,
    // `null` when the operator left cost blank — "unknown", never 0.
    acquisitionCostMinor: input.acquisitionCostMinor ?? null,
    status: input.status ?? 'draft',
    optionLabelEn: ordered.length > 0 ? ordered.map((value) => value.valueEn).join(' / ') : null,
    optionLabelAr: ordered.length > 0 ? ordered.map((value) => value.valueAr).join(' / ') : null,
  })

  await insertVariantOptionLinks(db, variant.id, input.optionValueIds)
  await recordAudit(
    db,
    actor,
    'variant.created',
    'product.variant',
    variant.id,
    auditMeta({ sku: variant.sku }),
  )
  return variant
}

/**
 * Bulk-activate every currently-`draft` variant of one product — the staff
 * action after reviewing a freshly-generated combination matrix ("عطّلي أي
 * تركيبة غير متوفرة، ثم فعّلي الباقي دفعة واحدة"). Scoped strictly to this
 * product and to `draft` status: never touches variants staff has already
 * marked `inactive` (not offered), never touches another product's variants,
 * never touches historical variants (those are never `draft` again once
 * they've left it). Reuses the same `updateVariant` repo call and per-row
 * audit trail as the single-variant path — no direct SQL bulk UPDATE.
 */
export async function bulkActivateDraftVariantsService(
  db: DbClient,
  productId: string,
  actor: AuditActor,
) {
  const product = await getProduct(db, productId)
  if (product === undefined) throw new NotFoundError('product not found')

  const variants = await listVariantsForProduct(db, productId)
  const draftVariants = variants.filter((v) => v.status === 'draft')

  const activated = []
  for (const draft of draftVariants) {
    const updated = await updateVariant(db, draft.id, { status: 'active' })
    if (updated === undefined) continue
    await recordAudit(
      db,
      actor,
      'variant.updated',
      'product.variant',
      updated.id,
      auditMeta({ bulkActivate: true }),
    )
    activated.push(updated)
  }

  return { activatedCount: activated.length, variants: activated }
}

export async function updateVariantService(
  db: DbClient,
  variantId: string,
  input: VariantUpdateInput,
  actor: AuditActor,
) {
  const existing = await getVariant(db, variantId)
  if (existing === undefined) throw new NotFoundError('variant not found')

  const variant = await updateVariant(db, variantId, {
    priceMinor: input.priceMinor,
    // Passed through EXACTLY as received: absent → untouched, `null` → cleared
    // to unknown, `0` → an explicit zero cost. Never coalesced. This only ever
    // changes the CURRENT variant cost — historical order_item /
    // store_sale_item `unit_cost_snapshot` values are immutable and untouched.
    acquisitionCostMinor: input.acquisitionCostMinor,
    status: input.status,
    optionLabelEn: input.optionLabelEn === undefined ? undefined : input.optionLabelEn,
    optionLabelAr: input.optionLabelAr === undefined ? undefined : input.optionLabelAr,
  })
  if (variant === undefined) throw new NotFoundError('variant not found')

  await recordAudit(db, actor, 'variant.updated', 'product.variant', variant.id)
  return variant
}

/**
 * §9 — apply ONE acquisition cost to many variants of a product in one call.
 * A thin fan-out over the canonical `updateVariant` (per-row audit kept), NOT
 * a bulk SQL UPDATE. `variantIds` omitted ⇒ every variant of the product.
 * `null` clears cost to "unknown"; the value is never coalesced to 0.
 */
export async function bulkVariantCostService(
  db: DbClient,
  productId: string,
  input: { acquisitionCostMinor?: number | null; variantIds?: string[] },
  actor: AuditActor,
) {
  const product = await getProduct(db, productId)
  if (product === undefined) throw new NotFoundError('product not found')

  const all = await listVariantsForProduct(db, productId)
  const targetSet = input.variantIds === undefined ? null : new Set(input.variantIds)
  const targets = targetSet === null ? all : all.filter((v) => targetSet.has(v.id))

  let updatedCount = 0
  for (const v of targets) {
    const updated = await updateVariant(db, v.id, {
      acquisitionCostMinor: input.acquisitionCostMinor ?? null,
    })
    if (updated === undefined) continue
    await recordAudit(
      db,
      actor,
      'variant.updated',
      'product.variant',
      updated.id,
      auditMeta({ bulkCost: true }),
    )
    updatedCount += 1
  }
  return { updatedCount }
}

// ---------------------------------------------------------------------------
// Options and option values
// ---------------------------------------------------------------------------

export async function updateOptionService(
  db: DbClient,
  optionId: string,
  input: { nameEn?: string; nameAr?: string; displayOrder?: number },
  actor: AuditActor,
) {
  const existing = await getOption(db, optionId)
  if (existing === undefined) throw new NotFoundError('option not found')

  if (input.displayOrder !== undefined && input.displayOrder !== existing.displayOrder) {
    const linked = await countVariantsForOption(db, optionId)
    if (linked > 0) {
      throw new ValidationError(
        'option display order is immutable once variants exist (SKU suffix order)',
      )
    }
  }

  const option = await updateOption(db, optionId, {
    nameEn: input.nameEn,
    nameAr: input.nameAr,
    displayOrder: input.displayOrder,
  })
  if (option === undefined) throw new NotFoundError('option not found')

  await recordAudit(db, actor, 'option.updated', 'product.option', option.id)
  return option
}

/** PostgreSQL error shape after unwrapping Drizzle's `.cause` chain. */
function asPgError(err: unknown): { code: string; constraint?: string } | null {
  let node: unknown = err
  for (let depth = 0; depth < 5 && node != null; depth += 1) {
    if (typeof node === 'object' && 'code' in node) {
      const code = (node as { code?: unknown }).code
      if (typeof code === 'string' && code.length > 0) {
        const constraint = (node as { constraint?: unknown }).constraint
        return { code, constraint: typeof constraint === 'string' ? constraint : undefined }
      }
    }
    node = typeof node === 'object' && node !== null ? (node as { cause?: unknown }).cause : null
  }
  return null
}

const UNIQUE_VIOLATION = '23505'

/**
 * Translate the two unique constraints this operation can legitimately race
 * against (§14 concurrency safety) into stable domain conflicts. The DB is
 * the actual authority — this only makes its rejection legible; nothing here
 * grants uniqueness that didn't already exist in the schema.
 */
function mapOptionValueDbError(err: unknown): Error | null {
  const pg = asPgError(err)
  if (pg === null) return null
  if (pg.code !== UNIQUE_VIOLATION) return null
  if (pg.constraint === 'product_option_values_option_code_uq') {
    return new ConflictError('a value with this code already exists in this option')
  }
  if (pg.constraint === 'product_variants_sku_unique') {
    return new ConflictError('a generated SKU collided with an existing one — please retry')
  }
  return null
}

/**
 * Derive the SKU-suffix code for a new option value from its English label —
 * the same uppercase-alnum invariant every other code in the system already
 * carries (SKU_STANDARD.md). Staff types only the two bilingual labels
 * (§5); no code field, no internal id, ever surfaced for this lightweight
 * flow.
 */
function deriveOptionValueCode(valueEn: string): string {
  return valueEn
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)
}

/**
 * Add a new VALUE to an EXISTING option group after the product has already
 * been created (§ "PRODUCT AUTHORING + OPTION SELECTION / EXISTING-OPTION
 * VALUE EXTENSION") — e.g. Size gains "31" after Black/White × 28/29/30 is
 * already live. Deliberately narrow: this never adds a new OPTION GROUP, only
 * a value inside one that already exists.
 *
 * Generates ONLY the missing combinations: the new value × every EXISTING
 * value of every OTHER option (generic cartesian over however many option
 * groups the product has — never hardcoded to two). Every previously-existing
 * variant is left completely untouched (different rows, never re-inserted,
 * never re-priced, never relabeled). Every newly-generated variant starts
 * `draft` — the same safety default as initial product creation — and is
 * priced from the caller-supplied `priceMinor` (the same "staff enters the
 * price" convention `addVariantService`/the manual Add Variant dialog already
 * use — never copied from an arbitrary sibling).
 *
 * Atomic: the option value insert and every generated variant + its
 * option-value links happen inside one DB transaction — a failure on any
 * generated combination rolls back the entire operation, never leaving a
 * value with a partial variant set (§12). Concurrency safety comes from two
 * pre-existing DB constraints, no migration needed: `product_option_values_
 * option_code_uq` (per-option code uniqueness) and the global `sku` uniqueness
 * on `product_variants` — a losing concurrent request gets a clean 409, never
 * a duplicate row (§14/§15).
 */
export async function addOptionValueService(
  db: DbClient,
  optionId: string,
  input: OptionValueAddInput,
  actor: AuditActor,
) {
  const option = await getOption(db, optionId)
  if (option === undefined) throw new NotFoundError('option not found')

  const code = deriveOptionValueCode(input.valueEn)
  if (!isValidSkuSegment(code)) {
    throw new ValidationError(
      'could not derive a valid SKU code from the English value — use at least one letter or digit',
      { field: 'valueEn' },
    )
  }

  const product = await getProduct(db, option.productId)
  if (product === undefined) throw new NotFoundError('product not found')
  const sequence = await getProductSequence(db, product.id)
  if (sequence === undefined) throw new NotFoundError('product not found')
  const categoryCode = await categoryCodeFor(db, product.categoryId)

  const options = await listOptionsForProduct(db, product.id)
  const allValues = await listOptionValuesForProduct(db, product.id)
  const valuesByOption = new Map<string, ProductOptionValueRow[]>()
  for (const value of allValues) {
    const group = valuesByOption.get(value.optionId) ?? []
    group.push(value)
    valuesByOption.set(value.optionId, group)
  }

  const existingInThisOption = valuesByOption.get(optionId) ?? []
  if (existingInThisOption.some((value) => value.code === code)) {
    throw new ConflictError('a value with this code already exists in this option', { code })
  }
  const nextDisplayOrder =
    existingInThisOption.reduce((max, value) => Math.max(max, value.displayOrder), -1) + 1

  let createdValue: ProductOptionValueRow | undefined
  const createdVariants: ProductVariantRow[] = []

  try {
    await db.transaction(async (tx) => {
      const inserted = await insertOptionValues(tx, optionId, [
        {
          code,
          valueEn: input.valueEn.trim(),
          valueAr: input.valueAr.trim(),
          displayOrder: nextDisplayOrder,
        },
      ])
      createdValue = inserted[0]
      if (createdValue === undefined) throw new Error('failed to insert option value')
      const newValue = createdValue

      // Generation groups: the option being extended contributes ONLY the
      // new value; every other option contributes its full EXISTING value
      // set. Cartesian across all groups (any number of options) yields
      // exactly the missing combinations — old combinations are never
      // re-touched because they are never part of any generated group here.
      const groups = options.map((o) =>
        o.id === optionId ? [newValue] : (valuesByOption.get(o.id) ?? []),
      )
      const combos = cartesian(groups)

      for (const combo of combos) {
        if (combo.length !== options.length) continue
        const sku = buildSku({
          categoryCode,
          productSequence: sequence,
          variantSuffix: buildVariantSuffix(combo.map((value) => value.code)),
        })
        const variant = await insertVariant(tx, {
          productId: product.id,
          sku,
          priceMinor: input.priceMinor,
          acquisitionCostMinor: input.acquisitionCostMinor ?? null,
          status: 'draft',
          optionLabelEn: combo.map((value) => value.valueEn).join(' / '),
          optionLabelAr: combo.map((value) => value.valueAr).join(' / '),
        })
        await insertVariantOptionLinks(
          tx,
          variant.id,
          combo.map((value) => value.id),
        )
        createdVariants.push(variant)
      }
    })
  } catch (err) {
    const mapped = mapOptionValueDbError(err)
    if (mapped !== null) throw mapped
    throw err
  }

  const value = createdValue as ProductOptionValueRow
  await recordAudit(
    db,
    actor,
    'option.value.created',
    'product.option.value',
    value.id,
    auditMeta({ code, optionId, generatedVariantCount: createdVariants.length }),
  )
  for (const variant of createdVariants) {
    await recordAudit(
      db,
      actor,
      'variant.created',
      'product.variant',
      variant.id,
      auditMeta({ sku: variant.sku, generatedFromOptionValue: value.id }),
    )
  }

  return { value, variants: createdVariants }
}

export async function updateOptionValueService(
  db: DbClient,
  optionValueId: string,
  input: { valueEn?: string; valueAr?: string },
  actor: AuditActor,
) {
  const existing = await getOptionValue(db, optionValueId)
  if (existing === undefined) throw new NotFoundError('option value not found')

  const updated = await updateOptionValue(db, optionValueId, {
    valueEn: input.valueEn,
    valueAr: input.valueAr,
  })
  if (updated === undefined) throw new NotFoundError('option value not found')

  await recomputeVariantLabels(db, optionValueId)
  await recordAudit(db, actor, 'option.value.updated', 'product.option.value', optionValueId)
  return updated
}

async function recomputeVariantLabels(db: DbClient, optionValueId: string) {
  const variantIds = await variantIdsForOptionValue(db, optionValueId)
  for (const variantId of variantIds) {
    const ordered = await variantOptionValuesOrdered(db, variantId)
    if (ordered.length === 0) continue
    await updateVariant(db, variantId, {
      optionLabelEn: ordered.map((value) => value.valueEn).join(' / '),
      optionLabelAr: ordered.map((value) => value.valueAr).join(' / '),
    })
  }
}
