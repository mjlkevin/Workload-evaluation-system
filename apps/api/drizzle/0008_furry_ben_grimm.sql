CREATE TABLE "history_projects" (
	"history_project_id" uuid PRIMARY KEY NOT NULL,
	"industry" text NOT NULL,
	"scale" text NOT NULL,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_days" integer NOT NULL,
	"actual_days" integer,
	"estimated_cost" integer,
	"actual_cost" integer,
	"delay_reason" text,
	"risk_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_assessment_version_id" uuid,
	"source_sealed_baseline_id" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "history_projects_industry_idx" ON "history_projects" USING btree ("industry");--> statement-breakpoint
CREATE INDEX "history_projects_scale_idx" ON "history_projects" USING btree ("scale");