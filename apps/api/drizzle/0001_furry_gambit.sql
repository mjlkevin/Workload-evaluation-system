CREATE TABLE "extraction_results" (
	"extraction_id" uuid PRIMARY KEY NOT NULL,
	"source_ref" text NOT NULL,
	"version_id" text,
	"status" text NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fallbacks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_ms" integer NOT NULL,
	"extracted_at" timestamp with time zone NOT NULL,
	"extracted_by_user_id" text,
	"extractor_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_logs" (
	"change_log_id" uuid PRIMARY KEY NOT NULL,
	"evidence_id" uuid NOT NULL,
	"extraction_id" uuid,
	"field_path" text NOT NULL,
	"old_value" text,
	"new_value" text NOT NULL,
	"old_method" text,
	"new_method" text NOT NULL,
	"changed_by_user_id" text,
	"reason" text,
	"changed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "extraction_results_source_ref_idx" ON "extraction_results" USING btree ("source_ref");--> statement-breakpoint
CREATE INDEX "extraction_results_extracted_at_idx" ON "extraction_results" USING btree ("extracted_at");--> statement-breakpoint
CREATE INDEX "change_logs_evidence_id_idx" ON "change_logs" USING btree ("evidence_id");--> statement-breakpoint
CREATE INDEX "change_logs_extraction_id_idx" ON "change_logs" USING btree ("extraction_id");--> statement-breakpoint
CREATE INDEX "change_logs_changed_at_idx" ON "change_logs" USING btree ("changed_at");