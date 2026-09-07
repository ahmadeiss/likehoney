-- Gate B2 (integrity): database-level enforcement of the online-order state
-- machine. Defence-in-depth ONLY — the approved API is the admin-orders command
-- layer. This rejects any future repository/service bug (or stray manual SQL)
-- that would produce an illegal transition or an inconsistent order row.
--
-- Custom SQLSTATE 'LH002' = order lifecycle-integrity violation ('LH001' remains
-- the immutability violation from 0003/0005). Both are the LH integrity class.
--
-- V1 is Cash on Delivery only. Gate B4 will `CREATE OR REPLACE` this function in
-- a NEW migration to add electronic-payment branches — the structure below
-- (payment_method-gated blocks) is built to be extended, not rewritten.
--
-- 0000-0005 are applied and frozen; this ships forward.

CREATE OR REPLACE FUNCTION lh_orders_lifecycle_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- (A) status transitions: legal edges + the exact row shape each requires.
  IF NEW.status IS DISTINCT FROM OLD.status THEN

    IF OLD.status = 'processing' AND NEW.status = 'delivering' THEN
      IF NOT ( OLD.delivering_at IS NULL
           AND NEW.delivering_at IS NOT NULL
           AND NEW.completed_at IS NULL
           AND NEW.cancelled_at IS NULL
           AND NEW.payment_method = 'cod'
           AND OLD.payment_status = 'unpaid'
           AND NEW.payment_status = 'unpaid'
           AND NEW.inventory_restored_on_cancel IS NULL ) THEN
        RAISE EXCEPTION 'orders: illegal processing -> delivering row shape' USING ERRCODE = 'LH002';
      END IF;

    ELSIF OLD.status = 'delivering' AND NEW.status = 'completed' THEN
      -- COD: completion is the ONLY moment payment becomes paid.
      IF NOT ( OLD.payment_method = 'cod'
           AND OLD.payment_status = 'unpaid'
           AND NEW.payment_status = 'paid'
           AND OLD.completed_at IS NULL
           AND NEW.completed_at IS NOT NULL
           AND NEW.cancelled_at IS NULL
           AND NEW.delivering_at IS NOT NULL
           AND NEW.inventory_restored_on_cancel IS NULL ) THEN
        RAISE EXCEPTION 'orders: illegal delivering -> completed row shape (COD must become paid, completed_at set)'
          USING ERRCODE = 'LH002';
      END IF;

    ELSIF OLD.status = 'processing' AND NEW.status = 'cancelled' THEN
      -- Goods never left the store: cancellation restores committed stock.
      IF NOT ( NEW.cancelled_at IS NOT NULL
           AND NEW.cancelled_by_staff_id IS NOT NULL
           AND NEW.cancelled_reason IS NOT NULL
           AND btrim(NEW.cancelled_reason) <> ''
           AND NEW.inventory_restored_on_cancel = true
           AND OLD.payment_status = 'unpaid'
           AND NEW.payment_status = 'unpaid'
           AND NEW.completed_at IS NULL ) THEN
        RAISE EXCEPTION 'orders: illegal processing -> cancelled row shape (must restore inventory, stay unpaid, carry actor + reason)'
          USING ERRCODE = 'LH002';
      END IF;

    ELSIF OLD.status = 'delivering' AND NEW.status = 'cancelled' THEN
      -- Physical return is uncertain: inventory_restored_on_cancel is the
      -- explicit operator decision (true OR false), but must be present.
      IF NOT ( NEW.cancelled_at IS NOT NULL
           AND NEW.cancelled_by_staff_id IS NOT NULL
           AND NEW.cancelled_reason IS NOT NULL
           AND btrim(NEW.cancelled_reason) <> ''
           AND NEW.inventory_restored_on_cancel IS NOT NULL
           AND OLD.payment_status = 'unpaid'
           AND NEW.payment_status = 'unpaid'
           AND NEW.completed_at IS NULL
           AND NEW.delivering_at IS NOT NULL ) THEN
        RAISE EXCEPTION 'orders: illegal delivering -> cancelled row shape (needs explicit restock decision, stay unpaid, carry actor + reason)'
          USING ERRCODE = 'LH002';
      END IF;

    ELSE
      RAISE EXCEPTION 'orders: illegal status transition % -> %', OLD.status, NEW.status
        USING ERRCODE = 'LH002';
    END IF;
  END IF;

  -- (B) COD payment_status transitions (checked even without a status change).
  -- The only legal COD change is unpaid -> paid, and ONLY as part of
  -- delivering -> completed. No paid -> unpaid. No paid while processing/delivering.
  IF NEW.payment_method = 'cod' AND NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF NOT ( OLD.payment_status = 'unpaid'
         AND NEW.payment_status = 'paid'
         AND OLD.status = 'delivering'
         AND NEW.status = 'completed' ) THEN
      RAISE EXCEPTION 'orders: illegal COD payment_status transition % -> % (status % -> %)',
        OLD.payment_status, NEW.payment_status, OLD.status, NEW.status
        USING ERRCODE = 'LH002';
    END IF;
  END IF;

  -- (C) resulting row-shape consistency for the FINAL status (holds for any
  -- update, e.g. a vendor_note edit must not leave an inconsistent row).
  IF NEW.status = 'processing' THEN
    IF NEW.completed_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'orders: a processing order must have NULL completed_at and cancelled_at'
        USING ERRCODE = 'LH002';
    END IF;
  ELSIF NEW.status = 'delivering' THEN
    IF NEW.delivering_at IS NULL OR NEW.completed_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'orders: a delivering order must have delivering_at set and NULL completed_at/cancelled_at'
        USING ERRCODE = 'LH002';
    END IF;
  ELSIF NEW.status = 'completed' THEN
    IF NEW.delivering_at IS NULL OR NEW.completed_at IS NULL OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'orders: a completed order must have delivering_at + completed_at set and NULL cancelled_at'
        USING ERRCODE = 'LH002';
    END IF;
  ELSIF NEW.status = 'cancelled' THEN
    IF NEW.cancelled_at IS NULL OR NEW.inventory_restored_on_cancel IS NULL THEN
      RAISE EXCEPTION 'orders: a cancelled order must have cancelled_at and inventory_restored_on_cancel set'
        USING ERRCODE = 'LH002';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE TRIGGER orders_lifecycle_guard
  BEFORE UPDATE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION lh_orders_lifecycle_guard();
