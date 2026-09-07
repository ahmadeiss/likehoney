/**
 * Gate B4 Stage 4 — electronic checkout engine (§12/§16-§29).
 *
 * Phase A (ONE DB transaction, no provider network call): idempotency claim →
 * quote/availability re-check → immutable order + snapshots → payment attempt
 * (`created`) → stock reservation (`held`) → audit → claim completed.
 *
 * Phase B (AFTER Phase A commits, no DB transaction held): `provider.
 * createPayment(...)` using the persisted attempt identity, then a SECOND,
 * short transaction applies whatever the provider said (pending / synchronous
 * success / definitive failure / indeterminate) through the same canonical
 * services every other success/failure source uses.
 *
 * Only the request that WON Phase A (created the order) executes Phase B —
 * every other caller (concurrent replay, or a later request against an
 * existing order) is state-aware: it loads current truth and never calls
 * `createPayment` again for that order.
 */
import {
  CheckoutProcessingError,
  CheckoutTotalsChangedError,
  IdempotencyConflictError,
  InsufficientStockError,
  PaymentMethodDisabledError,
  ValidationError,
  hasConfirmedFinancials,
  isValidNormalizedPhone,
  normalizePhone,
  type CheckoutCreateInput,
  type ProviderCreatePaymentResult,
} from '@likehoney/shared'
import {
  claimCheckout,
  completeCheckoutClaim,
  createAttempt,
  getAttemptById,
  getChargeableOrSucceededAttemptForOrder,
  getCheckoutClaim,
  getOrderById,
  getOrderForUpdate,
  getSucceededAttemptForOrder,
  insertOrder,
  insertOrderItems,
  reserveOrderStockTx,
  resolveCustomerByPhone,
  setLocalLockTimeout,
  setProviderIdentityAndRedirect,
  setProviderPaymentId,
  transitionAttempt,
  withDeadlockRetry,
  type DbClient,
  type OrderRow,
  type PaymentAttemptRow,
} from '@likehoney/db'

import {
  CLAIM_LOCK_TIMEOUT,
  CURRENCY,
  quoteFingerprint,
  requestFingerprint,
  resolveCommercialTruth,
} from '../orders'
import { auditActor, auditMeta, recordAudit, type AuditActor } from '../audit'
import { applyAttemptTerminalService } from './attempt-terminal'
import { buildMerchantReference, deriveProviderIdempotencyKey } from './identifiers'
import { resolveConfiguredProvider } from './registry'
import type { Env } from '../../env'
import { getElectronicPaymentReadiness } from './readiness'
import { getPaymentSettingsService } from './settings'
import { applyPaymentSuccessService } from './success'

const RESERVATION_ORDINAL = 1 // checkout-time attempt is always the order's first

export interface ElectronicCheckoutResponse {
  orderId: string
  number: string
  status: OrderRow['status']
  paymentMethod: 'electronic'
  paymentStatus: OrderRow['paymentStatus']
  /** One of: pending | paid | reconciliation_pending | attempt_failed | attempt_expired. */
  state: 'pending' | 'paid' | 'reconciliation_pending' | 'attempt_failed' | 'attempt_expired'
  redirectUrl?: string
  totalMinor: number
  currency: string
}

function toResponse(
  order: OrderRow,
  attempt: PaymentAttemptRow | undefined,
): ElectronicCheckoutResponse {
  let state: ElectronicCheckoutResponse['state']
  if (order.paymentStatus === 'paid') state = 'paid'
  else if (attempt === undefined) state = 'reconciliation_pending'
  else if (attempt.status === 'failed') state = 'attempt_failed'
  else if (attempt.status === 'expired') state = 'attempt_expired'
  else if (attempt.status === 'pending') state = 'pending'
  else state = 'reconciliation_pending' // created / unresolved

  return {
    orderId: order.id,
    number: order.number,
    status: order.status,
    paymentMethod: 'electronic',
    paymentStatus: order.paymentStatus,
    state,
    redirectUrl: attempt?.redirectUrl ?? undefined,
    totalMinor: order.totalMinor,
    currency: order.currency,
  }
}

/** §24 state-aware replay: load CURRENT truth, never a frozen JSON blob. */
async function buildReplayResponse(
  db: DbClient,
  orderId: string,
): Promise<ElectronicCheckoutResponse> {
  const order = await getOrderById(db, orderId)
  if (order === undefined) throw new ValidationError('order not found on replay', { orderId })
  const attempt =
    (await getSucceededAttemptForOrder(db, orderId)) ??
    (await getChargeableOrSucceededAttemptForOrder(db, orderId))
  return toResponse(order, attempt)
}

// ---------------------------------------------------------------------------
// Phase A
// ---------------------------------------------------------------------------

interface PhaseAOwned {
  replayed: false
  order: OrderRow
  attempt: PaymentAttemptRow
  merchantReference: string
  provider: string
}
interface PhaseAReplayed {
  replayed: true
  orderId: string
}

async function runPhaseA(
  db: DbClient,
  env: Env,
  input: CheckoutCreateInput,
  actor: AuditActor,
): Promise<PhaseAOwned | PhaseAReplayed> {
  const reqFp = await requestFingerprint(input)
  const phoneNormalized = normalizePhone(input.customer.phone)

  const priorClaim = await getCheckoutClaim(db, input.idempotencyKey)
  if (
    priorClaim !== undefined &&
    priorClaim.status === 'completed' &&
    priorClaim.orderId !== null
  ) {
    if (priorClaim.requestFingerprint !== reqFp) throw new IdempotencyConflictError()
    return { replayed: true, orderId: priorClaim.orderId }
  }

  const truth = await resolveCommercialTruth(db, input.deliveryZoneId, input.lines)
  if ((await quoteFingerprint(truth)) !== input.quoteFingerprint) {
    throw new CheckoutTotalsChangedError({ lines: truth.lines, totalMinor: truth.totalMinor })
  }

  const settings = await getPaymentSettingsService(db)
  const readiness = getElectronicPaymentReadiness(env, settings.electronicEnabled)
  if (!readiness.availableForCheckout) {
    throw new PaymentMethodDisabledError('electronic')
  }

  const providerCode = env.PAYMENT_PROVIDER?.trim()
  if (providerCode === undefined || providerCode.length === 0) {
    // readiness already checked this, but never proceed without a code.
    throw new PaymentMethodDisabledError('electronic')
  }

  const providerIdemKey = await deriveProviderIdempotencyKey(
    input.idempotencyKey,
    RESERVATION_ORDINAL,
  )
  const reconcileAfter = new Date(Date.now() + settings.reservationReconcileAfterMinutes * 60_000)

  const result = await withDeadlockRetry(() =>
    db.transaction(async (tx) => {
      await setLocalLockTimeout(tx, CLAIM_LOCK_TIMEOUT)

      const claim = await claimCheckout(tx, input.idempotencyKey, reqFp)
      if (claim === undefined) {
        const existing = await getCheckoutClaim(tx, input.idempotencyKey)
        if (existing === undefined || existing.orderId === null) {
          throw new CheckoutProcessingError()
        }
        if (existing.requestFingerprint !== reqFp) throw new IdempotencyConflictError()
        return { replayed: true as const, orderId: existing.orderId }
      }

      // Re-resolve inside the transaction to close the TOCTOU gap.
      const txTruth = await resolveCommercialTruth(tx, input.deliveryZoneId, input.lines)
      if ((await quoteFingerprint(txTruth)) !== input.quoteFingerprint) {
        throw new CheckoutTotalsChangedError({
          lines: txTruth.lines,
          totalMinor: txTruth.totalMinor,
        })
      }
      const txSettings = await getPaymentSettingsService(tx)
      const txReadiness = getElectronicPaymentReadiness(env, txSettings.electronicEnabled)
      if (!txReadiness.availableForCheckout) throw new PaymentMethodDisabledError('electronic')

      // Resolve/create the internal CRM customer identity BEFORE the order
      // insert (same reasoning as the COD flow in `../orders.ts`): unconditional
      // on a validly-shaped phone, never consent-gated, so `customerId` lands
      // at creation time rather than a follow-up UPDATE.
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
        paymentMethod: 'electronic',
        paymentStatus: 'pending',
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: reqFp,
      })

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

      const attempt = await createAttempt(tx, {
        orderId: order.id,
        provider: providerCode,
        idempotencyKey: providerIdemKey,
        amountMinor: order.totalMinor,
        currency: order.currency,
      })

      const reserveResult = await reserveOrderStockTx(
        tx,
        order.id,
        txTruth.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        reconcileAfter,
      )
      if ('insufficient' in reserveResult) {
        throw new InsufficientStockError({ variantId: reserveResult.variantId })
      }

      await recordAudit(
        tx,
        actor,
        'payment.attempt_created',
        'order',
        order.id,
        auditMeta({ number: order.number, provider: providerCode, amountMinor: order.totalMinor }),
      )

      await completeCheckoutClaim(
        tx,
        input.idempotencyKey,
        order.id,
        JSON.stringify({ paymentMethod: 'electronic' }),
      )

      return {
        replayed: false as const,
        order,
        attempt,
        merchantReference: buildMerchantReference(order.number, RESERVATION_ORDINAL),
        provider: providerCode,
      }
    }),
  )

  return result
}

// ---------------------------------------------------------------------------
// Phase B — provider init AFTER Phase A commits, no DB transaction held
// ---------------------------------------------------------------------------

export async function runPhaseB(
  db: DbClient,
  env: Env,
  order: OrderRow,
  attempt: PaymentAttemptRow,
  merchantReference: string,
  actor: AuditActor,
  /** §29: retry reuses the order's first-attempt provider lineage, resolved
   *  via `resolveProviderByCode`, never the currently-configured provider. */
  resolveProvider: (
    env: Env,
  ) => ReturnType<typeof resolveConfiguredProvider> = resolveConfiguredProvider,
): Promise<ElectronicCheckoutResponse> {
  const { provider } = resolveProvider(env)
  if (provider === null) {
    // Provider became unresolvable between Phase A and Phase B (settings/env
    // raced). The attempt stays `created`, unresolved — reconciliation will
    // pick it up once a provider is configured again. Never invent truth.
    return toResponse(order, attempt)
  }

  let result: ProviderCreatePaymentResult
  try {
    result = await provider.createPayment({
      attemptId: attempt.id,
      orderId: order.id,
      merchantReference,
      idempotencyKey: attempt.idempotencyKey,
      amountMinor: attempt.amountMinor,
      currency: attempt.currency,
    })
  } catch {
    // Network throw with unknown outcome — indeterminate, never failed.
    return toResponse(order, attempt)
  }

  if (result.outcome === 'indeterminate') {
    if (result.providerPaymentId) {
      await setProviderPaymentId(db, attempt.id, result.providerPaymentId).catch(() => undefined)
    }
    const fresh = await getAttemptById(db, attempt.id)
    return toResponse(order, fresh ?? attempt)
  }

  if (result.outcome === 'definitive_failure') {
    await applyAttemptTerminalService(db, {
      orderId: order.id,
      paymentAttemptId: attempt.id,
      provider: provider.code,
      status: result.status,
      providerPaymentId: result.providerPaymentId,
      actor,
    })
    const fresh = await getAttemptById(db, attempt.id)
    return toResponse(order, fresh ?? attempt)
  }

  // outcome === 'created'
  if (result.status === 'succeeded') {
    if (!hasConfirmedFinancials(result)) {
      // §2: no provider-confirmed financials — do NOT mark paid from this
      // response alone. Leave the attempt unresolved; reconciliation's
      // authoritative lookup (outside any DB tx) is the only path to success.
      return toResponse(order, attempt)
    }
    await applyPaymentSuccessService(db, {
      orderId: order.id,
      paymentAttemptId: attempt.id,
      provider: provider.code,
      confirmed: {
        providerPaymentId: result.providerPaymentId,
        amountMinor: result.amountMinor,
        currency: result.currency,
      },
      authoritativeAt: new Date(),
      actor,
    })
    const freshOrder = await getOrderById(db, order.id)
    const freshAttempt = await getAttemptById(db, attempt.id)
    return toResponse(freshOrder ?? order, freshAttempt ?? attempt)
  }

  // pending: persist providerPaymentId + redirectUrl (write-once) and advance
  // the attempt created -> pending, all under the order lock.
  await withDeadlockRetry(() =>
    db.transaction(async (tx) => {
      await getOrderForUpdate(tx, order.id) // hold the order lock first (U2)
      const current = await getAttemptById(tx, attempt.id)
      if (current === undefined || current.status !== 'created') return
      if (current.providerPaymentId === null) {
        await setProviderIdentityAndRedirect(
          tx,
          attempt.id,
          result.providerPaymentId,
          result.redirectUrl ?? '',
        )
      }
      await transitionAttempt(tx, attempt.id, ['created'], 'pending')
      await recordAudit(
        tx,
        actor,
        'payment.provider_initialized',
        'order',
        order.id,
        auditMeta({ number: order.number, provider: provider.code }),
      )
    }),
  )
  const fresh = await getAttemptById(db, attempt.id)
  return toResponse(order, fresh ?? attempt)
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function createElectronicCheckoutService(
  db: DbClient,
  env: Env,
  input: CheckoutCreateInput,
  actorStaffId?: string,
): Promise<{ replayed: boolean; body: ElectronicCheckoutResponse }> {
  const actor = auditActor(actorStaffId)
  const phaseA = await runPhaseA(db, env, input, actor)

  if (phaseA.replayed) {
    return { replayed: true, body: await buildReplayResponse(db, phaseA.orderId) }
  }

  // Only the request that WON Phase A calls Phase B (§17) — a concurrent
  // replay request never reaches here; it takes the `replayed` branch above.
  const body = await runPhaseB(
    db,
    env,
    phaseA.order,
    phaseA.attempt,
    phaseA.merchantReference,
    actor,
  )
  return { replayed: false, body }
}

export {
  buildReplayResponse as buildElectronicReplayResponse,
  toResponse as toElectronicCheckoutResponse,
}
