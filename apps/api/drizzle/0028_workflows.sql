CREATE TABLE "workflow_definitions" (
	"workflow_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"enabled" boolean NOT NULL,
	"archived" boolean NOT NULL,
	"current_version_id" text NOT NULL,
	"active_version_id" text,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"revision" integer NOT NULL,
	"action" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"reason" text,
	"version_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workflow_revisions_revision_key" UNIQUE("workflow_id","revision")
);
--> statement-breakpoint
CREATE TABLE "workflow_skill_dependencies" (
	"version_id" text NOT NULL,
	"step_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"skill_version_id" text NOT NULL,
	CONSTRAINT "workflow_skill_dependencies_step_key" UNIQUE("version_id","step_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"workflow_version_id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"position" integer NOT NULL,
	"version_code" text NOT NULL,
	"major_letter" text NOT NULL,
	"minor_number" integer NOT NULL,
	"status" text NOT NULL,
	"checkout_status" text NOT NULL,
	"checked_out_by" text,
	"definition" jsonb NOT NULL,
	"last_checkin_definition" jsonb NOT NULL,
	"hash" text NOT NULL,
	"dependency_snapshot" jsonb,
	"validation" jsonb,
	"review" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workflow_versions_code_key" UNIQUE("version_code"),
	CONSTRAINT "workflow_versions_position_key" UNIQUE("workflow_id","position")
);
--> statement-breakpoint
ALTER TABLE "workflow_revisions" ADD CONSTRAINT "workflow_revisions_workflow_id_workflow_definitions_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow_definitions"("workflow_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_revisions" ADD CONSTRAINT "workflow_revisions_version_id_workflow_versions_workflow_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."workflow_versions"("workflow_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_skill_dependencies" ADD CONSTRAINT "workflow_skill_dependencies_version_id_workflow_versions_workflow_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."workflow_versions"("workflow_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_skill_dependencies" ADD CONSTRAINT "workflow_skill_dependencies_skill_id_skill_definitions_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill_definitions"("skill_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_skill_dependencies" ADD CONSTRAINT "workflow_skill_dependencies_skill_version_id_skill_versions_skill_version_id_fk" FOREIGN KEY ("skill_version_id") REFERENCES "public"."skill_versions"("skill_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_workflow_definitions_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow_definitions"("workflow_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_skill_dependencies_skill_idx" ON "workflow_skill_dependencies" USING btree ("skill_id","skill_version_id");