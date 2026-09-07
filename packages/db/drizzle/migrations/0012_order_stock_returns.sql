CREATE TABLE "order_stock_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_stock_return_items_return_order_item_uq" UNIQUE("return_id","order_item_id"),
	CONSTRAINT "order_stock_return_items_quantity_positive" CHECK ("order_stock_return_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "order_stock_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"received_by_staff_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_stock_return_items" ADD CONSTRAINT "order_stock_return_items_return_id_order_stock_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."order_stock_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_stock_return_items" ADD CONSTRAINT "order_stock_return_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_stock_return_items" ADD CONSTRAINT "order_stock_return_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_stock_returns" ADD CONSTRAINT "order_stock_returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_stock_returns" ADD CONSTRAINT "order_stock_returns_received_by_staff_id_staff_users_id_fk" FOREIGN KEY ("received_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_stock_return_items_return_idx" ON "order_stock_return_items" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "order_stock_return_items_order_item_idx" ON "order_stock_return_items" USING btree ("order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_stock_returns_idempotency_key_uq" ON "order_stock_returns" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "order_stock_returns_order_idx" ON "order_stock_returns" USING btree ("order_id","created_at");