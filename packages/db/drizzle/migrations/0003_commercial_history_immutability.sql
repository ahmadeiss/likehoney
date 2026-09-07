-- Custom migration: database-level defence-in-depth for immutable commercial
-- history. Application code already never mutates these rows; these triggers
-- guarantee it even against a future regression or a stray manual statement.
--
-- Custom SQLSTATE 'LH001' (user-defined class 'LH') marks an immutability
-- violation so it is distinguishable in logs. These triggers must never fire
-- in normal operation.

-- ---------------------------------------------------------------------------
-- order_items / store_sale_items: insert-once. No UPDATE. No DELETE.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lh_reject_line_item_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable commercial history (attempted %)',
    TG_TABLE_NAME, TG_OP USING ERRCODE = 'LH001';
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE TRIGGER order_items_immutable_update
  BEFORE UPDATE ON "order_items"
  FOR EACH ROW EXECUTE FUNCTION lh_reject_line_item_mutation();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER order_items_immutable_delete
  BEFORE DELETE ON "order_items"
  FOR EACH ROW EXECUTE FUNCTION lh_reject_line_item_mutation();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER store_sale_items_immutable_update
  BEFORE UPDATE ON "store_sale_items"
  FOR EACH ROW EXECUTE FUNCTION lh_reject_line_item_mutation();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER store_sale_items_immutable_delete
  BEFORE DELETE ON "store_sale_items"
  FOR EACH ROW EXECUTE FUNCTION lh_reject_line_item_mutation();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- orders: no DELETE; no UPDATE of any immutable transaction-time field.
-- Operationally mutable: customer_id, delivery_zone_id, status, payment_status,
-- vendor_note, cancelled_reason, cancelled_at, updated_at.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lh_orders_immutability_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'orders rows must not be hard-deleted (commercial history)'
      USING ERRCODE = 'LH001';
  END IF;

  -- `number` is a STORED generated column (LH-000001 from `sequence`); it is
  -- NULL in NEW during a BEFORE trigger, so guard `sequence` instead — it fully
  -- determines `number` and is equally immutable.
  IF OLD.sequence                       IS DISTINCT FROM NEW.sequence
  OR OLD.customer_phone_normalized      IS DISTINCT FROM NEW.customer_phone_normalized
  OR OLD.customer_name_en              IS DISTINCT FROM NEW.customer_name_en
  OR OLD.customer_name_ar              IS DISTINCT FROM NEW.customer_name_ar
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
  OR OLD.created_at                     IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'orders: attempt to modify an immutable commercial field'
      USING ERRCODE = 'LH001';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE TRIGGER orders_immutability_update
  BEFORE UPDATE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION lh_orders_immutability_guard();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER orders_immutability_delete
  BEFORE DELETE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION lh_orders_immutability_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- store_sales: no DELETE; no UPDATE of immutable commercial / identity fields.
-- Operationally mutable: note, customer_id.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lh_store_sales_immutability_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'store_sales rows must not be hard-deleted (commercial history)'
      USING ERRCODE = 'LH001';
  END IF;

  -- `number` is a STORED generated column (NULL in NEW during a BEFORE trigger);
  -- `sequence` fully determines it and is equally immutable.
  IF OLD.sequence                  IS DISTINCT FROM NEW.sequence
  OR OLD.staff_id                  IS DISTINCT FROM NEW.staff_id
  OR OLD.customer_phone_normalized IS DISTINCT FROM NEW.customer_phone_normalized
  OR OLD.order_id                  IS DISTINCT FROM NEW.order_id
  OR OLD.subtotal_minor            IS DISTINCT FROM NEW.subtotal_minor
  OR OLD.total_minor               IS DISTINCT FROM NEW.total_minor
  OR OLD.currency                  IS DISTINCT FROM NEW.currency
  OR OLD.created_at                IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'store_sales: attempt to modify an immutable commercial field'
      USING ERRCODE = 'LH001';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE TRIGGER store_sales_immutability_update
  BEFORE UPDATE ON "store_sales"
  FOR EACH ROW EXECUTE FUNCTION lh_store_sales_immutability_guard();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER store_sales_immutability_delete
  BEFORE DELETE ON "store_sales"
  FOR EACH ROW EXECUTE FUNCTION lh_store_sales_immutability_guard();
