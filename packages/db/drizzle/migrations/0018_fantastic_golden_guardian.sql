CREATE TYPE "public"."category_visual_mode" AS ENUM('auto', 'image', 'icon');--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "visual_mode" "category_visual_mode" DEFAULT 'auto' NOT NULL;