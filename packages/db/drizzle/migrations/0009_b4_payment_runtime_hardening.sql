-- Gate B4 Stage 4 — entry-hardening audit fixes (0008 gaps confirmed, not
-- speculative): two durable facts the DB did not yet enforce.
--
--   A. payments.redirect_url — was fully mutable. It is provider-init state:
--      write-once (NULL -> value), idempotent re-set of the SAME value is
--      allowed (a retried provider-init call may legitimately re-observe the
--      same redirect URL), but value -> a DIFFERENT value and value -> NULL
--      are both rejected.
--
--   B. stock_reservations.reconcile_after — was fully mutable. It is the
--      reservation's snapshotted reconciliation-trigger time, fixed at
--      creation from `payments:reservation.reconcile_after_minutes` at that
--      moment. A later change to the store setting must never rewrite an
--      already-held reservation's timer. Added to the existing immutable-
--      column check alongside order_id/variant_id/quantity/created_at.
--
-- CREATE OR REPLACE on the existing trigger functions only — no new trigger
-- objects, no table rewrite. Every other check in each function is copied
-- verbatim from 0008 (byte-identical) except the two additions below.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.lh_payments_transition_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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

  -- Gate B4 Stage 4 (0009, fix A): redirect_url is provider-init state —
  -- write-once. NULL -> value: allowed. value -> SAME value: allowed
  -- (idempotent re-observe). value -> a DIFFERENT value, or value -> NULL:
  -- rejected.
  IF OLD.redirect_url IS NOT NULL
     AND NEW.redirect_url IS DISTINCT FROM OLD.redirect_url THEN
    RAISE EXCEPTION 'payments: redirect_url is write-once' USING ERRCODE = 'LH003';
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
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.lh_reservations_transition_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE o RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock_reservations rows must not be deleted' USING ERRCODE = 'LH003';
  END IF;

  -- Gate B4 Stage 4 (0009, fix B): reconcile_after joins the immutable-column
  -- set — it is snapshotted once at reservation creation and must never be
  -- rewritten by a later change to the global reconciliation-delay setting.
  IF OLD.order_id         IS DISTINCT FROM NEW.order_id
  OR OLD.variant_id       IS DISTINCT FROM NEW.variant_id
  OR OLD.quantity         IS DISTINCT FROM NEW.quantity
  OR OLD.reconcile_after  IS DISTINCT FROM NEW.reconcile_after
  OR OLD.created_at       IS DISTINCT FROM NEW.created_at THEN
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
      -- The strengthened order-expiry guard already forbids any
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
$function$;
