-- Gate B4 Stage 4 final hardening — confirmed gap, not speculative:
-- `payment_events.payment_status` (added in 0010, after this trigger function
-- was last defined) was NOT in the immutable-column set. A row received as
-- `succeeded` could be silently rewritten to `pending`/`failed`/`expired`/
-- `unknown` after receipt. `payment_status` is the normalized VERIFIED-event
-- fact captured at receipt time — it must be as immutable as `amount_minor`/
-- `currency`/`type`. CREATE OR REPLACE on the existing trigger function only —
-- no new trigger object, no table rewrite. Every other check copied verbatim
-- from 0008/0009 except the one addition below.
CREATE OR REPLACE FUNCTION public.lh_payment_events_immutability_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE p RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment_events rows must not be deleted' USING ERRCODE = 'LH003';
  END IF;

  IF OLD.provider            IS DISTINCT FROM NEW.provider
  OR OLD.provider_event_id    IS DISTINCT FROM NEW.provider_event_id
  OR OLD.provider_payment_id  IS DISTINCT FROM NEW.provider_payment_id
  OR OLD.type                 IS DISTINCT FROM NEW.type
  OR OLD.payment_status        IS DISTINCT FROM NEW.payment_status
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
$function$;
