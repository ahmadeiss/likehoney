/**
 * Public checkout + guest order service — Cash on Delivery, Gate B1.
 *
 * Authoritative-by-construction:
 * - The browser submits only line identities, quantities, delivery geography,
 *   an `idempotencyKey`, a `quoteFingerprint` and contact/address fields. Any
 *   client-supplied price / subtotal / fee / total is ignored by the schema.
 * - The server independently resolves each active variant's real unit price and
 *   the active delivery zone's real fee, and computes every total.
 * - `quoteCheckoutService` is the authoritative quote: it returns the resolved
 *   lines + totals + a server `quoteFingerprint` over the commercial truth.
 * - `createCheckoutOrderService` re-resolves that truth at submit. If the quote
 *   drifted → 409 `checkout_totals_changed` (no order). If COD is disabled →
 *   422 `payment_method_disabled`. Otherwise ONE PostgreSQL transaction:
 *   idempotency claim → order + immutable snapshots → guarded per-line stock
 *   deduction (ascending variant id) → `ONLINE_ORDER` movements → optional
 *   consented customer profile → audit → claim completed. Any failure rolls the
 *   whole thing back — no partial order, items, movements or completed claim.
 * - Idempotency: `checkout_claims.claim_key` (fast replay) + `orders.idempotency_key`
 *   (permanent backstop). The same key never creates order #2.
 */
import {
  CheckoutProcessingError,
  CheckoutTotalsChangedError,
  IdempotencyConflictError,
  InsufficientStockError,
  PaymentMethodDisabledError,
  ValidationError,
  fingerprint,
  isValidNormalizedPhone,
  normalizeIntentText,
  normalizePhone,
  type CheckoutCreateInput,
  type PublicCartLineInput,
  type PublicCartVerifyInput,
  type QuoteLine,
  type QuoteResponse,
} from '@likehoney/shared'
import {
  claimCheckout,
  completeCheckoutClaim,
  deductStock,
  getActiveDeliveryZone,
  getActiveProductsByIds,
  getActiveVariantsByIds,
  getBalancesByVariantIds,
  getCategoriesByIds,
  getCheckoutClaim,
  getOrderById,
  getSetting,
  getSuppliersByIds,
  insertMovement,
  insertOrder,
  insertOrderItems,
  listOrderItems,
  resolveCustomerByPhone,
  setLocalLockTimeout,
  withDeadlockRetry,
  type DbClient,
  type OrderRow,
} from '@likehoney/db'

import { toMoneyStrings } from './money'
import { auditActor, auditMeta, recordAudit } from './audit'

export const CURRENCY = 'ILS'
export const CLAIM_LOCK_TIMEOUT = '5s'

// ---------------------------------------------------------------------------
// Shared: structural line prep + commercial-truth resolution
// ---------------------------------------------------------------------------

/** Structural check + de-dupe of submitted lines (client is not trusted). */
function prepareLines(input: PublicCartLineInput[]): { variantId: string; quantity: number }[] {
  const seen = new Set<string>()
  const lines: { variantId: string; quantity: number }[] = []
  for (const line of input) {
    if (line.quantity <= 0) throw new ValidationError('quantity must be positive')
    if (seen.has(line.variantId)) {
      throw new ValidationError('duplicate cart line', { variantId: line.variantId })
    }
    seen.add(line.variantId)
    lines.push({ variantId: line.variantId, quantity: line.quantity })
  }
  return lines
}

export interface ResolvedLine {
  variantId: string
  productId: string
  sku: string
  productNameEn: string
  productNameAr: string
  variantLabelEn: string | null
  variantLabelAr: string | null
  unitPriceMinor: number
  quantity: number
  lineTotalMinor: number
  availableQuantity: number
  /**
   * Gate C sale-time snapshot inputs — the variant's current acquisition cost
   * and the product's current supplier/category (id + bilingual name, `null`
   * when unset). Captured here, at commercial-truth resolution time, so the
   * order-item insert never has to re-query the catalog.
   */
  unitCostMinor: number | null
  supplierId: string | null
  supplierNameEn: string | null
  supplierNameAr: string | null
  categoryId: string | null
  categoryNameEn: string | null
  categoryNameAr: string | null
}

export interface CommercialTruth {
  lines: ResolvedLine[]
  zone: {
    id: string
    code: string
    nameAr: string
    nameEn: string
    feeMinor: number
  }
  subtotalMinor: number
  deliveryFeeMinor: number
  totalMinor: number
}

/**
 * Re-resolves lines + delivery zone against the live catalog. Throws
 * `ValidationError` when a line no longer maps to an active, buyable variant or
 * the zone is inactive. Does NOT check stock sufficiency (that is the guarded
 * deduction's job) — `availableQuantity` is informational only.
 */
export async function resolveCommercialTruth(
  db: DbClient,
  deliveryZoneId: string,
  rawLines: PublicCartLineInput[],
): Promise<CommercialTruth> {
  const prepared = prepareLines(rawLines)

  const zone = await getActiveDeliveryZone(db, deliveryZoneId)
  if (zone === undefined) {
    throw new ValidationError('delivery zone is unavailable', { deliveryZoneId })
  }

  const variantIds = prepared.map((line) => line.variantId)
  const variants = await getActiveVariantsByIds(db, variantIds)
  const variantById = new Map(variants.map((v) => [v.id, v]))
  const balances = await getBalancesByVariantIds(db, variantIds)

  const productIds = [...new Set(variants.map((v) => v.productId))]
  const activeProducts = await getActiveProductsByIds(db, productIds)
  const productById = new Map(activeProducts.map((p) => [p.id, p]))

  const supplierIds = [
    ...new Set(activeProducts.map((p) => p.supplierId).filter((id): id is string => id !== null)),
  ]
  const categoryIds = [
    ...new Set(activeProducts.map((p) => p.categoryId).filter((id): id is string => id !== null)),
  ]
  const suppliersById = new Map((await getSuppliersByIds(db, supplierIds)).map((s) => [s.id, s]))
  const categoriesById = new Map((await getCategoriesByIds(db, categoryIds)).map((c) => [c.id, c]))

  const lines: ResolvedLine[] = []
  for (const line of prepared) {
    const variant = variantById.get(line.variantId)
    if (variant === undefined) {
      throw new ValidationError('a selected item is no longer available', {
        variantId: line.variantId,
      })
    }
    const product = productById.get(variant.productId)
    if (product === undefined) {
      throw new ValidationError('a selected item is no longer available', {
        variantId: line.variantId,
      })
    }
    const supplier = product.supplierId !== null ? suppliersById.get(product.supplierId) : undefined
    const category =
      product.categoryId !== null ? categoriesById.get(product.categoryId) : undefined
    lines.push({
      variantId: variant.id,
      productId: variant.productId,
      sku: variant.sku,
      productNameEn: product.nameEn,
      productNameAr: product.nameAr,
      variantLabelEn: variant.optionLabelEn,
      variantLabelAr: variant.optionLabelAr,
      unitPriceMinor: variant.priceMinor,
      quantity: line.quantity,
      lineTotalMinor: variant.priceMinor * line.quantity,
      availableQuantity: balances.get(variant.id) ?? 0,
      unitCostMinor: variant.acquisitionCostMinor,
      supplierId: supplier?.id ?? null,
      supplierNameEn: supplier?.nameEn ?? null,
      supplierNameAr: supplier?.nameAr ?? null,
      categoryId: category?.id ?? null,
      categoryNameEn: category?.nameEn ?? null,
      categoryNameAr: category?.nameAr ?? null,
    })
  }

  const subtotalMinor = lines.reduce((sum, l) => sum + l.lineTotalMinor, 0)
  const deliveryFeeMinor = zone.feeMinor
  return {
    lines,
    zone: {
      id: zone.id,
      code: zone.code,
      nameAr: zone.nameAr,
      nameEn: zone.nameEn,
      feeMinor: zone.feeMinor,
    },
    subtotalMinor,
    deliveryFeeMinor,
    totalMinor: subtotalMinor + deliveryFeeMinor,
  }
}

/**
 * Fingerprint over COMMERCIAL TRUTH ONLY — sorted line (variant, price, qty),
 * zone id, fee, subtotal, total, currency. Payment-method availability is NOT
 * included: disabling electronic must not invalidate a COD quote (that is a
 * separate submit-time check).
 */
export function quoteFingerprint(truth: CommercialTruth): Promise<string> {
  return fingerprint({
    lines: truth.lines
      .map((l) => ({ v: l.variantId, p: l.unitPriceMinor, q: l.quantity }))
      .sort((a, b) => (a.v < b.v ? -1 : a.v > b.v ? 1 : 0)),
    deliveryZoneId: truth.zone.id,
    deliveryFeeMinor: truth.deliveryFeeMinor,
    subtotalMinor: truth.subtotalMinor,
    totalMinor: truth.totalMinor,
    currency: CURRENCY,
  })
}

/**
 * Fingerprint over LOGICAL CHECKOUT INTENT — everything the customer chose that
 * makes this submission "the same" one on retry.
 */
export function requestFingerprint(input: CheckoutCreateInput): Promise<string> {
  return fingerprint({
    lines: input.lines
      .map((l) => ({ v: l.variantId, q: l.quantity }))
      .sort((a, b) => (a.v < b.v ? -1 : a.v > b.v ? 1 : 0)),
    deliveryZoneId: input.deliveryZoneId,
    paymentMethod: input.paymentMethod,
    phone: normalizePhone(input.customer.phone),
    name: normalizeIntentText(input.customer.name),
    city: normalizeIntentText(input.customer.city),
    addressLine1: normalizeIntentText(input.customer.addressLine1),
    addressLine2: normalizeIntentText(input.customer.addressLine2),
    customerNote: normalizeIntentText(input.customer.note),
    consentToStoreData: input.customer.consentToStoreData === true,
  })
}

/**
 * Authoritative COD availability. Unset ⇒ enabled (a fresh store can sell).
 * Exported so the Gate B4 Stage 3 typed payment-settings service reads the
 * exact same semantic instead of re-implementing it — one source of truth.
 */
export async function isCodEnabled(db: DbClient): Promise<boolean> {
  const row = await getSetting(db, 'checkout:cod.enabled')
  if (row === undefined) return true
  try {
    const parsed = JSON.parse(row.valueJson) as { enabled?: unknown }
    return parsed.enabled !== false
  } catch {
    return true
  }
}

function toQuoteLines(lines: ResolvedLine[]): QuoteLine[] {
  return lines.map((l) => ({
    variantId: l.variantId,
    productId: l.productId,
    sku: l.sku,
    productNameAr: l.productNameAr,
    productNameEn: l.productNameEn,
    variantLabelAr: l.variantLabelAr,
    variantLabelEn: l.variantLabelEn,
    unitPriceMinor: l.unitPriceMinor,
    quantity: l.quantity,
    lineTotalMinor: l.lineTotalMinor,
    availableQuantity: l.availableQuantity,
    inStock: l.availableQuantity >= l.quantity,
  }))
}

/**
 * `electronicAvailable`: Gate B4 Stage 3 — ACTUAL current availability (not a
 * saved preference), computed by the caller (the route layer has the Worker
 * env the readiness check needs). Defaults to `false` for the two internal
 * `buildQuote` call sites that only rebuild a quote for a
 * `CheckoutTotalsChangedError` payload deep inside a transaction — always
 * correct in Stage 3, since electronic is never available at all yet.
 */
async function buildQuote(
  db: DbClient,
  truth: CommercialTruth,
  electronicAvailable = false,
): Promise<QuoteResponse> {
  return {
    lines: toQuoteLines(truth.lines),
    subtotalMinor: truth.subtotalMinor,
    deliveryFeeMinor: truth.deliveryFeeMinor,
    totalMinor: truth.totalMinor,
    currency: CURRENCY,
    deliveryZone: {
      id: truth.zone.id,
      code: truth.zone.code,
      nameAr: truth.zone.nameAr,
      nameEn: truth.zone.nameEn,
      feeMinor: truth.zone.feeMinor,
    },
    paymentMethods: { cod: await isCodEnabled(db), electronic: electronicAvailable },
    quoteFingerprint: await quoteFingerprint(truth),
    quotedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Authoritative quote endpoint
// ---------------------------------------------------------------------------

export async function quoteCheckoutService(
  db: DbClient,
  input: PublicCartVerifyInput,
  electronicAvailable = false,
): Promise<QuoteResponse> {
  const truth = await resolveCommercialTruth(db, input.deliveryZoneId, input.lines)
  return buildQuote(db, truth, electronicAvailable)
}

// ---------------------------------------------------------------------------
// COD checkout
// ---------------------------------------------------------------------------

export interface CheckoutResult {
  orderId: string
  number: string
  status: OrderRow['status']
  paymentMethod: OrderRow['paymentMethod']
  paymentStatus: OrderRow['paymentStatus']
  items: {
    sku: string
    productNameAr: string
    productNameEn: string
    quantity: number
    unitPriceMinor: number
    lineTotalMinor: number
  }[]
  subtotalMinor: number
  deliveryFeeMinor: number
  totalMinor: number
  currency: string
  totals: { subtotal: string; deliveryFee: string; total: string; currency: string }
}

function resultFromOrder(order: OrderRow, items: CheckoutResult['items']): CheckoutResult {
  const totals = toMoneyStrings(order.totalMinor, order.subtotalMinor, order.deliveryFeeMinor)
  return {
    orderId: order.id,
    number: order.number,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    items,
    subtotalMinor: order.subtotalMinor,
    deliveryFeeMinor: order.deliveryFeeMinor,
    totalMinor: order.totalMinor,
    currency: order.currency,
    totals,
  }
}

/**
 * Creates a COD order, or replays the original result when the same
 * `idempotencyKey` + unchanged intent is submitted again.
 *
 * @returns `{ replayed, body }` — the route sends 201 for a new order, 200 for a replay.
 */
export async function createCheckoutOrderService(
  db: DbClient,
  input: CheckoutCreateInput,
): Promise<{ replayed: boolean; body: CheckoutResult }> {
  const reqFp = await requestFingerprint(input)
  const phoneNormalized = normalizePhone(input.customer.phone)

  // --- Fast-path replay: a committed claim for this key means the order already
  // exists with its commercial terms locked in. Replay it WITHOUT re-checking
  // quote drift / COD availability — those only gate a genuinely new checkout.
  // (Only `completed` claims are ever visible to this non-transactional read;
  //  an in-flight peer's `in_progress` row is uncommitted, so we fall through to
  //  the transaction where `claimCheckout` blocks on the unique key.)
  const priorClaim = await getCheckoutClaim(db, input.idempotencyKey)
  if (
    priorClaim !== undefined &&
    priorClaim.status === 'completed' &&
    priorClaim.orderId !== null
  ) {
    if (priorClaim.requestFingerprint !== reqFp) throw new IdempotencyConflictError()
    const order = await getOrderById(db, priorClaim.orderId)
    if (order !== undefined) {
      const rows = await listOrderItems(db, order.id)
      return {
        replayed: true,
        body: resultFromOrder(
          order,
          rows.map((r) => ({
            sku: r.skuSnapshot,
            productNameAr: r.productNameArSnapshot,
            productNameEn: r.productNameEnSnapshot,
            quantity: r.quantity,
            unitPriceMinor: r.unitPriceMinor,
            lineTotalMinor: r.lineTotalMinor,
          })),
        ),
      }
    }
  }

  // --- New checkout: authoritative re-resolution + drift/eligibility checks.
  const truth = await resolveCommercialTruth(db, input.deliveryZoneId, input.lines)
  if (truth.lines.length === 0) throw new ValidationError('cart is empty')

  if (!(await isCodEnabled(db))) throw new PaymentMethodDisabledError('cod')

  const currentQuoteFp = await quoteFingerprint(truth)
  if (currentQuoteFp !== input.quoteFingerprint) {
    throw new CheckoutTotalsChangedError(await buildQuote(db, truth))
  }

  let outcome: { replayed: boolean; order: OrderRow; items: CheckoutResult['items'] }
  try {
    outcome = await withDeadlockRetry(() =>
      db.transaction(async (tx) => {
        await setLocalLockTimeout(tx, CLAIM_LOCK_TIMEOUT)

        // 1. Idempotency claim (non-error conflict path).
        const claim = await claimCheckout(tx, input.idempotencyKey, reqFp)
        if (claim === undefined) {
          // Key already exists — the concurrent owner has committed (our INSERT
          // waited for it). Load the committed claim and replay or conflict.
          const existing = await getCheckoutClaim(tx, input.idempotencyKey)
          if (existing === undefined || existing.orderId === null) {
            // Owner rolled back after our wait but before we could re-INSERT, or
            // is still finishing — safe to retry.
            throw new CheckoutProcessingError()
          }
          if (existing.requestFingerprint !== reqFp) {
            throw new IdempotencyConflictError()
          }
          const order = await getOrderById(tx, existing.orderId)
          if (order === undefined) throw new CheckoutProcessingError()
          const rows = await listOrderItems(tx, order.id)
          return {
            replayed: true,
            order,
            items: rows.map((r) => ({
              sku: r.skuSnapshot,
              productNameAr: r.productNameArSnapshot,
              productNameEn: r.productNameEnSnapshot,
              quantity: r.quantity,
              unitPriceMinor: r.unitPriceMinor,
              lineTotalMinor: r.lineTotalMinor,
            })),
          }
        }

        // 2. We own it. Re-resolve inside the transaction to close any TOCTOU gap.
        const txTruth = await resolveCommercialTruth(tx, input.deliveryZoneId, input.lines)
        if (!(await isCodEnabled(tx))) throw new PaymentMethodDisabledError('cod')
        if ((await quoteFingerprint(txTruth)) !== input.quoteFingerprint) {
          throw new CheckoutTotalsChangedError(await buildQuote(tx, txTruth))
        }

        // 3a. Resolve/create the internal CRM customer identity BEFORE the order
        // insert, so `customerId` is set at creation time — never a follow-up
        // UPDATE to an otherwise write-once order row. Unconditional (not
        // consent-gated): the order row records this phone regardless, and
        // `consentToStoreData` only governs whether we may CONTACT the
        // customer, not whether the business may keep an internal record that
        // a transaction happened. Skipped only when the phone doesn't have the
        // shape a real identity match key requires.
        const customer = isValidNormalizedPhone(phoneNormalized)
          ? await resolveCustomerByPhone(tx, {
              phoneNormalized,
              nameEn: input.customer.name,
              nameAr: input.customer.name,
              cityEn: input.customer.city ?? null,
              cityAr: input.customer.city ?? null,
              addressEn: input.customer.addressLine1,
              addressAr: input.customer.addressLine1,
              consentToStoreData: input.customer.consentToStoreData === true,
              consentToContact: false,
              seenAt: new Date(),
            })
          : undefined

        // 3b. Order header — permanent idempotency backstop + immutable snapshots.
        const order = await insertOrder(tx, {
          customerId: customer?.id,
          customerPhoneNormalized: phoneNormalized,
          customerNameEn: input.customer.name,
          customerNameAr: input.customer.name,
          deliveryZoneId: txTruth.zone.id,
          deliveryZoneCodeSnapshot: txTruth.zone.code,
          deliveryZoneNameArSnapshot: txTruth.zone.nameAr,
          deliveryZoneNameEnSnapshot: txTruth.zone.nameEn,
          cityEn: input.customer.city ?? null,
          cityAr: input.customer.city ?? null,
          addressLine1En: input.customer.addressLine1,
          addressLine1Ar: input.customer.addressLine1,
          addressLine2En: input.customer.addressLine2 ?? null,
          addressLine2Ar: input.customer.addressLine2 ?? null,
          deliveryFeeMinor: txTruth.deliveryFeeMinor,
          subtotalMinor: txTruth.subtotalMinor,
          taxMinor: 0,
          totalMinor: txTruth.totalMinor,
          currency: CURRENCY,
          customerNote: input.customer.note ?? null,
          status: 'processing',
          paymentMethod: 'cod',
          paymentStatus: 'unpaid',
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: reqFp,
        })

        // 4. Immutable item snapshots.
        await insertOrderItems(
          tx,
          order.id,
          txTruth.lines.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            skuSnapshot: l.sku,
            productNameEnSnapshot: l.productNameEn,
            productNameArSnapshot: l.productNameAr,
            variantLabelEnSnapshot: l.variantLabelEn,
            variantLabelArSnapshot: l.variantLabelAr,
            unitPriceMinor: l.unitPriceMinor,
            quantity: l.quantity,
            lineTotalMinor: l.lineTotalMinor,
            unitCostSnapshot: l.unitCostMinor,
            supplierIdSnapshot: l.supplierId,
            supplierNameEnSnapshot: l.supplierNameEn,
            supplierNameArSnapshot: l.supplierNameAr,
            categoryIdSnapshot: l.categoryId,
            categoryNameEnSnapshot: l.categoryNameEn,
            categoryNameArSnapshot: l.categoryNameAr,
          })),
        )

        // 5. Guarded stock deduction — ascending variant id (deadlock order).
        const byVariant = [...txTruth.lines].sort((a, b) =>
          a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
        )
        for (const l of byVariant) {
          const updated = await deductStock(tx, l.variantId, l.quantity)
          if (updated === undefined) {
            throw new InsufficientStockError({ variantId: l.variantId })
          }
          await insertMovement(tx, {
            variantId: l.variantId,
            movementType: 'ONLINE_ORDER',
            quantityChange: -l.quantity,
            quantityAfter: updated.quantityOnHand,
            orderId: order.id,
            reason: 'online order',
          })
        }

        // 7. Audit — safe metadata only (no PII).
        await recordAudit(
          tx,
          auditActor(undefined),
          'order.created',
          'order',
          order.id,
          auditMeta({
            number: order.number,
            totalMinor: order.totalMinor,
            lineCount: txTruth.lines.length,
            paymentMethod: 'cod',
          }),
        )

        const items: CheckoutResult['items'] = txTruth.lines.map((l) => ({
          sku: l.sku,
          productNameAr: l.productNameAr,
          productNameEn: l.productNameEn,
          quantity: l.quantity,
          unitPriceMinor: l.unitPriceMinor,
          lineTotalMinor: l.lineTotalMinor,
        }))

        // 8. Complete the claim with a safe committed replay payload.
        await completeCheckoutClaim(
          tx,
          input.idempotencyKey,
          order.id,
          JSON.stringify(resultFromOrder(order, items)),
        )

        return { replayed: false, order, items }
      }),
    )
  } catch (err) {
    if (isLockTimeout(err)) throw new CheckoutProcessingError()
    throw err
  }

  return { replayed: outcome.replayed, body: resultFromOrder(outcome.order, outcome.items) }
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function isLockTimeout(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '55P03'
  )
}
