CREATE TABLE "checkout_claims" (
	"claim_key" text PRIMARY KEY NOT NULL,
	"request_fingerprint" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"order_id" uuid,
	"result_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_claims_status_valid" CHECK ("checkout_claims"."status" in ('in_progress', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "unit_cost_snapshot" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_zone_code_snapshot" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_zone_name_ar_snapshot" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_zone_name_en_snapshot" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "request_fingerprint" text;--> statement-breakpoint
ALTER TABLE "store_sale_items" ADD COLUMN "unit_cost_snapshot" integer;--> statement-breakpoint
ALTER TABLE "checkout_claims" ADD CONSTRAINT "checkout_claims_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkout_claims_order_idx" ON "checkout_claims" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_movements_order_cancel_restore_uq" ON "inventory_movements" USING btree ("order_id","variant_id") WHERE "inventory_movements"."movement_type" = 'ORDER_CANCELLATION_RESTORE';--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency_key_uq" ON "orders" USING btree ("idempotency_key") WHERE "orders"."idempotency_key" is not null;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_variant_uq" UNIQUE("order_id","variant_id");--> statement-breakpoint
ALTER TABLE "store_sale_items" ADD CONSTRAINT "store_sale_items_sale_variant_uq" UNIQUE("store_sale_id","variant_id");