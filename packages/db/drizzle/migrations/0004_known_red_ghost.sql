ALTER TABLE "orders" ADD COLUMN "delivering_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancelled_by_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "inventory_restored_on_cancel" boolean;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_by_staff_id_staff_users_id_fk" FOREIGN KEY ("cancelled_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_created_id_idx" ON "orders" USING btree ("created_at","id");