CREATE TABLE "product_line_sku_links" (
	"product_id" text NOT NULL,
	"sku_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "product_line_sku_links_pkey" UNIQUE("product_id","sku_id")
);
--> statement-breakpoint
CREATE TABLE "product_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "product_lines_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "product_modules" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "product_modules_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "product_sku_module_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"product_id" text NOT NULL,
	"sku_id" text NOT NULL,
	"module_id" text,
	"template_item_id" text NOT NULL,
	"group_id" text NOT NULL,
	"group_name" text NOT NULL,
	"item_name" text NOT NULL,
	"sheet_name" text,
	"app_group" text,
	"default_included" boolean DEFAULT false,
	"delivery_point" text,
	"delivery_desc" text,
	"eval_desc" text,
	"standard_days" real NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "product_sku_module_assignments_template_item_key" UNIQUE("template_id","template_item_id")
);
--> statement-breakpoint
CREATE TABLE "product_skus" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "product_skus_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "product_templates" (
	"template_id" text PRIMARY KEY NOT NULL,
	"template_version" text NOT NULL,
	"template_name" text NOT NULL,
	"groups_snapshot" jsonb DEFAULT '[]'::jsonb,
	"sheets_snapshot" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_line_sku_links" ADD CONSTRAINT "product_line_sku_links_product_id_product_lines_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_line_sku_links" ADD CONSTRAINT "product_line_sku_links_sku_id_product_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."product_skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sku_module_assignments" ADD CONSTRAINT "product_sku_module_assignments_template_id_product_templates_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."product_templates"("template_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sku_module_assignments" ADD CONSTRAINT "product_sku_module_assignments_product_id_product_lines_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sku_module_assignments" ADD CONSTRAINT "product_sku_module_assignments_sku_id_product_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."product_skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sku_module_assignments" ADD CONSTRAINT "product_sku_module_assignments_module_id_product_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."product_modules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_line_sku_links_product_idx" ON "product_line_sku_links" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_line_sku_links_sku_idx" ON "product_line_sku_links" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "product_line_sku_links_status_idx" ON "product_line_sku_links" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_lines_status_idx" ON "product_lines" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_modules_status_idx" ON "product_modules" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_sku_module_assignments_grain_idx" ON "product_sku_module_assignments" USING btree ("product_id","sku_id","module_id","delivery_point");--> statement-breakpoint
CREATE INDEX "product_sku_module_assignments_product_idx" ON "product_sku_module_assignments" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_sku_module_assignments_sku_idx" ON "product_sku_module_assignments" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "product_sku_module_assignments_module_idx" ON "product_sku_module_assignments" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "product_sku_module_assignments_status_idx" ON "product_sku_module_assignments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_skus_status_idx" ON "product_skus" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_templates_active_idx" ON "product_templates" USING btree ("is_active");