-- Gate B4 (payment foundation) — DB-level integrity for payments, payment
-- events, stock reservations and the extended order lifecycle. Defence-in-depth
-- ONLY; the approved service layer is authoritative.
--
-- Custom SQLSTATEs:
--   LH001 = commercial-history immutability (0003/0005; extended here for
--           orders.cancellation_source write-once)
--   LH002 = order lifecycle integrity (0006; extended here for electronic)
--   LH003 = payment / payment_event / stock_reservation integrity (new)
--
-- 0000-0007 are applied and frozen. 0005's lh_orders_immutability_guard and
-- 0006's lh_orders_lifecycle_guard function bodies are swapped via CREATE OR
-- REPLACE (the 0005 / 0006 FILES are untouched). Every prior COD branch is
-- preserved; the only COD change is requiring cancellation_source='staff' on a
-- COD -> cancelled transition (Stage-4 updates the COD cancel service to write
-- it before this migration reaches persistent Neon).
--
-- LOCK-ORDER RULE (documented, enforced by the services): the Stage-4 service
-- acquires and holds the parent orders row lock (SELECT ... FOR UPDATE) BEFORE
-- updating any payments / stock_reservations / inventory_balances row. Global
-- order: orders -> payments -> stock_reservations -> inventory_balances
-- (variants ascending). Guards on CREATE paths (payments/stock_reservations
-- BEFORE INSERT) take the parent order lock themselves (true order-first
-- creation). Guards on UPDATE paths use a PLAIN read only — they are relational
-- defence-in-depth, never the lock coordinator.
--
-- PAYMENT-SUCCESS TRANSACTION ORDER (Stage-4; provider evidence verified first):
--   1. SELECT order FOR UPDATE
--   2. assert order = electronic / processing / pending
--   3. UPDATE payment attempt: created|pending -> succeeded
--   4. UPDATE order: payment_status pending -> paid   (guard sees succeeded row)
--   5. UPDATE reservations: held|reconciling -> committed, authoritative_terminal_at = now()
--   6. UPDATE inventory_balances per variant, variant_id ASC:
--        quantity_on_hand -= qty ; quantity_reserved -= qty
--   7. INSERT inventory_movements ONLINE_ORDER (-qty) per line
--   8. INSERT audit payment.succeeded
--   9. UPDATE payment_events: processed_at = now(), outcome = 'applied_success'
--  COMMIT

-- =========================================================================
-- (1) payments
-- =========================================================================
CREATE OR REPLACE FUNCTION lh_payments_insert_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE o RECORD;
BEGIN
  IF NEW.status <> 'created' THEN
    RAISE EXCEPTION 'payments: a new attempt must be inserted as created (got %)', NEW.status
      USING ERRCODE = 'LH003';
  END IF;
  IF NEW.provider_payment_id IS NOT NULL OR NEW.redirect_url IS NOT NULL THEN
    RAISE EXCEPTION 'payments: a created attempt must have NULL provider_payment_id and redirect_url'
      USING ERRCODE = 'LH003';
  END IF;

  SELECT payment_method, status, payment_status, total_minor, currency
    INTO o FROM orders WHERE id = NEW.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payments: order % does not exist', NEW.order_id USING ERRCODE = 'LH003';
  END IF;
  IF NOT (o.payment_method = 'electronic' AND o.status = 'processing' AND o.payment_status = 'pending') THEN
    RAISE EXCEPTION 'payments: order % is not an open electronic order (method=%, status=%, payment_status=%)',
      NEW.order_id, o.payment_method, o.status, o.payment_status USING ERRCODE = 'LH003';
  END IF;
  IF NEW.amount_minor <> o.total_minor OR NEW.currency <> o.currency THEN
    RAISE EXCEPTION 'payments: attempt amount/currency (%/%) must match order (%/%)',
      NEW.amount_minor, NEW.currency, o.total_minor, o.currency USING ERRCODE = 'LH003';
  END IF;
  IF EXISTS (SELECT 1 FROM payments p WHERE p.order_id = NEW.order_id AND p.status = 'succeeded') THEN
    RAISE EXCEPTION 'payments: order % already has a succeeded attempt', NEW.order_id USING ERRCODE = 'LH003';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER payments_insert_guard
  BEFORE INSERT ON "payments" FOR EACH ROW EXECUTE FUNCTION lh_payments_insert_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION lh_payments_transition_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE o RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments rows must not be deleted (financial history)' USING ERRCODE = 'LH003';
  END IF;

  IF OLD.order_id        IS DISTINCT FROM NEW.order_id
  OR OLD.provider        IS DISTINCT FROM NEW.provider
  OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
  OR OLD.amount_minor    IS DISTINCT FROM NEW.amount_minor
  OR OLD.currency        IS DISTINCT FROM NEW.currency
  OR OLD.created_at      IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'payments: attempt to modify an immutable column' USING ERRCODE = 'LH003';
  END IF;

  IF OLD.provider_payment_id IS NOT NULL
     AND NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id THEN
    RAISE EXCEPTION 'payments: provider_payment_id is write-once' USING ERRCODE = 'LH003';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('succeeded','failed','expired') THEN
      RAISE EXCEPTION 'payments: % is terminal, cannot become %', OLD.status, NEW.status USING ERRCODE = 'LH003';
    END IF;
    IF NOT (
         (OLD.status = 'created' AND NEW.status IN ('pending','succeeded','failed','expired'))
      OR (OLD.status = 'pending' AND NEW.status IN ('succeeded','failed','expired'))
    ) THEN
      RAISE EXCEPTION 'payments: illegal attempt transition % -> %', OLD.status, NEW.status USING ERRCODE = 'LH003';
    END IF;

    -- A transition out of a non-terminal attempt is only valid while the parent
    -- order is still an open electronic order. PLAIN SELECT (relational
    -- defence-in-depth; the Stage-4 service holds the order lock first).
    IF OLD.status IN ('created','pending') THEN
      SELECT payment_method, status, payment_status INTO o FROM orders WHERE id = OLD.order_id;
      IF NOT (o.payment_method = 'electronic' AND o.status = 'processing' AND o.payment_status = 'pending') THEN
        RAISE EXCEPTION 'payments: attempt % -> % requires parent order electronic/processing/pending (got %/%/%)',
          OLD.status, NEW.status, o.payment_method, o.status, o.payment_status USING ERRCODE = 'LH003';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER payments_transition_guard
  BEFORE UPDATE ON "payments" FOR EACH ROW EXECUTE FUNCTION lh_payments_transition_guard();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER payments_no_delete
  BEFORE DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION lh_payments_transition_guard();
--> statement-breakpoint

-- =========================================================================
-- (2) payment_events
-- =========================================================================
CREATE OR REPLACE FUNCTION lh_payment_events_insert_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_id IS NOT NULL OR NEW.processed_at IS NOT NULL OR NEW.outcome IS NOT NULL THEN
    RAISE EXCEPTION 'payment_events: an event is born unmatched and unprocessed' USING ERRCODE = 'LH003';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER payment_events_insert_guard
  BEFORE INSERT ON "payment_events" FOR EACH ROW EXECUTE FUNCTION lh_payment_events_insert_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION lh_payment_events_immutability_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE p RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment_events rows must not be deleted' USING ERRCODE = 'LH003';
  END IF;

  IF OLD.provider            IS DISTINCT FROM NEW.provider
  OR OLD.provider_event_id    IS DISTINCT FROM NEW.provider_event_id
  OR OLD.provider_payment_id  IS DISTINCT FROM NEW.provider_payment_id
  OR OLD.type                 IS DISTINCT FROM NEW.type
  OR OLD.payload_hash         IS DISTINCT FROM NEW.payload_hash
  OR OLD.amount_minor         IS DISTINCT FROM NEW.amount_minor
  OR OLD.currency             IS DISTINCT FROM NEW.currency
  OR OLD.received_at          IS DISTINCT FROM NEW.received_at THEN
    RAISE EXCEPTION 'payment_events: attempt to modify an immutable column' USING ERRCODE = 'LH003';
  END IF;

  IF OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id THEN
    RAISE EXCEPTION 'payment_events: payment_id is write-once' USING ERRCODE = 'LH003';
  END IF;
  IF OLD.processed_at IS NOT NULL AND NEW.processed_at IS DISTINCT FROM OLD.processed_at THEN
    RAISE EXCEPTION 'payment_events: processed_at is write-once' USING ERRCODE = 'LH003';
  END IF;
  IF OLD.outcome IS NOT NULL AND NEW.outcome IS DISTINCT FROM OLD.outcome THEN
    RAISE EXCEPTION 'payment_events: outcome is write-once (a duplicate delivery never rewrites it)'
      USING ERRCODE = 'LH003';
  END IF;
  IF (NEW.processed_at IS NULL) <> (NEW.outcome IS NULL) THEN
    RAISE EXCEPTION 'payment_events: processed_at and outcome must be set together' USING ERRCODE = 'LH003';
  END IF;

  -- A finalized event is never (re)linked to a payment.
  IF OLD.processed_at IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id THEN
    RAISE EXCEPTION 'payment_events: cannot change payment_id of a processed event' USING ERRCODE = 'LH003';
  END IF;

  -- First-time link: validate RELATIONAL IDENTITY only (provider + provider
  -- payment id). Amount/currency reconciliation is a SEPARATE invariant handled
  -- by the business-apply pipeline and finalized as outcome='mismatch'. Plain
  -- SELECT (payment identity columns are immutable / write-once).
  IF OLD.payment_id IS NULL AND NEW.payment_id IS NOT NULL THEN
    SELECT provider, provider_payment_id INTO p FROM payments WHERE id = NEW.payment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payment_events: referenced payment % does not exist', NEW.payment_id USING ERRCODE = 'LH003';
    END IF;
    IF p.provider IS DISTINCT FROM NEW.provider THEN
      RAISE EXCEPTION 'payment_events: provider mismatch on link (event=%, payment=%)', NEW.provider, p.provider
        USING ERRCODE = 'LH003';
    END IF;
    IF NEW.provider_payment_id IS NULL
       OR p.provider_payment_id IS NULL
       OR p.provider_payment_id <> NEW.provider_payment_id THEN
      RAISE EXCEPTION 'payment_events: provider_payment_id identity mismatch on link' USING ERRCODE = 'LH003';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER payment_events_immutability_guard
  BEFORE UPDATE ON "payment_events" FOR EACH ROW EXECUTE FUNCTION lh_payment_events_immutability_guard();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER payment_events_no_delete
  BEFORE DELETE ON "payment_events" FOR EACH ROW EXECUTE FUNCTION lh_payment_events_immutability_guard();
--> statement-breakpoint

-- =========================================================================
-- (3) stock_reservations
-- =========================================================================
CREATE OR REPLACE FUNCTION lh_reservations_insert_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE o RECORD; li_qty integer;
BEGIN
  IF NEW.state <> 'held'
  OR NEW.authoritative_terminal_at IS NOT NULL
  OR NEW.reconcile_attempts <> 0
  OR NEW.last_reconciled_at IS NOT NULL
  OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'stock_reservations: a reservation is born held / non-terminal' USING ERRCODE = 'LH003';
  END IF;

  SELECT payment_method, status, payment_status INTO o FROM orders WHERE id = NEW.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock_reservations: order % does not exist', NEW.order_id USING ERRCODE = 'LH003';
  END IF;
  IF NOT (o.payment_method = 'electronic' AND o.status = 'processing' AND o.payment_status = 'pending') THEN
    RAISE EXCEPTION 'stock_reservations: order % is not an open electronic order', NEW.order_id USING ERRCODE = 'LH003';
  END IF;

  SELECT quantity INTO li_qty FROM order_items
    WHERE order_id = NEW.order_id AND variant_id = NEW.variant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock_reservations: no order line for (order=%, variant=%)', NEW.order_id, NEW.variant_id
      USING ERRCODE = 'LH003';
  END IF;
  IF li_qty <> NEW.quantity THEN
    RAISE EXCEPTION 'stock_reservations: quantity % must equal the order line quantity %', NEW.quantity, li_qty
      USING ERRCODE = 'LH003';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER reservations_insert_guard
  BEFORE INSERT ON "stock_reservations" FOR EACH ROW EXECUTE FUNCTION lh_reservations_insert_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION lh_reservations_transition_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE o RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock_reservations rows must not be deleted' USING ERRCODE = 'LH003';
  END IF;

  IF OLD.order_id   IS DISTINCT FROM NEW.order_id
  OR OLD.variant_id IS DISTINCT FROM NEW.variant_id
  OR OLD.quantity   IS DISTINCT FROM NEW.quantity
  OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'stock_reservations: attempt to modify an immutable column' USING ERRCODE = 'LH003';
  END IF;

  IF NEW.reconcile_attempts < OLD.reconcile_attempts THEN
    RAISE EXCEPTION 'stock_reservations: reconcile_attempts must not decrease' USING ERRCODE = 'LH003';
  END IF;
  IF OLD.last_reconciled_at IS NOT NULL AND NEW.last_reconciled_at IS NOT NULL
     AND NEW.last_reconciled_at < OLD.last_reconciled_at THEN
    RAISE EXCEPTION 'stock_reservations: last_reconciled_at must not move backward' USING ERRCODE = 'LH003';
  END IF;

  -- authoritative_terminal_at: write-once, and may only appear (NULL -> value)
  -- as part of the same update that moves state to committed/released.
  IF OLD.authoritative_terminal_at IS NOT NULL
     AND NEW.authoritative_terminal_at IS DISTINCT FROM OLD.authoritative_terminal_at THEN
    RAISE EXCEPTION 'stock_reservations: authoritative_terminal_at is write-once' USING ERRCODE = 'LH003';
  END IF;
  IF OLD.authoritative_terminal_at IS NULL AND NEW.authoritative_terminal_at IS NOT NULL
     AND NEW.state NOT IN ('committed','released') THEN
    RAISE EXCEPTION 'stock_reservations: authoritative_terminal_at may only be set on a terminal transition'
      USING ERRCODE = 'LH003';
  END IF;

  -- row-shape on EVERY update
  IF NEW.state IN ('held','reconciling') AND NEW.authoritative_terminal_at IS NOT NULL THEN
    RAISE EXCEPTION 'stock_reservations: a held/reconciling hold must have NULL authoritative_terminal_at'
      USING ERRCODE = 'LH003';
  END IF;
  IF NEW.state IN ('committed','released') AND NEW.authoritative_terminal_at IS NULL THEN
    RAISE EXCEPTION 'stock_reservations: a % hold requires authoritative_terminal_at (a local timer is not authority)', NEW.state
      USING ERRCODE = 'LH003';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF OLD.state IN ('committed','released') THEN
      RAISE EXCEPTION 'stock_reservations: % is terminal, cannot become %', OLD.state, NEW.state USING ERRCODE = 'LH003';
    END IF;
    IF NOT (
         (OLD.state = 'held'        AND NEW.state IN ('reconciling','committed','released'))
      OR (OLD.state = 'reconciling' AND NEW.state IN ('committed','released'))
    ) THEN
      RAISE EXCEPTION 'stock_reservations: illegal state transition % -> %', OLD.state, NEW.state USING ERRCODE = 'LH003';
    END IF;

    -- terminal transitions must match internal order truth. PLAIN SELECT (no
    -- FOR UPDATE): the UPDATE path already contends on this reservation row and
    -- the Stage-4 service holds the parent order lock first (U2).
    SELECT payment_method, status, payment_status, cancellation_source, total_minor, currency
      INTO o FROM orders WHERE id = NEW.order_id;

    IF NEW.state = 'committed' THEN
      IF NOT (o.payment_method = 'electronic' AND o.payment_status = 'paid' AND o.status = 'processing') THEN
        RAISE EXCEPTION 'stock_reservations: commit requires order electronic/paid/processing' USING ERRCODE = 'LH003';
      END IF;
      -- derived successful-payment truth (committed_by_payment_id was
      -- deliberately dropped; payments_one_open_per_order_uq guarantees <= 1).
      IF NOT EXISTS (
        SELECT 1 FROM payments p
        WHERE p.order_id = NEW.order_id AND p.status = 'succeeded'
          AND p.amount_minor = o.total_minor AND p.currency = o.currency
      ) THEN
        RAISE EXCEPTION 'stock_reservations: commit requires a matching succeeded payment' USING ERRCODE = 'LH003';
      END IF;
    ELSIF NEW.state = 'released' THEN
      -- The strengthened order-expiry guard (below) already forbids any
      -- created/pending/succeeded payment at expiry time; here we only assert
      -- the resulting order shape.
      IF NOT (o.payment_method = 'electronic' AND o.payment_status = 'expired'
              AND o.status = 'cancelled' AND o.cancellation_source = 'system_payment_expiry') THEN
        RAISE EXCEPTION 'stock_reservations: release requires order electronic/expired/cancelled/system_payment_expiry'
          USING ERRCODE = 'LH003';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER reservations_transition_guard
  BEFORE UPDATE ON "stock_reservations" FOR EACH ROW EXECUTE FUNCTION lh_reservations_transition_guard();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER reservations_no_delete
  BEFORE DELETE ON "stock_reservations" FOR EACH ROW EXECUTE FUNCTION lh_reservations_transition_guard();
--> statement-breakpoint

-- =========================================================================
-- (4) orders BEFORE INSERT row-shape guard (first insert-time guard on orders).
-- =========================================================================
CREATE OR REPLACE FUNCTION lh_orders_insert_shape_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (
       (NEW.status = 'processing' AND NEW.payment_method = 'cod'        AND NEW.payment_status = 'unpaid')
    OR (NEW.status = 'processing' AND NEW.payment_method = 'electronic' AND NEW.payment_status = 'pending')
  ) THEN
    RAISE EXCEPTION 'orders: illegal new-order shape (status=%, method=%, payment_status=%)',
      NEW.status, NEW.payment_method, NEW.payment_status USING ERRCODE = 'LH002';
  END IF;
  IF NEW.delivering_at IS NOT NULL OR NEW.completed_at IS NOT NULL
  OR NEW.cancelled_at IS NOT NULL OR NEW.cancelled_by_staff_id IS NOT NULL
  OR NEW.cancelled_reason IS NOT NULL OR NEW.inventory_restored_on_cancel IS NOT NULL
  OR NEW.cancellation_source IS NOT NULL THEN
    RAISE EXCEPTION 'orders: a new order must not carry lifecycle-transition facts' USING ERRCODE = 'LH002';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER orders_insert_shape_guard
  BEFORE INSERT ON "orders" FOR EACH ROW EXECUTE FUNCTION lh_orders_insert_shape_guard();
--> statement-breakpoint

-- =========================================================================
-- (5) orders immutability guard v3 — 0005 body verbatim + cancellation_source
--     write-once. Triggers orders_immutability_update/delete already exist.
-- =========================================================================
CREATE OR REPLACE FUNCTION lh_orders_immutability_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'orders rows must not be hard-deleted (commercial history)' USING ERRCODE = 'LH001';
  END IF;

  IF OLD.sequence                       IS DISTINCT FROM NEW.sequence
  OR OLD.customer_phone_normalized      IS DISTINCT FROM NEW.customer_phone_normalized
  OR OLD.customer_name_en               IS DISTINCT FROM NEW.customer_name_en
  OR OLD.customer_name_ar               IS DISTINCT FROM NEW.customer_name_ar
  OR OLD.delivery_zone_code_snapshot    IS DISTINCT FROM NEW.delivery_zone_code_snapshot
  OR OLD.delivery_zone_name_ar_snapshot IS DISTINCT FROM NEW.delivery_zone_name_ar_snapshot
  OR OLD.delivery_zone_name_en_snapshot IS DISTINCT FROM NEW.delivery_zone_name_en_snapshot
  OR OLD.city_en                        IS DISTINCT FROM NEW.city_en
  OR OLD.city_ar                        IS DISTINCT FROM NEW.city_ar
  OR OLD.address_line1_en               IS DISTINCT FROM NEW.address_line1_en
  OR OLD.address_line1_ar               IS DISTINCT FROM NEW.address_line1_ar
  OR OLD.address_line2_en               IS DISTINCT FROM NEW.address_line2_en
  OR OLD.address_line2_ar               IS DISTINCT FROM NEW.address_line2_ar
  OR OLD.delivery_fee_minor             IS DISTINCT FROM NEW.delivery_fee_minor
  OR OLD.subtotal_minor                 IS DISTINCT FROM NEW.subtotal_minor
  OR OLD.tax_minor                      IS DISTINCT FROM NEW.tax_minor
  OR OLD.total_minor                    IS DISTINCT FROM NEW.total_minor
  OR OLD.currency                       IS DISTINCT FROM NEW.currency
  OR OLD.payment_method                 IS DISTINCT FROM NEW.payment_method
  OR OLD.customer_note                  IS DISTINCT FROM NEW.customer_note
  OR OLD.idempotency_key                IS DISTINCT FROM NEW.idempotency_key
  OR OLD.request_fingerprint            IS DISTINCT FROM NEW.request_fingerprint
  OR OLD.created_at                     IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'orders: attempt to modify an immutable commercial field' USING ERRCODE = 'LH001';
  END IF;

  IF (OLD.delivering_at IS NOT NULL AND NEW.delivering_at IS DISTINCT FROM OLD.delivering_at)
  OR (OLD.completed_at  IS NOT NULL AND NEW.completed_at  IS DISTINCT FROM OLD.completed_at)
  OR (OLD.cancelled_at  IS NOT NULL AND NEW.cancelled_at  IS DISTINCT FROM OLD.cancelled_at)
  OR (OLD.cancelled_by_staff_id IS NOT NULL AND NEW.cancelled_by_staff_id IS DISTINCT FROM OLD.cancelled_by_staff_id)
  OR (OLD.cancelled_reason IS NOT NULL AND NEW.cancelled_reason IS DISTINCT FROM OLD.cancelled_reason)
  OR (OLD.inventory_restored_on_cancel IS NOT NULL AND NEW.inventory_restored_on_cancel IS DISTINCT FROM OLD.inventory_restored_on_cancel)
  OR (OLD.cancellation_source IS NOT NULL AND NEW.cancellation_source IS DISTINCT FROM OLD.cancellation_source) THEN
    RAISE EXCEPTION 'orders: a fulfillment / cancellation transition fact is write-once' USING ERRCODE = 'LH001';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- =========================================================================
-- (6) orders lifecycle guard v2 — COD verbatim (inside payment_method='cod',
--     + cancellation_source='staff' on ->cancelled); electronic branches new.
-- =========================================================================
CREATE OR REPLACE FUNCTION lh_orders_lifecycle_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- (A) status transitions ------------------------------------------------
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.payment_method = 'cod' THEN
      IF OLD.status = 'processing' AND NEW.status = 'delivering' THEN
        IF NOT ( OLD.delivering_at IS NULL AND NEW.delivering_at IS NOT NULL
             AND NEW.completed_at IS NULL AND NEW.cancelled_at IS NULL
             AND OLD.payment_status = 'unpaid' AND NEW.payment_status = 'unpaid'
             AND NEW.inventory_restored_on_cancel IS NULL ) THEN
          RAISE EXCEPTION 'orders: illegal COD processing -> delivering row shape' USING ERRCODE = 'LH002';
        END IF;
      ELSIF OLD.status = 'delivering' AND NEW.status = 'completed' THEN
        IF NOT ( OLD.payment_status = 'unpaid' AND NEW.payment_status = 'paid'
             AND OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL
             AND NEW.cancelled_at IS NULL AND NEW.delivering_at IS NOT NULL
             AND NEW.inventory_restored_on_cancel IS NULL ) THEN
          RAISE EXCEPTION 'orders: illegal COD delivering -> completed row shape' USING ERRCODE = 'LH002';
        END IF;
      ELSIF OLD.status = 'processing' AND NEW.status = 'cancelled' THEN
        IF NOT ( NEW.cancelled_at IS NOT NULL AND NEW.cancellation_source = 'staff'
             AND NEW.cancelled_by_staff_id IS NOT NULL
             AND NEW.cancelled_reason IS NOT NULL AND btrim(NEW.cancelled_reason) <> ''
             AND NEW.inventory_restored_on_cancel = true
             AND OLD.payment_status = 'unpaid' AND NEW.payment_status = 'unpaid'
             AND NEW.completed_at IS NULL ) THEN
          RAISE EXCEPTION 'orders: illegal COD processing -> cancelled row shape' USING ERRCODE = 'LH002';
        END IF;
      ELSIF OLD.status = 'delivering' AND NEW.status = 'cancelled' THEN
        IF NOT ( NEW.cancelled_at IS NOT NULL AND NEW.cancellation_source = 'staff'
             AND NEW.cancelled_by_staff_id IS NOT NULL
             AND NEW.cancelled_reason IS NOT NULL AND btrim(NEW.cancelled_reason) <> ''
             AND NEW.inventory_restored_on_cancel IS NOT NULL
             AND OLD.payment_status = 'unpaid' AND NEW.payment_status = 'unpaid'
             AND NEW.completed_at IS NULL AND NEW.delivering_at IS NOT NULL ) THEN
          RAISE EXCEPTION 'orders: illegal COD delivering -> cancelled row shape' USING ERRCODE = 'LH002';
        END IF;
      ELSE
        RAISE EXCEPTION 'orders: illegal COD status transition % -> %', OLD.status, NEW.status USING ERRCODE = 'LH002';
      END IF;

    ELSIF OLD.payment_method = 'electronic' THEN
      IF OLD.status = 'processing' AND NEW.status = 'delivering' THEN
        IF NOT ( OLD.payment_status = 'paid' AND NEW.payment_status = 'paid'
             AND OLD.delivering_at IS NULL AND NEW.delivering_at IS NOT NULL
             AND NEW.completed_at IS NULL AND NEW.cancelled_at IS NULL
             AND NEW.inventory_restored_on_cancel IS NULL ) THEN
          RAISE EXCEPTION 'orders: illegal electronic processing -> delivering (requires paid)' USING ERRCODE = 'LH002';
        END IF;
      ELSIF OLD.status = 'delivering' AND NEW.status = 'completed' THEN
        IF NOT ( OLD.payment_status = 'paid' AND NEW.payment_status = 'paid'
             AND OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL
             AND NEW.cancelled_at IS NULL AND NEW.delivering_at IS NOT NULL
             AND NEW.inventory_restored_on_cancel IS NULL ) THEN
          RAISE EXCEPTION 'orders: illegal electronic delivering -> completed (payment stays paid)' USING ERRCODE = 'LH002';
        END IF;
      ELSIF OLD.status = 'processing' AND NEW.status = 'cancelled' THEN
        IF NOT ( OLD.payment_status = 'pending' AND NEW.payment_status = 'expired'
             AND NEW.cancelled_at IS NOT NULL
             AND NEW.cancellation_source = 'system_payment_expiry'
             AND NEW.cancelled_by_staff_id IS NULL AND NEW.cancelled_reason IS NULL
             AND NEW.inventory_restored_on_cancel IS NULL
             AND NEW.completed_at IS NULL AND NEW.delivering_at IS NULL ) THEN
          RAISE EXCEPTION 'orders: illegal electronic processing -> cancelled (only system_payment_expiry)' USING ERRCODE = 'LH002';
        END IF;
        -- global expiry may not coexist with an open/succeeded attempt, and at
        -- least one attempt must have existed.
        IF EXISTS (SELECT 1 FROM payments p
                   WHERE p.order_id = NEW.id AND p.status IN ('created','pending','succeeded')) THEN
          RAISE EXCEPTION 'orders: cannot expire an electronic order with an open or succeeded payment attempt'
            USING ERRCODE = 'LH002';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = NEW.id) THEN
          RAISE EXCEPTION 'orders: cannot expire an electronic order that never had a payment attempt'
            USING ERRCODE = 'LH002';
        END IF;
      ELSE
        RAISE EXCEPTION 'orders: illegal electronic status transition % -> %', OLD.status, NEW.status USING ERRCODE = 'LH002';
      END IF;
    END IF;
  END IF;

  -- (B) payment_status transitions -------------------------------------------
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF OLD.payment_method = 'cod' THEN
      IF NOT ( OLD.payment_status = 'unpaid' AND NEW.payment_status = 'paid'
           AND OLD.status = 'delivering' AND NEW.status = 'completed' ) THEN
        RAISE EXCEPTION 'orders: illegal COD payment_status transition % -> % (status % -> %)',
          OLD.payment_status, NEW.payment_status, OLD.status, NEW.status USING ERRCODE = 'LH002';
      END IF;
    ELSIF OLD.payment_method = 'electronic' THEN
      IF (OLD.payment_status = 'pending' AND NEW.payment_status = 'paid'
          AND OLD.status = 'processing' AND NEW.status = 'processing') THEN
        -- an electronic order may only become paid when backed by a matching
        -- succeeded payment attempt (partial unique index -> exactly one).
        IF NOT EXISTS (
          SELECT 1 FROM payments p
          WHERE p.order_id = NEW.id AND p.status = 'succeeded'
            AND p.amount_minor = NEW.total_minor AND p.currency = NEW.currency
        ) THEN
          RAISE EXCEPTION 'orders: electronic order cannot become paid without a matching succeeded payment'
            USING ERRCODE = 'LH002';
        END IF;
      ELSIF (OLD.payment_status = 'pending' AND NEW.payment_status = 'expired'
             AND OLD.status = 'processing' AND NEW.status = 'cancelled') THEN
        NULL;  -- authoritative payment expiry (shape + no-open-attempt checked in (A))
      ELSE
        RAISE EXCEPTION 'orders: illegal electronic payment_status transition % -> % (status % -> %)',
          OLD.payment_status, NEW.payment_status, OLD.status, NEW.status USING ERRCODE = 'LH002';
      END IF;
    END IF;
  END IF;

  -- (C) resulting row-shape for the FINAL status ---------------------------
  IF NEW.payment_method = 'cod' THEN
    IF NEW.status = 'processing' THEN
      IF NEW.completed_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancellation_source IS NOT NULL THEN
        RAISE EXCEPTION 'orders: a processing order must have NULL completed_at/cancelled_at/cancellation_source' USING ERRCODE = 'LH002';
      END IF;
    ELSIF NEW.status = 'delivering' THEN
      IF NEW.delivering_at IS NULL OR NEW.completed_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancellation_source IS NOT NULL THEN
        RAISE EXCEPTION 'orders: a delivering order must have delivering_at set and NULL completed_at/cancelled_at/cancellation_source' USING ERRCODE = 'LH002';
      END IF;
    ELSIF NEW.status = 'completed' THEN
      IF NEW.delivering_at IS NULL OR NEW.completed_at IS NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancellation_source IS NOT NULL THEN
        RAISE EXCEPTION 'orders: a completed order must have delivering_at + completed_at set and NULL cancelled_at/cancellation_source' USING ERRCODE = 'LH002';
      END IF;
    ELSIF NEW.status = 'cancelled' THEN
      IF NEW.cancelled_at IS NULL OR NEW.cancellation_source IS DISTINCT FROM 'staff'
         OR NEW.cancelled_by_staff_id IS NULL
         OR NEW.cancelled_reason IS NULL OR btrim(NEW.cancelled_reason) = ''
         OR NEW.inventory_restored_on_cancel IS NULL THEN
        RAISE EXCEPTION 'orders: a cancelled COD order needs cancellation_source=staff, actor, reason, restock decision' USING ERRCODE = 'LH002';
      END IF;
    END IF;
  ELSIF NEW.payment_method = 'electronic' THEN
    IF NEW.status = 'processing' THEN
      IF NEW.payment_status NOT IN ('pending','paid')
         OR NEW.completed_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL
         OR NEW.delivering_at IS NOT NULL OR NEW.cancellation_source IS NOT NULL THEN
        RAISE EXCEPTION 'orders: electronic processing must be pending|paid with NULL transition facts' USING ERRCODE = 'LH002';
      END IF;
    ELSIF NEW.status = 'delivering' THEN
      IF NEW.payment_status <> 'paid' OR NEW.delivering_at IS NULL
         OR NEW.completed_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancellation_source IS NOT NULL THEN
        RAISE EXCEPTION 'orders: electronic delivering must be paid with delivering_at set' USING ERRCODE = 'LH002';
      END IF;
    ELSIF NEW.status = 'completed' THEN
      IF NEW.payment_status <> 'paid' OR NEW.delivering_at IS NULL
         OR NEW.completed_at IS NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancellation_source IS NOT NULL THEN
        RAISE EXCEPTION 'orders: electronic completed must be paid with delivering_at + completed_at' USING ERRCODE = 'LH002';
      END IF;
    ELSIF NEW.status = 'cancelled' THEN
      IF NEW.payment_status <> 'expired' OR NEW.cancelled_at IS NULL
         OR NEW.cancellation_source IS DISTINCT FROM 'system_payment_expiry'
         OR NEW.cancelled_by_staff_id IS NOT NULL OR NEW.cancelled_reason IS NOT NULL
         OR NEW.inventory_restored_on_cancel IS NOT NULL
         OR NEW.delivering_at IS NOT NULL OR NEW.completed_at IS NOT NULL THEN
        RAISE EXCEPTION 'orders: electronic cancelled must be a system_payment_expiry (expired, no staff/restore facts)' USING ERRCODE = 'LH002';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
-- triggers orders_immutability_update / orders_immutability_delete /
-- orders_lifecycle_guard already exist (0003/0005/0006); only their function
-- bodies are swapped in above. No CREATE TRIGGER needed for them.
