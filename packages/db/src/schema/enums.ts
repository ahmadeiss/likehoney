/**
 * Shared PostgreSQL enum types.
 *
 * Enum value arrays MUST stay inline in this file: `drizzle-kit generate`
 * resolves enum definitions at codegen time and cannot analyze imported
 * arrays. The database is the semantic source of truth for these values;
 * individual domain files import the enum objects returned by `pgEnum`.
 *
 * Naming convention: `*_enum` at the SQL level is reserved; the enum type
 * names below follow snake_case (no `_enum` suffix).
 *
 * Values are stable, machine-readable and language-neutral (English ASCII).
 * Human-readable AR/EN labels for these values live OUTSIDE the database in
 * `packages/shared/src/domain/localization.ts` — the UI resolves values to
 * labels there and never renders raw enum values.
 */
import { pgEnum } from 'drizzle-orm/pg-core'

export const productStatus = pgEnum('product_status', ['draft', 'active', 'inactive', 'archived'])

export const variantStatus = pgEnum('variant_status', ['draft', 'active', 'inactive'])

export const inventoryMovementType = pgEnum('inventory_movement_type', [
  'INITIAL_STOCK',
  'RESTOCK',
  'ONLINE_ORDER',
  'ORDER_CANCELLATION_RESTORE',
  'RETURN',
  'DAMAGE',
  'MANUAL_ADJUSTMENT',
  'STORE_SALE',
])

export const orderStatus = pgEnum('order_status', [
  'processing',
  'delivering',
  'completed',
  'cancelled',
])

export const paymentMethod = pgEnum('payment_method', ['cod', 'electronic'])

export const paymentStatus = pgEnum('payment_status', ['unpaid', 'paid', 'pending', 'expired'])

/**
 * Internal, provider-agnostic electronic payment-attempt lifecycle (Gate B4).
 * Raw provider status strings are NEVER stored in this type — the adapter
 * normalizes them; provider detail lives in `payment_events` / audit only.
 * Legal transitions (DB-guarded): created → {pending,succeeded,failed,expired};
 * pending → {succeeded,failed,expired}. succeeded/failed/expired are terminal.
 */
export const paymentTransactionStatus = pgEnum('payment_transaction_status', [
  'created',
  'pending',
  'succeeded',
  'failed',
  'expired',
])

/**
 * Order-level commercial stock hold backing a pending electronic order (Gate
 * B4). Legal transitions (DB-guarded): held → {reconciling,committed,released};
 * reconciling → {committed,released}. committed/released are terminal. A hold
 * may only reach a terminal state with authoritative provider evidence
 * (`authoritative_terminal_at`) — a local timer never releases stock.
 */
export const stockReservationState = pgEnum('stock_reservation_state', [
  'held',
  'reconciling',
  'committed',
  'released',
])

export const mediaType = pgEnum('media_type', ['image', 'video'])

export const contentStatus = pgEnum('content_status', ['draft', 'published', 'archived'])

export const entityStatus = pgEnum('entity_status', ['active', 'inactive'])

/**
 * Storefront display mode for a category tile. `auto` prefers image → icon →
 * automatic code fallback; `image` shows the image when present; `icon` shows
 * the icon even when an image is stored (the image may remain intact).
 */
export const categoryVisualMode = pgEnum('category_visual_mode', ['auto', 'image', 'icon'])

/**
 * Store / shopping-experience review moderation lifecycle (Reviews Gate).
 * A public submission is ALWAYS created `pending`; only an Admin with
 * `reviews:moderate` moves it to `approved` (the sole status the public
 * endpoint reads) or `rejected`. Legal transitions are enforced in the
 * service layer with status-guarded conditional updates: pending → approved,
 * pending → rejected, and the two deliberate corrections approved ↔ rejected.
 */
export const reviewStatus = pgEnum('review_status', ['pending', 'approved', 'rejected'])

/**
 * Stable marker for the kind of completed commercial evidence that backed a
 * `verified_purchase = true` review at submission time. Never an internal
 * transaction id; never recomputed from mutable catalog data afterwards.
 */
export const reviewVerifiedSource = pgEnum('review_verified_source', ['online_order', 'store_sale'])
