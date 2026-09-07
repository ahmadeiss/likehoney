CREATE TYPE "public"."payment_transaction_status" AS ENUM('created', 'pending', 'succeeded', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."stock_reservation_state" AS ENUM('held', 'reconciling', 'committed', 'released');--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'electronic';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'pending';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'expired';--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"provider_payment_id" text,
	"payment_id" uuid,
	"type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"amount_minor" integer,
	"currency" varchar(3),
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"outcome" text,
	CONSTRAINT "payment_events_provider_nonempty" CHECK (btrim("payment_events"."provider") <> ''),
	CONSTRAINT "payment_events_event_id_nonempty" CHECK (btrim("payment_events"."provider_event_id") <> ''),
	CONSTRAINT "payment_events_type_nonempty" CHECK (btrim("payment_events"."type") <> ''),
	CONSTRAINT "payment_events_payload_hash_sha256" CHECK ("payment_events"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "payment_events_amount_nonneg" CHECK ("payment_events"."amount_minor" is null or "payment_events"."amount_minor" >= 0),
	CONSTRAINT "payment_events_currency_format" CHECK ("payment_events"."currency" is null or "payment_events"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_events_provider_ref_nonempty" CHECK ("payment_events"."provider_payment_id" is null or btrim("payment_events"."provider_payment_id") <> '')
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text,
	"idempotency_key" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" "payment_transaction_status" DEFAULT 'created' NOT NULL,
	"redirect_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_minor" > 0),
	CONSTRAINT "payments_provider_nonempty" CHECK (btrim("payments"."provider") <> ''),
	CONSTRAINT "payments_idem_nonempty" CHECK (btrim("payments"."idempotency_key") <> ''),
	CONSTRAINT "payments_currency_format" CHECK ("payments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payments_provider_ref_nonempty" CHECK ("payments"."provider_payment_id" is null or btrim("payments"."provider_payment_id") <> '')
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"state" "stock_reservation_state" DEFAULT 'held' NOT NULL,
	"reconcile_after" timestamp with time zone NOT NULL,
	"reconcile_attempts" integer DEFAULT 0 NOT NULL,
	"last_reconciled_at" timestamp with time zone,
	"authoritative_terminal_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_reservations_quantity_positive" CHECK ("stock_reservations"."quantity" > 0),
	CONSTRAINT "stock_reservations_reconcile_nonneg" CHECK ("stock_reservations"."reconcile_attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD COLUMN "quantity_reserved" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancellation_source" text;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_provider_event_uq" ON "payment_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "payment_events_payment_idx" ON "payment_events" USING btree ("payment_id") WHERE "payment_events"."payment_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_events_provider_payment_idx" ON "payment_events" USING btree ("provider","provider_payment_id") WHERE "payment_events"."provider_payment_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_events_unprocessed_idx" ON "payment_events" USING btree ("received_at") WHERE "payment_events"."processed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_key_uq" ON "payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref_uq" ON "payments" USING btree ("provider","provider_payment_id") WHERE "payments"."provider_payment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_open_per_order_uq" ON "payments" USING btree ("order_id") WHERE "payments"."status" in ('created', 'pending', 'succeeded');--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_reservations_order_variant_uq" ON "stock_reservations" USING btree ("order_id","variant_id");--> statement-breakpoint
CREATE INDEX "stock_reservations_order_idx" ON "stock_reservations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "stock_reservations_sweep_idx" ON "stock_reservations" USING btree ("reconcile_after") WHERE "stock_reservations"."state" in ('held', 'reconciling');--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_movements_online_order_uq" ON "inventory_movements" USING btree ("order_id","variant_id") WHERE "inventory_movements"."movement_type" = 'ONLINE_ORDER';--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_reserved_nonnegative" CHECK ("inventory_balances"."quantity_reserved" >= 0);--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_reserved_le_on_hand" CHECK ("inventory_balances"."quantity_reserved" <= "inventory_balances"."quantity_on_hand");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancellation_source_valid" CHECK ("orders"."cancellation_source" is null or "orders"."cancellation_source" in ('staff', 'system_payment_expiry'));