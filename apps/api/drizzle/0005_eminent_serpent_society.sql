CREATE TABLE "collab_workspaces" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"assessment_version_id" uuid,
	"requirement_pack_id" uuid,
	"members" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collab_messages" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_type" text NOT NULL,
	"parent_message_id" uuid,
	"sender_user_id" text,
	"sender_role" text,
	"content" text NOT NULL,
	"related_field_path" text,
	"evidence_id" uuid,
	"decision_payload" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "collab_workspaces_version_idx" ON "collab_workspaces" USING btree ("assessment_version_id");--> statement-breakpoint
CREATE INDEX "collab_workspaces_status_idx" ON "collab_workspaces" USING btree ("status");--> statement-breakpoint
CREATE INDEX "collab_messages_workspace_idx" ON "collab_messages" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "collab_messages_type_idx" ON "collab_messages" USING btree ("message_type");--> statement-breakpoint
CREATE INDEX "collab_messages_parent_idx" ON "collab_messages" USING btree ("parent_message_id");--> statement-breakpoint
CREATE INDEX "collab_messages_status_idx" ON "collab_messages" USING btree ("status");