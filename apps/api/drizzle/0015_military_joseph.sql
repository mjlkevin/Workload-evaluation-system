CREATE TABLE "memory_atoms" (
	"memory_atom_id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"harness_run_id" uuid NOT NULL,
	"source_type" text DEFAULT 'distill' NOT NULL,
	"fact_text" text NOT NULL,
	"fact_key" text NOT NULL,
	"confidence" integer DEFAULT 80 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "memory_scenes" (
	"memory_scene_id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"harness_run_id" uuid NOT NULL,
	"source_type" text DEFAULT 'distill' NOT NULL,
	"scene_title" text NOT NULL,
	"scene_summary" text NOT NULL,
	"atom_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "memory_atoms_owner_project_idx" ON "memory_atoms" USING btree ("owner_user_id","project_id");--> statement-breakpoint
CREATE INDEX "memory_atoms_run_idx" ON "memory_atoms" USING btree ("harness_run_id");--> statement-breakpoint
CREATE INDEX "memory_atoms_status_idx" ON "memory_atoms" USING btree ("status");--> statement-breakpoint
CREATE INDEX "memory_atoms_project_status_idx" ON "memory_atoms" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "memory_scenes_owner_project_idx" ON "memory_scenes" USING btree ("owner_user_id","project_id");--> statement-breakpoint
CREATE INDEX "memory_scenes_run_idx" ON "memory_scenes" USING btree ("harness_run_id");--> statement-breakpoint
CREATE INDEX "memory_scenes_status_idx" ON "memory_scenes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "memory_scenes_project_status_idx" ON "memory_scenes" USING btree ("project_id","status");