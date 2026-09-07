/**
 * Gate B4 — provider-agnostic electronic payment foundation.
 *
 * `payments`           one row per logical payment attempt for an order. Amount,
 *                      currency and identity are immutable; `provider_payment_id`
 *                      is write-once (NULL → value). Status follows a monotonic
 *                      DB-guarded graph; at most one CHARGEABLE-OR-SUCCEEDED
 *                      attempt per order (partial unique index).
 * `payment_events`     the VERIFIED provider webhook / lookup ledger. Raw payload
 *                      is never stored — only a SHA-256 hash + safe normalized
 *                      fields. `received != processed`: `processed_at IS NULL`
 *                      means the business effect has not been conclusively
 *                      handled. `payment_id` is a nullable write-once link
 *                      (unmatched/early events are valid).
 * `stock_reservations` an ORDER-LEVEL physical stock hold for a pending
 *                      electronic order (one per order line). It is committed or
 *                      released only with authoritative provider evidence
 *                      (`authoritative_terminal_at`); `reconcile_after` is merely
 *                      the earliest local time to START reconciliation — never
 *                      release authority.
 *
 * No refund columns / states anywhere (store-support policy). Triggers that
 * enforce the transition graphs, write-once rules, insert-shape and
 * cross-entity relational checks live in the custom migration, not here.
 */
import { sql } from 'drizzle-orm'
import { check, index, pgTable, uniqueIndex } from 'drizzle-orm/pg-core'

import { paymentTransactionStatus, stockReservationState } from './enums'
import { orders } from './orders'
import { productVariants } from './product-options'

export const payments = pgTable(
  'payments',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    orderId: t
      .uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    /** Adapter key, e.g. `test` (dev only) or a real provider slug at B5. Immutable. */
    provider: t.text('provider').notNull(),
    /** Provider transaction id. NULL until provider initialization; then write-once. */
    providerPaymentId: t.text('provider_payment_id'),
    /** One logical attempt per key (UNIQUE). Immutable. */
    idempotencyKey: t.text('idempotency_key').notNull(),
    /** Must equal the parent order total at creation (DB guard). Immutable. */
    amountMinor: t.integer('amount_minor').notNull(),
    currency: t.varchar('currency', { length: 3 }).notNull(),
    status: paymentTransactionStatus('status').notNull().default('created'),
    /** Provider hosted-page URL, set after initialization. Never at insert. */
    redirectUrl: t.text('redirect_url'),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    uniqueIndex('payments_idempotency_key_uq').on(t.idempotencyKey),
    /** A provider transaction maps to exactly one attempt row. */
    uniqueIndex('payments_provider_ref_uq')
      .on(t.provider, t.providerPaymentId)
      .where(sql`${t.providerPaymentId} is not null`),
    /**
     * THE race guard: at most one chargeable-or-succeeded attempt per order. A
     * failed/expired attempt leaves the set → a retry may be created. Once an
     * attempt is `succeeded` it stays in the set → no later chargeable attempt
     * can ever be inserted.
     */
    uniqueIndex('payments_one_open_per_order_uq')
      .on(t.orderId)
      .where(sql`${t.status} in ('created', 'pending', 'succeeded')`),
    index('payments_order_idx').on(t.orderId),
    check('payments_amount_positive', sql`${t.amountMinor} > 0`),
    check('payments_provider_nonempty', sql`btrim(${t.provider}) <> ''`),
    check('payments_idem_nonempty', sql`btrim(${t.idempotencyKey}) <> ''`),
    check('payments_currency_format', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      'payments_provider_ref_nonempty',
      sql`${t.providerPaymentId} is null or btrim(${t.providerPaymentId}) <> ''`,
    ),
  ],
)

export const paymentEvents = pgTable(
  'payment_events',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    provider: t.text('provider').notNull(),
    /** Provider's event id — dedup key with `provider`. Immutable. */
    providerEventId: t.text('provider_event_id').notNull(),
    /** Safe provider payment reference for later matching (no raw body kept). */
    providerPaymentId: t.text('provider_payment_id'),
    /** Nullable write-once link. NULL = received-unmatched. */
    paymentId: t.uuid('payment_id').references(() => payments.id, { onDelete: 'restrict' }),
    /** Normalized event type (adapter maps raw → normalized). Immutable. */
    type: t.text('type').notNull(),
    /** SHA-256 hex of the raw payload as received (kept for conflict detection). */
    payloadHash: t.text('payload_hash').notNull(),
    /** Normalized safe fields for amount/currency comparison + investigation. */
    amountMinor: t.integer('amount_minor'),
    currency: t.varchar('currency', { length: 3 }),
    /**
     * Gate B4 Stage 4: the provider's normalized status from `parseWebhook`
     * (`pending|succeeded|failed|expired|unknown`), persisted at claim time so
     * the crash-safe Phase B business step — a SEPARATE transaction, possibly
     * resumed later by the scheduled sweep — never needs the original raw
     * request to know what to apply. Immutable (set once, at insert).
     */
    paymentStatus: t.text('payment_status').notNull(),
    receivedAt: t.timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    /** NULL ⇒ business effect NOT conclusively handled. Write-once. */
    processedAt: t.timestamp('processed_at', { withTimezone: true }),
    /**
     * Write-once processing result. Vocabulary: applied_success | applied_expiry
     * | ignored_out_of_order | mismatch | noop. Never rewritten by a duplicate
     * delivery. Set together with `processed_at`.
     */
    outcome: t.text('outcome'),
  }),
  (t) => [
    uniqueIndex('payment_events_provider_event_uq').on(t.provider, t.providerEventId),
    index('payment_events_payment_idx')
      .on(t.paymentId)
      .where(sql`${t.paymentId} is not null`),
    index('payment_events_provider_payment_idx')
      .on(t.provider, t.providerPaymentId)
      .where(sql`${t.providerPaymentId} is not null`),
    index('payment_events_unprocessed_idx')
      .on(t.receivedAt)
      .where(sql`${t.processedAt} is null`),
    check('payment_events_provider_nonempty', sql`btrim(${t.provider}) <> ''`),
    check('payment_events_event_id_nonempty', sql`btrim(${t.providerEventId}) <> ''`),
    check('payment_events_type_nonempty', sql`btrim(${t.type}) <> ''`),
    check('payment_events_payload_hash_sha256', sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'payment_events_payment_status_valid',
      sql`${t.paymentStatus} in ('pending','succeeded','failed','expired','unknown')`,
    ),
    check('payment_events_amount_nonneg', sql`${t.amountMinor} is null or ${t.amountMinor} >= 0`),
    check(
      'payment_events_currency_format',
      sql`${t.currency} is null or ${t.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      'payment_events_provider_ref_nonempty',
      sql`${t.providerPaymentId} is null or btrim(${t.providerPaymentId}) <> ''`,
    ),
  ],
)

export const stockReservations = pgTable(
  'stock_reservations',
  (t) => ({
    id: t.uuid('id').defaultRandom().primaryKey(),
    orderId: t
      .uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    variantId: t
      .uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    /** Immutable — must equal the immutable order line quantity (DB guard). */
    quantity: t.integer('quantity').notNull(),
    state: stockReservationState('state').notNull().default('held'),
    /**
     * Earliest local time reconciliation should BEGIN (held → reconciling). NOT
     * payment expiry. NOT release authority. A local timer never releases stock.
     */
    reconcileAfter: t.timestamp('reconcile_after', { withTimezone: true }).notNull(),
    reconcileAttempts: t.integer('reconcile_attempts').notNull().default(0),
    lastReconciledAt: t.timestamp('last_reconciled_at', { withTimezone: true }),
    /**
     * Write-once. The instant authoritative provider evidence proved this hold's
     * payment path is conclusively terminal — set ONLY as part of the same
     * update that moves state to `committed` or `released`.
     */
    authoritativeTerminalAt: t.timestamp('authoritative_terminal_at', { withTimezone: true }),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    uniqueIndex('stock_reservations_order_variant_uq').on(t.orderId, t.variantId),
    index('stock_reservations_order_idx').on(t.orderId),
    /** Reconciliation sweep candidates (Gate B4 scheduled worker). */
    index('stock_reservations_sweep_idx')
      .on(t.reconcileAfter)
      .where(sql`${t.state} in ('held', 'reconciling')`),
    check('stock_reservations_quantity_positive', sql`${t.quantity} > 0`),
    check('stock_reservations_reconcile_nonneg', sql`${t.reconcileAttempts} >= 0`),
  ],
)
