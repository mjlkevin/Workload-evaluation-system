CREATE TABLE "evidences" (
	"evidence_id" uuid PRIMARY KEY NOT NULL,
	"extraction_id" uuid,
	"field_path" text NOT NULL,
	"value" text NOT NULL,
	"raw_text" text,
	"method" text NOT NULL,
	"confidence" real NOT NULL,
	"source" jsonb NOT NULL,
	"ai_meta" jsonb,
	"history" jsonb,
	"extracted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text
);
--> statement-breakpoint
CREATE INDEX "evidences_field_path_idx" ON "evidences" USING btree ("field_path");--> statement-breakpoint
CREATE INDEX "evidences_extraction_id_idx" ON "evidences" USING btree ("extraction_id");