CREATE TABLE "skill_definitions" (
	"skill_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"enabled" boolean NOT NULL,
	"archived" boolean NOT NULL,
	"active_version_id" text,
	"current_version_id" text NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"revision" integer NOT NULL,
	"action" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"version_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "skill_revisions_skill_revision_key" UNIQUE("skill_id","revision")
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"skill_version_id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"position" integer NOT NULL,
	"version_code" text NOT NULL,
	"major_letter" text NOT NULL,
	"minor_number" integer NOT NULL,
	"status" text NOT NULL,
	"checkout_status" text NOT NULL,
	"checked_out_by" text,
	"definition" jsonb NOT NULL,
	"hash" text NOT NULL,
	"last_checkin_definition" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "skill_versions_code_key" UNIQUE("version_code"),
	CONSTRAINT "skill_versions_position_key" UNIQUE("skill_id","position")
);
--> statement-breakpoint
ALTER TABLE "skill_revisions" ADD CONSTRAINT "skill_revisions_skill_id_skill_definitions_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill_definitions"("skill_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_revisions" ADD CONSTRAINT "skill_revisions_version_id_skill_versions_skill_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."skill_versions"("skill_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_id_skill_definitions_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill_definitions"("skill_id") ON DELETE restrict ON UPDATE no action;