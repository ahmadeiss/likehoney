/**
 * Guest customer + online order wire contracts.
 *
 * V1 is guest checkout with Cash on Delivery: there is NO account, password or
 * session. The server is authoritative for every monetary value and for stock.
 * The browser submits line identities + quantities and structural delivery
 * information; the service resolves the real catalog prices and fees and
 * computes totals.
 *
 * An optional `customers` row is created ONLY when the customer consents to
 * data retention, keyed by their normalized phone (guest profile, not an
 * account).
 */
import { z } from 'zod'

import { paymentMethodSchema } from '../domain/payments'
import { publicCartLineSchema } from './public'

// ---------------------------------------------------------------------------
// Customer contact (guest)
// ---------------------------------------------------------------------------

export const guestCustomerSchema = z.object({
  name: z.string().trim().min(1).max(300),
  /** Raw phone; the server normalizes via the shared phone helper. */
  phone: z.string().trim().min(6).max(30),
  city: z.string().trim().min(1).max(200).optional(),
  addressLine1: z.string().trim().min(1).max(500),
  addressLine2: z.string().trim().max(500).optional(),
  note: z.string().trim().max(1000).optional(),
  /** Optional consent to retain data keyed by phone (guest profile). */
  consentToStoreData: z.boolean().default(false),
})

// ---------------------------------------------------------------------------
// Checkout (order creation)
// ---------------------------------------------------------------------------

/**
 * Gate B4 Stage 4: `cod` | `electronic`. Electronic is accepted by the schema
 * whenever the wire contract is loaded, but the service layer still requires
 * ACTUAL current availability (`paymentMethods.electronic === true` from the
 * quote, not merely the saved preference) before it will create one.
 */
export const checkoutPaymentMethodSchema = paymentMethodSchema

export const checkoutCreateSchema = z.object({
  /**
   * Client-generated random key for ONE logical checkout submission. The client
   * must generate a NEW key whenever the cart, quantities, zone, payment method,
   * or contact/address/note change. Re-sending the same key with an unchanged
   * intent replays the original order; with a changed intent → 409
   * `idempotency_conflict`.
   */
  idempotencyKey: z.string().trim().min(16).max(200),
  /** `quoteFingerprint` from the most recent /cart/verify the customer confirmed. */
  quoteFingerprint: z.string().trim().min(16).max(200),
  paymentMethod: checkoutPaymentMethodSchema,
  /** Delivery zone id; the server resolves the authoritative fee. */
  deliveryZoneId: z.uuid(),
  customer: guestCustomerSchema,
  lines: z.array(publicCartLineSchema).min(1).max(100),
})

export const orderByNumberParamSchema = z.object({
  number: z
    .string()
    .trim()
    .regex(/^LH-\d{6}$/, 'expected an order number in the form LH-000001'),
})

export type GuestCustomerInput = z.infer<typeof guestCustomerSchema>
export type CheckoutCreateInput = z.infer<typeof checkoutCreateSchema>
