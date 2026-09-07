ALTER TABLE "product_variants" ADD COLUMN "acquisition_cost_minor" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "city_en" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "city_ar" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "address_en" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "address_ar" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "first_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "status" "entity_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "supplier_id_snapshot" uuid;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "supplier_name_en_snapshot" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "supplier_name_ar_snapshot" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "category_id_snapshot" uuid;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "category_name_en_snapshot" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "category_name_ar_snapshot" text;--> statement-breakpoint
ALTER TABLE "store_sale_items" ADD COLUMN "supplier_id_snapshot" uuid;--> statement-breakpoint
ALTER TABLE "store_sale_items" ADD COLUMN "supplier_name_en_snapshot" text;--> statement-breakpoint
ALTER TABLE "store_sale_items" ADD COLUMN "supplier_name_ar_snapshot" text;--> statement-breakpoint
ALTER TABLE "store_sale_items" ADD COLUMN "category_id_snapshot" uuid;--> statement-breakpoint
ALTER TABLE "store_sale_items" ADD COLUMN "category_name_en_snapshot" text;--> statement-breakpoint
ALTER TABLE "store_sale_items" ADD COLUMN "category_name_ar_snapshot" text;--> statement-breakpoint
ALTER TABLE "store_sales" ADD COLUMN "customer_phone_raw_snapshot" text;--> statement-breakpoint
ALTER TABLE "store_sales" ADD COLUMN "customer_name_en_snapshot" text;--> statement-breakpoint
ALTER TABLE "store_sales" ADD COLUMN "customer_name_ar_snapshot" text;--> statement-breakpoint
ALTER TABLE "store_sales" ADD COLUMN "customer_city_en_snapshot" text;--> statement-breakpoint
ALTER TABLE "store_sales" ADD COLUMN "customer_city_ar_snapshot" text;--> statement-breakpoint
ALTER TABLE "store_sales" ADD COLUMN "customer_address_en_snapshot" text;--> statement-breakpoint
ALTER TABLE "store_sales" ADD COLUMN "customer_address_ar_snapshot" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_supplier_id_snapshot_suppliers_id_fk" FOREIGN KEY ("supplier_id_snapshot") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_category_id_snapshot_categories_id_fk" FOREIGN KEY ("category_id_snapshot") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_sale_items" ADD CONSTRAINT "store_sale_items_supplier_id_snapshot_suppliers_id_fk" FOREIGN KEY ("supplier_id_snapshot") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_sale_items" ADD CONSTRAINT "store_sale_items_category_id_snapshot_categories_id_fk" FOREIGN KEY ("category_id_snapshot") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_status_idx" ON "customers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "customers_last_seen_idx" ON "customers" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "order_items_supplier_snapshot_idx" ON "order_items" USING btree ("supplier_id_snapshot");--> statement-breakpoint
CREATE INDEX "order_items_category_snapshot_idx" ON "order_items" USING btree ("category_id_snapshot");--> statement-breakpoint
CREATE INDEX "orders_completed_idx" ON "orders" USING btree ("completed_at") WHERE "orders"."completed_at" is not null;--> statement-breakpoint
CREATE INDEX "store_sale_items_supplier_snapshot_idx" ON "store_sale_items" USING btree ("supplier_id_snapshot");--> statement-breakpoint
CREATE INDEX "store_sale_items_category_snapshot_idx" ON "store_sale_items" USING btree ("category_id_snapshot");--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_acquisition_cost_nonnegative" CHECK ("product_variants"."acquisition_cost_minor" is null or "product_variants"."acquisition_cost_minor" >= 0);--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_unit_cost_nonnegative" CHECK ("order_items"."unit_cost_snapshot" is null or "order_items"."unit_cost_snapshot" >= 0);--> statement-breakpoint
ALTER TABLE "store_sale_items" ADD CONSTRAINT "store_sale_items_unit_cost_nonnegative" CHECK ("store_sale_items"."unit_cost_snapshot" is null or "store_sale_items"."unit_cost_snapshot" >= 0);