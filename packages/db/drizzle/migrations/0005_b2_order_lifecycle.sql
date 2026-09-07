-- Gate B2: order fulfillment lifecycle.
--
-- (a) Extend the orders immutability guard so the new transition-fact columns
--     are WRITE-ONCE (NULL -> value once; value -> different value is rejected;
--     value -> same value is an allowed no-op). status / payment_status /
--     updated_at / vendor_note stay intentionally operational.
-- (b) Seed the orders:read / orders:write / orders:cancel permissions and their
--     default role grants (idempotent).
--
-- Migration 0003 is applied and frozen; this ships the guard change forward.

CREATE OR REPLACE FUNCTION lh_orders_immutability_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'orders rows must not be hard-deleted (commercial history)'
      USING ERRCODE = 'LH001';
  END IF;

  -- Immutable commercial / identity columns (unchanged from 0003).
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
  OR OLD.created_at                     IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'orders: attempt to modify an immutable commercial field'
      USING ERRCODE = 'LH001';
  END IF;

  -- Write-once fulfillment transition facts: only NULL -> value is allowed.
  IF (OLD.delivering_at IS NOT NULL
        AND NEW.delivering_at IS DISTINCT FROM OLD.delivering_at)
  OR (OLD.completed_at IS NOT NULL
        AND NEW.completed_at IS DISTINCT FROM OLD.completed_at)
  OR (OLD.cancelled_at IS NOT NULL
        AND NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at)
  OR (OLD.cancelled_by_staff_id IS NOT NULL
        AND NEW.cancelled_by_staff_id IS DISTINCT FROM OLD.cancelled_by_staff_id)
  OR (OLD.cancelled_reason IS NOT NULL
        AND NEW.cancelled_reason IS DISTINCT FROM OLD.cancelled_reason)
  OR (OLD.inventory_restored_on_cancel IS NOT NULL
        AND NEW.inventory_restored_on_cancel IS DISTINCT FROM OLD.inventory_restored_on_cancel)
  THEN
    RAISE EXCEPTION 'orders: a fulfillment transition fact is write-once'
      USING ERRCODE = 'LH001';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- --- Permissions -----------------------------------------------------------

INSERT INTO permissions (code, name_ar, name_en) VALUES
  ('orders:read',   'عرض الطلبات',            'Orders read'),
  ('orders:write',  'إدارة تنفيذ الطلبات',     'Orders fulfillment'),
  ('orders:cancel', 'إلغاء الطلبات',          'Orders cancel')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- Owner-tier roles: all three.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.code IN ('admin', 'catalog-admin')
  AND p.code IN ('orders:read', 'orders:write', 'orders:cancel')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Employee role: read + fulfillment, NOT cancel.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.code = 'inventory-viewer'
  AND p.code IN ('orders:read', 'orders:write')
ON CONFLICT DO NOTHING;
