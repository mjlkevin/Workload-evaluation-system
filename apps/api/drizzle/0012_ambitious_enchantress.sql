CREATE TABLE "harness_manual_test_results" (
	"manual_test_result_id" uuid PRIMARY KEY NOT NULL,
	"harness_run_id" uuid,
	"harness_tool_event_id" uuid,
	"test_case_key" text,
	"executor_name" text NOT NULL,
	"environment" text NOT NULL,
	"account" text,
	"screenshot_url" text,
	"result_status" text NOT NULL,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"owner_username" text NOT NULL,
	"title" text NOT NULL,
	"domain" text NOT NULL,
	"workflow_key" text NOT NULL,
	"business_role" text NOT NULL,
	"status" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"linked_records" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_user_id" text,
	"used_by_username" text
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"token_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"username" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "rule_sets" (
	"rule_set_id" text PRIMARY KEY NOT NULL,
	"rule_version" text NOT NULL,
	"pipeline_version" text NOT NULL,
	"pipeline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"base_rule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"org_increment_rule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_configs" (
	"config_key" text PRIMARY KEY NOT NULL,
	"store" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_audit_logs" (
	"audit_id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "team_plan_bindings" (
	"global_version_code" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_review_comments" (
	"comment_id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_reviews" (
	"review_id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"global_version_code" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"team_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"template_id" text PRIMARY KEY NOT NULL,
	"template_version" text NOT NULL,
	"template_name" text NOT NULL,
	"groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sheets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traces" (
	"trace_id" text PRIMARY KEY NOT NULL,
	"source_domain" text NOT NULL,
	"source_id" text,
	"owner_user_id" text NOT NULL,
	"owner_username" text NOT NULL,
	"user_input_summary" text,
	"intent_result" jsonb,
	"spans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "version_records" (
	"record_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"version_code" text NOT NULL,
	"template_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_username" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"updated_by_username" text NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" text,
	"checkout_status" text DEFAULT 'checked_in' NOT NULL,
	"version_doc_status" text DEFAULT 'drafting' NOT NULL,
	"checked_out_by_user_id" text,
	"checked_out_by_username" text,
	"checkout_at" timestamp with time zone,
	"major_letter" text DEFAULT 'A' NOT NULL,
	"minor_number" integer DEFAULT 0 NOT NULL,
	"base_code" text NOT NULL,
	"is_historical_archive" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"last_checkin_payload" jsonb
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "business_role" text DEFAULT 'pre_sales' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "harness_manual_test_results" ADD CONSTRAINT "harness_manual_test_results_harness_run_id_harness_runs_harness_run_id_fk" FOREIGN KEY ("harness_run_id") REFERENCES "public"."harness_runs"("harness_run_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "harness_mtr_run_idx" ON "harness_manual_test_results" USING btree ("harness_run_id");--> statement-breakpoint
CREATE INDEX "harness_mtr_status_idx" ON "harness_manual_test_results" USING btree ("result_status");--> statement-breakpoint
CREATE INDEX "harness_mtr_case_key_idx" ON "harness_manual_test_results" USING btree ("test_case_key");--> statement-breakpoint
CREATE INDEX "ai_sessions_owner_idx" ON "ai_sessions" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "ai_sessions_owner_updated_idx" ON "ai_sessions" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_status_idx" ON "password_reset_tokens" USING btree ("status");--> statement-breakpoint
CREATE INDEX "team_audit_logs_team_idx" ON "team_audit_logs" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "team_review_comments_review_idx" ON "team_review_comments" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "team_reviews_team_idx" ON "team_reviews" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "traces_owner_idx" ON "traces" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "traces_source_idx" ON "traces" USING btree ("source_domain","source_id");--> statement-breakpoint
CREATE INDEX "traces_created_idx" ON "traces" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "version_records_owner_type_idx" ON "version_records" USING btree ("owner_user_id","type");--> statement-breakpoint
CREATE INDEX "version_records_owner_code_idx" ON "version_records" USING btree ("owner_user_id","type","template_id","version_code");--> statement-breakpoint
CREATE INDEX "version_records_updated_idx" ON "version_records" USING btree ("updated_at");