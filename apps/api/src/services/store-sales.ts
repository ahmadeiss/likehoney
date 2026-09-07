/**
 * In-store sale (physical register) service.
 *
 * Authoritative-by-construction, mirroring public checkout:
 * - The client submits only variant ids + quantities.
 * - The server re-resolves every active variant's real unit price and snapshots
 *   product data.
 * - The sale header, item snapshots, atomic stock deductions, `STORE_SALE`
 *   inventory movements AND the audit row all run in ONE `db.transaction`
 *   (INVENTORY_RULES.md §3). `deductStock` returns no row when on-hand is below
 *   the requested amount → the whole sale aborts with 409 `insufficient_stock`.
 *   Two simultaneous sales of the final unit cannot both succeed.
 *
 * No delivery fee, no payment capture in V1: `totalMinor === subtotalMinor`.
 */
import {
  InsufficientStockError,
  NotFoundError,
  ValidationError,
  isValidNormalizedPhone,
  normalizePhone,
  type StoreSaleCreateInput,
  type StoreSaleCustomerCard,
  type StoreSaleListQuery,
} from '@likehoney/shared'
import {
  customerHasOtherTransactions,
  ensureBalance,
  deductStock,
  getActiveProductsByIds,
  getActiveVariantsByIds,
  getCategoriesByIds,
  getCustomerById,
  getCustomerByPhone,
  getStoreSaleWithItems,
  getSuppliersByIds,
  insertMovement,
  insertStoreSale,
  insertStoreSaleItems,
  listStoreSales,
  resolveCustomerByPhone,
  searchStoreSaleProducts,
  withDeadlockRetry,
  type CustomerRow,
  type DbClient,
} from '@likehoney/db'

import { mediaStreamUrl } from '../media/storage'
import { auditActor, auditMeta, recordAudit } from './audit'

// ---------------------------------------------------------------------------
// Register product search
// ---------------------------------------------------------------------------

function toCustomerCard(customer: CustomerRow, isReturning: boolean): StoreSaleCustomerCard {
  return {
    id: customer.id,
    phoneNormalized: customer.phoneNormalized,
    nameEn: customer.firstNameEn,
    nameAr: customer.firstNameAr,
    cityEn: customer.cityEn,
    cityAr: customer.cityAr,
    addressEn: customer.addressEn,
    addressAr: customer.addressAr,
    isReturning,
  }
}

// ---------------------------------------------------------------------------
// POS phone-first customer lookup (§14) — minimal card, never full 360 data.
// ---------------------------------------------------------------------------

export async function lookupStoreSaleCustomerService(db: DbClient, rawPhone: string) {
  const phoneNormalized = normalizePhone(rawPhone)
  if (!isValidNormalizedPhone(phoneNormalized)) {
    return { found: false, customer: null }
  }
  const customer = await getCustomerByPhone(db, phoneNormalized)
  if (customer === undefined) return { found: false, customer: null }
  const isReturning = await customerHasOtherTransactions(db, customer.id)
  return { found: true, customer: toCustomerCard(customer, isReturning) }
}

export async function searchStoreSaleProductsService(
  db: DbClient,
  term: string,
  limit: number,
  origin: string,
) {
  const hits = await searchStoreSaleProducts(db, term, limit)
  return {
    data: hits.map(({ primaryImageKey, ...hit }) => ({
      ...hit,
      imageUrl: primaryImageKey !== null ? mediaStreamUrl(origin, primaryImageKey) : null,
    })),
  }
}

// ---------------------------------------------------------------------------
// Create sale
// ---------------------------------------------------------------------------

function prepareLines(
  input: StoreSaleCreateInput['lines'],
): { variantId: string; quantity: number }[] {
  const seen = new Set<string>()
  const lines: { variantId: string; quantity: number }[] = []
  for (const line of input) {
    if (line.quantity <= 0) throw new ValidationError('quantity must be positive')
    if (seen.has(line.variantId)) {
      throw new ValidationError('duplicate sale line', { variantId: line.variantId })
    }
    seen.add(line.variantId)
    lines.push({ variantId: line.variantId, quantity: line.quantity })
  }
  return lines
}

interface ResolvedLine {
  productId: string
  variantId: string
  sku: string
  productNameEn: string
  productNameAr: string
  variantLabelEn: string | null
  variantLabelAr: string | null
  unitPriceMinor: number
  quantity: number
  lineTotalMinor: number
  unitCostMinor: number | null
  supplierId: string | null
  supplierNameEn: string | null
  supplierNameAr: string | null
  categoryId: string | null
  categoryNameEn: string | null
  categoryNameAr: string | null
}

export async function createStoreSaleService(
  db: DbClient,
  input: StoreSaleCreateInput,
  actorStaffId: string,
) {
  const prepared = prepareLines(input.lines)
  const variantIds = prepared.map((line) => line.variantId)

  const variants = await getActiveVariantsByIds(db, variantIds)
  const variantById = new Map(variants.map((variant) => [variant.id, variant]))

  const productIds = [...new Set(variants.map((variant) => variant.productId))]
  const activeProducts = await getActiveProductsByIds(db, productIds)
  const productById = new Map(activeProducts.map((product) => [product.id, product]))

  const supplierIds = [
    ...new Set(activeProducts.map((p) => p.supplierId).filter((id): id is string => id !== null)),
  ]
  const categoryIds = [
    ...new Set(activeProducts.map((p) => p.categoryId).filter((id): id is string => id !== null)),
  ]
  const suppliersById = new Map((await getSuppliersByIds(db, supplierIds)).map((s) => [s.id, s]))
  const categoriesById = new Map((await getCategoriesByIds(db, categoryIds)).map((c) => [c.id, c]))

  const resolved: ResolvedLine[] = []
  for (const line of prepared) {
    const variant = variantById.get(line.variantId)
    if (variant === undefined) {
      throw new ValidationError('a selected product is no longer available', {
        variantId: line.variantId,
      })
    }
    const product = productById.get(variant.productId)
    if (product === undefined) {
      throw new ValidationError('a selected product is no longer available', {
        variantId: line.variantId,
      })
    }
    const supplier = product.supplierId !== null ? suppliersById.get(product.supplierId) : undefined
    const category =
      product.categoryId !== null ? categoriesById.get(product.categoryId) : undefined
    resolved.push({
      productId: variant.productId,
      variantId: variant.id,
      sku: variant.sku,
      productNameEn: product.nameEn,
      productNameAr: product.nameAr,
      variantLabelEn: variant.optionLabelEn,
      variantLabelAr: variant.optionLabelAr,
      unitPriceMinor: variant.priceMinor,
      quantity: line.quantity,
      lineTotalMinor: variant.priceMinor * line.quantity,
      unitCostMinor: variant.acquisitionCostMinor,
      supplierId: supplier?.id ?? null,
      supplierNameEn: supplier?.nameEn ?? null,
      supplierNameAr: supplier?.nameAr ?? null,
      categoryId: category?.id ?? null,
      categoryNameEn: category?.nameEn ?? null,
      categoryNameAr: category?.nameAr ?? null,
    })
  }

  const subtotalMinor = resolved.reduce((sum, line) => sum + line.lineTotalMinor, 0)
  const totalMinor = subtotalMinor

  // Phone-first POS customer capture (§14-§17). Omitted `customerPhone` ⇒
  // intentional anonymous "بيع بدون بيانات عميل" — never a fabricated shared
  // "Walk-in Customer" identity. Unconditional identity resolution (not
  // consent-gated) once a validly-shaped phone is present, mirroring online
  // checkout: the sale row already records the phone regardless.
  const rawPhone = input.customerPhone?.trim()
  const customerPhoneNormalized =
    rawPhone !== undefined && rawPhone.length > 0 ? normalizePhone(rawPhone) : null
  const customerCanResolve =
    customerPhoneNormalized !== null && isValidNormalizedPhone(customerPhoneNormalized)

  // Inventory rows are always mutated in ascending variant_id order so that two
  // concurrent multi-line transactions (in either presentation order) can never
  // deadlock. Item snapshots + response keep the operator's basket order.
  const stockOrder = [...resolved].sort((a, b) =>
    a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
  )

  const sale = await withDeadlockRetry(() =>
    db.transaction(async (tx) => {
      const customer = customerCanResolve
        ? await resolveCustomerByPhone(tx, {
            phoneNormalized: customerPhoneNormalized as string,
            nameEn: input.customerName ?? null,
            nameAr: input.customerName ?? null,
            cityEn: input.customerCity ?? null,
            cityAr: input.customerCity ?? null,
            addressEn: input.customerAddress ?? null,
            addressAr: input.customerAddress ?? null,
            consentToStoreData: false,
            consentToContact: false,
            seenAt: new Date(),
          })
        : undefined

      const created = await insertStoreSale(tx, {
        staffId: actorStaffId,
        customerId: customer?.id,
        customerPhoneRawSnapshot: rawPhone ?? null,
        customerPhoneNormalized,
        customerNameEnSnapshot: input.customerName ?? null,
        customerNameArSnapshot: input.customerName ?? null,
        customerCityEnSnapshot: input.customerCity ?? null,
        customerCityArSnapshot: input.customerCity ?? null,
        customerAddressEnSnapshot: input.customerAddress ?? null,
        customerAddressArSnapshot: input.customerAddress ?? null,
        subtotalMinor,
        totalMinor,
        currency: 'ILS',
        note: input.note ?? null,
      })

      await insertStoreSaleItems(
        tx,
        created.id,
        resolved.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          skuSnapshot: line.sku,
          productNameEnSnapshot: line.productNameEn,
          productNameArSnapshot: line.productNameAr,
          variantLabelArSnapshot: line.variantLabelAr,
          variantLabelEnSnapshot: line.variantLabelEn,
          unitPriceMinor: line.unitPriceMinor,
          quantity: line.quantity,
          unitCostSnapshot: line.unitCostMinor,
          supplierIdSnapshot: line.supplierId,
          supplierNameEnSnapshot: line.supplierNameEn,
          supplierNameArSnapshot: line.supplierNameAr,
          categoryIdSnapshot: line.categoryId,
          categoryNameEnSnapshot: line.categoryNameEn,
          categoryNameArSnapshot: line.categoryNameAr,
        })),
      )

      for (const line of stockOrder) {
        await ensureBalance(tx, line.variantId)
        const updated = await deductStock(tx, line.variantId, line.quantity)
        if (updated === undefined) {
          throw new InsufficientStockError({ variantId: line.variantId })
        }
        await insertMovement(tx, {
          variantId: line.variantId,
          movementType: 'STORE_SALE',
          quantityChange: -line.quantity,
          quantityAfter: updated.quantityOnHand,
          storeSaleId: created.id,
          staffId: actorStaffId,
          reason: 'store sale',
        })
      }

      await recordAudit(
        tx,
        auditActor(actorStaffId),
        'store_sale.create',
        'store_sale',
        created.id,
        auditMeta({ number: created.number, lines: resolved.length, totalMinor }),
      )

      return created
    }),
  )

  return {
    id: sale.id,
    number: sale.number,
    createdAt: sale.createdAt.toISOString(),
    subtotalMinor,
    totalMinor,
    currency: 'ILS',
    items: resolved.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      sku: line.sku,
      productNameAr: line.productNameAr,
      productNameEn: line.productNameEn,
      variantLabelAr: line.variantLabelAr,
      variantLabelEn: line.variantLabelEn,
      unitPriceMinor: line.unitPriceMinor,
      quantity: line.quantity,
      lineTotalMinor: line.lineTotalMinor,
    })),
  }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export async function listStoreSalesService(db: DbClient, query: StoreSaleListQuery) {
  const { rows, total } = await listStoreSales(db, {
    page: query.page,
    pageSize: query.pageSize,
    search: query.search,
  })
  return {
    data: rows.map((row) => ({
      id: row.id,
      number: row.number,
      createdAt: row.createdAt.toISOString(),
      staffId: row.staffId,
      staffNameAr: row.staffNameAr,
      staffNameEn: row.staffNameEn,
      itemCount: row.itemCount,
      totalUnits: row.totalUnits,
      subtotalMinor: row.subtotalMinor,
      totalMinor: row.totalMinor,
      currency: row.currency,
      note: row.note,
    })),
    meta: { page: query.page, pageSize: query.pageSize, total },
  }
}

export async function getStoreSaleDetailService(db: DbClient, id: string) {
  const result = await getStoreSaleWithItems(db, id)
  if (result === undefined) throw new NotFoundError('store sale not found')
  const { header, items } = result

  let customer: StoreSaleCustomerCard | null = null
  if (header.customerId !== null) {
    const [customerRow, isReturning] = await Promise.all([
      getCustomerById(db, header.customerId),
      customerHasOtherTransactions(db, header.customerId, { storeSaleId: header.id }),
    ])
    if (customerRow !== undefined) customer = toCustomerCard(customerRow, isReturning)
  }

  return {
    id: header.id,
    number: header.number,
    createdAt: header.createdAt.toISOString(),
    staffId: header.staffId,
    staffNameAr: header.staffNameAr,
    staffNameEn: header.staffNameEn,
    itemCount: header.itemCount,
    totalUnits: header.totalUnits,
    subtotalMinor: header.subtotalMinor,
    totalMinor: header.totalMinor,
    currency: header.currency,
    note: header.note,
    customerPhoneNormalized: header.customerPhoneNormalized,
    customer,
    items: items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      sku: item.skuSnapshot,
      productNameAr: item.productNameArSnapshot,
      productNameEn: item.productNameEnSnapshot,
      variantLabelAr: item.variantLabelArSnapshot,
      variantLabelEn: item.variantLabelEnSnapshot,
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      lineTotalMinor: item.unitPriceMinor * item.quantity,
    })),
  }
}
