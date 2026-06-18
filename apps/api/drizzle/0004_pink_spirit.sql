CREATE TABLE "opportunity_briefs" (
	"opportunity_brief_id" uuid PRIMARY KEY NOT NULL,
	"customer_name" text NOT NULL,
	"customer_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"vague_requirements" text,
	"extracted_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price_range" jsonb,
	"phase_proposal" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parent_project_id" uuid,
	"linked_requirement_pack_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"owner_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "opportunity_briefs_owner_user_id_idx" ON "opportunity_briefs" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "opportunity_briefs_status_idx" ON "opportunity_briefs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "opportunity_briefs_customer_name_idx" ON "opportunity_briefs" USING btree ("customer_name");