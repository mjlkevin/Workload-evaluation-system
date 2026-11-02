CREATE TABLE "skill_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"version_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"hash" text NOT NULL,
	"context_hash" text NOT NULL,
	"snapshot_revision" integer NOT NULL,
	"result" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_release_events" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"version_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"previous_version_id" text
);
--> statement-breakpoint
CREATE TABLE "skill_release_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"version_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"evaluation_id" text NOT NULL,
	"hash" text NOT NULL,
	"context_hash" text NOT NULL,
	"reason" text NOT NULL,
	"acknowledged_simulation" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_evaluations" ADD CONSTRAINT "skill_evaluations_skill_id_skill_definitions_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill_definitions"("skill_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_evaluations" ADD CONSTRAINT "skill_evaluations_version_id_skill_versions_skill_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."skill_versions"("skill_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_release_events" ADD CONSTRAINT "skill_release_events_skill_id_skill_definitions_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill_definitions"("skill_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_release_events" ADD CONSTRAINT "skill_release_events_version_id_skill_versions_skill_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."skill_versions"("skill_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_release_events" ADD CONSTRAINT "skill_release_events_previous_version_id_skill_versions_skill_version_id_fk" FOREIGN KEY ("previous_version_id") REFERENCES "public"."skill_versions"("skill_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_release_reviews" ADD CONSTRAINT "skill_release_reviews_skill_id_skill_definitions_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill_definitions"("skill_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_release_reviews" ADD CONSTRAINT "skill_release_reviews_version_id_skill_versions_skill_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."skill_versions"("skill_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_release_reviews" ADD CONSTRAINT "skill_release_reviews_evaluation_id_skill_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."skill_evaluations"("id") ON DELETE restrict ON UPDATE no action;