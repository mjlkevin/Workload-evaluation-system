CREATE TABLE "change_submissions" (
	"change_submission_id" uuid PRIMARY KEY NOT NULL,
	"parent_entity_type" text NOT NULL,
	"parent_entity_id" uuid NOT NULL,
	"change_description" text NOT NULL,
	"diff_result" jsonb,
	"new_estimate" jsonb,
	"submitted_by_user_id" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"merged_to_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "change_submissions_parent_entity_idx" ON "change_submissions" USING btree ("parent_entity_type","parent_entity_id");--> statement-breakpoint
CREATE INDEX "change_submissions_status_idx" ON "change_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "change_submissions_submitted_by_idx" ON "change_submissions" USING btree ("submitted_by_user_id");