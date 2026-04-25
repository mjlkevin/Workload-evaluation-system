CREATE TABLE "dev_assessments" (
	"dev_assessment_id" uuid PRIMARY KEY NOT NULL,
	"assessment_version_id" uuid,
	"contract_mode" text DEFAULT 'embedded' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deploy_ops_items" jsonb DEFAULT '[]'::jsonb,
	"total_days" real DEFAULT 0 NOT NULL,
	"assigned_by_user_id" text,
	"assessed_by_user_id" text,
	"context_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dev_assessments_version_id_idx" ON "dev_assessments" USING btree ("assessment_version_id");--> statement-breakpoint
CREATE INDEX "dev_assessments_status_idx" ON "dev_assessments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dev_assessments_assessed_by_idx" ON "dev_assessments" USING btree ("assessed_by_user_id");