CREATE TABLE "harness_run_attempts" (
	"harness_run_attempt_id" uuid PRIMARY KEY NOT NULL,
	"harness_run_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"worker_id" text NOT NULL,
	"status" text NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone NOT NULL,
	"resume_checkpoint_id" uuid,
	"error_code" text,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harness_run_checkpoints" (
	"harness_run_checkpoint_id" uuid PRIMARY KEY NOT NULL,
	"harness_run_id" uuid NOT NULL,
	"harness_run_attempt_id" uuid,
	"sequence" integer NOT NULL,
	"checkpoint_key" text NOT NULL,
	"checkpoint_kind" text NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_version" text NOT NULL,
	"step_key" text NOT NULL,
	"resume_policy" text NOT NULL,
	"state" jsonb NOT NULL,
	"state_hash" text NOT NULL,
	"input_hash" text,
	"effect_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_milestone" jsonb,
	"runtime_validation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harness_run_events" (
	"harness_run_event_id" uuid PRIMARY KEY NOT NULL,
	"harness_run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harness_run_outputs" (
	"harness_run_output_id" uuid PRIMARY KEY NOT NULL,
	"harness_run_id" uuid NOT NULL,
	"harness_run_attempt_id" uuid,
	"status" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harness_session_outbox" (
	"harness_session_outbox_id" uuid PRIMARY KEY NOT NULL,
	"harness_run_id" uuid NOT NULL,
	"ai_session_id" text NOT NULL,
	"event_type" text NOT NULL,
	"deduplication_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "harness_artifacts" ADD COLUMN "artifact_key" text;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "run_kind" text DEFAULT 'file_analysis' NOT NULL;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "workflow_id" text DEFAULT 'legacy_file_analysis' NOT NULL;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "workflow_version" text DEFAULT 'v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "current_step_key" text;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "submission_key" text;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "event_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "recovery_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "cancel_requested_by" text;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "last_checkpoint_id" uuid;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "execution_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "retry_of_run_id" uuid;--> statement-breakpoint
ALTER TABLE "harness_tool_events" ADD COLUMN "effect_key" text;--> statement-breakpoint
ALTER TABLE "harness_run_attempts" ADD CONSTRAINT "harness_run_attempts_harness_run_id_harness_runs_harness_run_id_fk" FOREIGN KEY ("harness_run_id") REFERENCES "public"."harness_runs"("harness_run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_run_checkpoints" ADD CONSTRAINT "harness_run_checkpoints_harness_run_id_harness_runs_harness_run_id_fk" FOREIGN KEY ("harness_run_id") REFERENCES "public"."harness_runs"("harness_run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_run_checkpoints" ADD CONSTRAINT "harness_run_checkpoints_harness_run_attempt_id_harness_run_attempts_harness_run_attempt_id_fk" FOREIGN KEY ("harness_run_attempt_id") REFERENCES "public"."harness_run_attempts"("harness_run_attempt_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_run_events" ADD CONSTRAINT "harness_run_events_harness_run_id_harness_runs_harness_run_id_fk" FOREIGN KEY ("harness_run_id") REFERENCES "public"."harness_runs"("harness_run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_run_outputs" ADD CONSTRAINT "harness_run_outputs_harness_run_id_harness_runs_harness_run_id_fk" FOREIGN KEY ("harness_run_id") REFERENCES "public"."harness_runs"("harness_run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_run_outputs" ADD CONSTRAINT "harness_run_outputs_harness_run_attempt_id_harness_run_attempts_harness_run_attempt_id_fk" FOREIGN KEY ("harness_run_attempt_id") REFERENCES "public"."harness_run_attempts"("harness_run_attempt_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_session_outbox" ADD CONSTRAINT "harness_session_outbox_harness_run_id_harness_runs_harness_run_id_fk" FOREIGN KEY ("harness_run_id") REFERENCES "public"."harness_runs"("harness_run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "harness_run_attempts_run_attempt_unique" ON "harness_run_attempts" USING btree ("harness_run_id","attempt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "harness_run_attempts_active_run_unique" ON "harness_run_attempts" USING btree ("harness_run_id") WHERE "harness_run_attempts"."status" in ('claimed', 'running');--> statement-breakpoint
CREATE INDEX "harness_run_attempts_lease_idx" ON "harness_run_attempts" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "harness_run_checkpoints_run_sequence_unique" ON "harness_run_checkpoints" USING btree ("harness_run_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "harness_run_checkpoints_run_key_unique" ON "harness_run_checkpoints" USING btree ("harness_run_id","checkpoint_key");--> statement-breakpoint
CREATE INDEX "harness_run_checkpoints_run_created_idx" ON "harness_run_checkpoints" USING btree ("harness_run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "harness_run_events_run_sequence_unique" ON "harness_run_events" USING btree ("harness_run_id","sequence");--> statement-breakpoint
CREATE INDEX "harness_run_events_run_created_idx" ON "harness_run_events" USING btree ("harness_run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "harness_run_outputs_run_unique" ON "harness_run_outputs" USING btree ("harness_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "harness_session_outbox_session_dedupe_unique" ON "harness_session_outbox" USING btree ("ai_session_id","deduplication_key");--> statement-breakpoint
CREATE INDEX "harness_session_outbox_pending_idx" ON "harness_session_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "harness_session_outbox_run_idx" ON "harness_session_outbox" USING btree ("harness_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "harness_artifacts_run_artifact_unique" ON "harness_artifacts" USING btree ("harness_run_id","artifact_key");--> statement-breakpoint
CREATE INDEX "harness_runs_queue_idx" ON "harness_runs" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "harness_runs_owner_submission_unique" ON "harness_runs" USING btree ("owner_user_id","submission_key");--> statement-breakpoint
CREATE UNIQUE INDEX "harness_runs_active_workbench_session_unique" ON "harness_runs" USING btree ("ai_session_id") WHERE "harness_runs"."ai_session_id" is not null and "harness_runs"."run_kind" = 'workbench_chat' and "harness_runs"."status" in ('queued', 'running', 'waiting', 'recovering', 'cancelling');--> statement-breakpoint
CREATE UNIQUE INDEX "harness_tool_events_run_effect_unique" ON "harness_tool_events" USING btree ("harness_run_id","effect_key");