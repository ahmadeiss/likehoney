ALTER TABLE "categories" ADD COLUMN "image_object_key" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "image_mime_type" varchar(100);--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "image_size_bytes" bigint;