CREATE TABLE "harness_artifacts" (
	"harness_artifact_id" uuid PRIMARY KEY NOT NULL,
	"harness_run_id" uuid NOT NULL,
	"artifact_type" text NOT NULL,
	"title" text NOT NULL,
	"version" text NOT NULL,
	"status" text NOT NULL,
	"content" jsonb NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harness_cases" (
	"harness_case_id" uuid PRIMARY KEY NOT NULL,
	"case_key" text NOT NULL,
	"title" text NOT NULL,
	"sample_type" text NOT NULL,
	"file_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harness_evidences" (
	"harness_evidence_id" uuid PRIMARY KEY NOT NULL,
	"harness_run_id" uuid,
	"harness_file_id" uuid,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"evidence_type" text NOT NULL,
	"business_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locator" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"text_snapshot" text,
	"table_snapshot" jsonb,
	"parser_version" text NOT NULL,
	"file_hash" text,
	"confidence" real,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harness_expected_answers" (
	"harness_expected_answer_id" uuid PRIMARY KEY NOT NULL,
	"harness_case_id" uuid NOT NULL,
	"granularity" text NOT NULL,
	"expected" jsonb NOT NULL,
	"version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harness_files" (
	"harness_file_id" uuid PRIMARY KEY NOT NULL,
	"harness_run_id" uuid NOT NULL,
	"attachment_id" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"file_hash" text,
	"storage_path" text,
	"role" text,
	"role_confidence" real,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harness_model_runs" (
	"harness_model_run_id" uuid PRIMARY KEY NOT NULL,
	"harness_run_id" uuid NOT NULL,
	"tool_event_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"mode" text NOT NULL,
	"prompt_profile_id" text,
	"prompt_version" text,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_token_estimate" integer,
	"output_token_estimate" integer,
	"raw_content_hash" text,
	"raw_content_summary" text,
	"elapsed_ms" integer,
	"fallback_reason" text,
	"schema_validation_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harness_runs" (
	"harness_run_id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"owner_username" text NOT NULL,
	"mode" text NOT NULL,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"ai_session_id" text,
	"project_evaluation_id" text,
	"requirement_version_id" text,
	"original_standard_set_version" text,
	"replay_standard_set_version" text,
	"prompt_profile_id" text,
	"prompt_version" text,
	"force_reanalysis" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "harness_scores" (
	"harness_score_id" uuid PRIMARY KEY NOT NULL,
	"harness_run_id" uuid NOT NULL,
	"case_id" text,
	"score_type" text NOT NULL,
	"value" real NOT NULL,
	"passed" boolean NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harness_tool_events" (
	"harness_tool_event_id" uuid PRIMARY KEY NOT NULL,
	"harness_run_id" uuid NOT NULL,
	"action_id" text,
	"tool_name" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text NOT NULL,
	"risk_level" text,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "harness_artifacts" ADD CONSTRAINT "harness_artifacts_harness_run_id_harness_runs_harness_run_id_fk" FOREIGN KEY ("harness_run_id") REFERENCES "public"."harness_runs"("harness_run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_artifacts" ADD CONSTRAINT "harness_artifacts_model_run_id_harness_model_runs_harness_model_run_id_fk" FOREIGN KEY ("model_run_id") REFERENCES "public"."harness_model_runs"("harness_model_run_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_evidences" ADD CONSTRAINT "harness_evidences_harness_run_id_harness_runs_harness_run_id_fk" FOREIGN KEY ("harness_run_id") REFERENCES "public"."harness_runs"("harness_run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_evidences" ADD CONSTRAINT "harness_evidences_harness_file_id_harness_files_harness_file_id_fk" FOREIGN KEY ("harness_file_id") REFERENCES "public"."harness_files"("harness_file_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_expected_answers" ADD CONSTRAINT "harness_expected_answers_harness_case_id_harness_cases_harness_case_id_fk" FOREIGN KEY ("harness_case_id") REFERENCES "public"."harness_cases"("harness_case_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_files" ADD CONSTRAINT "harness_files_harness_run_id_harness_runs_harness_run_id_fk" FOREIGN KEY ("harness_run_id") REFERENCES "public"."harness_runs"("harness_run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_model_runs" ADD CONSTRAINT "harness_model_runs_harness_run_id_harness_runs_harness_run_id_fk" FOREIGN KEY ("harness_run_id") REFERENCES "public"."harness_runs"("harness_run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_model_runs" ADD CONSTRAINT "harness_model_runs_tool_event_id_harness_tool_events_harness_tool_event_id_fk" FOREIGN KEY ("tool_event_id") REFERENCES "public"."harness_tool_events"("harness_tool_event_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_scores" ADD CONSTRAINT "harness_scores_harness_run_id_harness_runs_harness_run_id_fk" FOREIGN KEY ("harness_run_id") REFERENCES "public"."harness_runs"("harness_run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_tool_events" ADD CONSTRAINT "harness_tool_events_harness_run_id_harness_runs_harness_run_id_fk" FOREIGN KEY ("harness_run_id") REFERENCES "public"."harness_runs"("harness_run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "harness_artifacts_run_idx" ON "harness_artifacts" USING btree ("harness_run_id");--> statement-breakpoint
CREATE INDEX "harness_artifacts_type_idx" ON "harness_artifacts" USING btree ("artifact_type");--> statement-breakpoint
CREATE INDEX "harness_artifacts_run_type_idx" ON "harness_artifacts" USING btree ("harness_run_id","artifact_type");--> statement-breakpoint
CREATE INDEX "harness_cases_key_idx" ON "harness_cases" USING btree ("case_key");--> statement-breakpoint
CREATE INDEX "harness_cases_active_idx" ON "harness_cases" USING btree ("active");--> statement-breakpoint
CREATE INDEX "harness_evidences_run_idx" ON "harness_evidences" USING btree ("harness_run_id");--> statement-breakpoint
CREATE INDEX "harness_evidences_file_idx" ON "harness_evidences" USING btree ("harness_file_id");--> statement-breakpoint
CREATE INDEX "harness_evidences_source_idx" ON "harness_evidences" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "harness_evidences_run_source_idx" ON "harness_evidences" USING btree ("harness_run_id","source_type");--> statement-breakpoint
CREATE INDEX "harness_expected_answers_case_idx" ON "harness_expected_answers" USING btree ("harness_case_id");--> statement-breakpoint
CREATE INDEX "harness_files_run_idx" ON "harness_files" USING btree ("harness_run_id");--> statement-breakpoint
CREATE INDEX "harness_files_attachment_idx" ON "harness_files" USING btree ("attachment_id");--> statement-breakpoint
CREATE INDEX "harness_model_runs_run_idx" ON "harness_model_runs" USING btree ("harness_run_id");--> statement-breakpoint
CREATE INDEX "harness_model_runs_model_idx" ON "harness_model_runs" USING btree ("provider","model");--> statement-breakpoint
CREATE INDEX "harness_model_runs_run_provider_idx" ON "harness_model_runs" USING btree ("harness_run_id","provider");--> statement-breakpoint
CREATE INDEX "harness_runs_owner_idx" ON "harness_runs" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "harness_runs_ai_session_idx" ON "harness_runs" USING btree ("ai_session_id");--> statement-breakpoint
CREATE INDEX "harness_runs_status_idx" ON "harness_runs" USING btree ("status","stage");--> statement-breakpoint
CREATE INDEX "harness_runs_created_idx" ON "harness_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "harness_scores_run_idx" ON "harness_scores" USING btree ("harness_run_id");--> statement-breakpoint
CREATE INDEX "harness_scores_case_idx" ON "harness_scores" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "harness_tool_events_run_idx" ON "harness_tool_events" USING btree ("harness_run_id");--> statement-breakpoint
CREATE INDEX "harness_tool_events_action_idx" ON "harness_tool_events" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "harness_tool_events_run_action_idx" ON "harness_tool_events" USING btree ("harness_run_id","action_id");