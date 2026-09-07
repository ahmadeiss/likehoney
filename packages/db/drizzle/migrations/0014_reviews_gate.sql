CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."review_verified_source" AS ENUM('online_order', 'store_sale');--> statement-breakpoint
CREATE TABLE "store_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"rating" integer NOT NULL,
	"review_text" text NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"verified_purchase" boolean DEFAULT false NOT NULL,
	"verified_source" "review_verified_source",
	"customer_id" uuid,
	"submitted_phone_normalized" text,
	"submitted_reference" text,
	"moderated_by_staff_id" uuid,
	"moderated_at" timestamp with time zone,
	"moderation_note" text,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_reviews_rating_range" CHECK ("store_reviews"."rating" between 1 and 5),
	CONSTRAINT "store_reviews_verified_source_consistent" CHECK (("store_reviews"."verified_purchase" = false and "store_reviews"."verified_source" is null) or ("store_reviews"."verified_purchase" = true and "store_reviews"."verified_source" is not null))
);
--> statement-breakpoint
ALTER TABLE "store_reviews" ADD CONSTRAINT "store_reviews_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_reviews" ADD CONSTRAINT "store_reviews_moderated_by_staff_id_staff_users_id_fk" FOREIGN KEY ("moderated_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_reviews_status_approved_idx" ON "store_reviews" USING btree ("status","approved_at","created_at");--> statement-breakpoint
CREATE INDEX "store_reviews_status_created_idx" ON "store_reviews" USING btree ("status","created_at");--> statement-breakpoint

-- --- Reviews Gate: moderation permission + owner-tier grant --------------
-- Mirrors the 0005 pattern. `reviews:moderate` gates the Admin moderation
-- surface only; it is never in the default employee set (owner/admin
-- authority — §16). Idempotent: safe on a DB already bootstrapped.
INSERT INTO permissions (code, name_ar, name_en) VALUES
  ('reviews:moderate', 'إدارة تقييمات العملاء', 'Customer reviews moderation')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.code IN ('admin', 'catalog-admin')
  AND p.code = 'reviews:moderate'
ON CONFLICT DO NOTHING;