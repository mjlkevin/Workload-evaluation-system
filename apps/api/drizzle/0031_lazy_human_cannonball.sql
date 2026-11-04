CREATE TABLE "harness_sandbox_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"session_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"format" text NOT NULL,
	"mime_type" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harness_sandbox_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"configuration" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harness_sandbox_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"session_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"request_digest" text NOT NULL,
	"request" jsonb NOT NULL,
	"plan" jsonb NOT NULL,
	"state" text NOT NULL,
	"sandbox_id" text,
	"cleanup" text DEFAULT 'none' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "harness_sandbox_artifacts" ADD CONSTRAINT "harness_sandbox_artifacts_job_id_harness_sandbox_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."harness_sandbox_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_sandbox_jobs" ADD CONSTRAINT "harness_sandbox_jobs_run_id_harness_runs_harness_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."harness_runs"("harness_run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "harness_sandbox_artifact_owner" ON "harness_sandbox_artifacts" USING btree ("owner_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "harness_sandbox_job_call" ON "harness_sandbox_jobs" USING btree ("run_id","ordinal");--> statement-breakpoint
CREATE INDEX "harness_sandbox_job_cleanup" ON "harness_sandbox_jobs" USING btree ("cleanup","updated_at");