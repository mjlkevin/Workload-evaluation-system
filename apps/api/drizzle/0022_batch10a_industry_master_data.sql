CREATE TABLE "industry_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "industry_categories_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "industry_subcategories" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "industry_subcategories_category_name_key" UNIQUE("category_id","name")
);
--> statement-breakpoint
ALTER TABLE "industry_subcategories" ADD CONSTRAINT "industry_subcategories_category_id_industry_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."industry_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "industry_categories_status_idx" ON "industry_categories" USING btree ("status");--> statement-breakpoint
CREATE INDEX "industry_subcategories_category_idx" ON "industry_subcategories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "industry_subcategories_status_idx" ON "industry_subcategories" USING btree ("status");