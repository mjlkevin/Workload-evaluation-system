CREATE TABLE "requirement_packs" (
	"requirement_pack_id" uuid PRIMARY KEY NOT NULL,
	"source_extraction_id" uuid,
	"structured_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"industry" text,
	"scale" text,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"constraints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"owner_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sow_documents" (
	"sow_document_id" uuid PRIMARY KEY NOT NULL,
	"requirement_pack_id" uuid,
	"cloud_product" text NOT NULL,
	"module" text NOT NULL,
	"category" text,
	"description" text,
	"customization_scope" text,
	"version" text DEFAULT '1.0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"linked_assessment_version_id" uuid,
	"owner_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "initial_estimates" (
	"initial_estimate_id" uuid PRIMARY KEY NOT NULL,
	"requirement_pack_id" uuid,
	"effort_estimate" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence_scores" jsonb,
	"phase_proposal" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"owner_user_id" text,
	"reviewed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_versions" (
	"assessment_version_id" uuid PRIMARY KEY NOT NULL,
	"version_code" text NOT NULL,
	"revision_type" text DEFAULT 'initial' NOT NULL,
	"linked_sow_id" uuid,
	"linked_narrative_id" uuid,
	"owner_role" text DEFAULT 'IMPL' NOT NULL,
	"delivery_mode" text DEFAULT 'public_cloud' NOT NULL,
	"owner_user_id" text,
	"checked_out_by_user_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parent_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_versions_version_code_unique" UNIQUE("version_code")
);
--> statement-breakpoint
CREATE INDEX "requirement_packs_status_idx" ON "requirement_packs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "requirement_packs_owner_user_id_idx" ON "requirement_packs" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "sow_documents_requirement_pack_id_idx" ON "sow_documents" USING btree ("requirement_pack_id");--> statement-breakpoint
CREATE INDEX "sow_documents_status_idx" ON "sow_documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sow_documents_cloud_product_idx" ON "sow_documents" USING btree ("cloud_product");--> statement-breakpoint
CREATE INDEX "initial_estimates_requirement_pack_id_idx" ON "initial_estimates" USING btree ("requirement_pack_id");--> statement-breakpoint
CREATE INDEX "initial_estimates_status_idx" ON "initial_estimates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assessment_versions_version_code_idx" ON "assessment_versions" USING btree ("version_code");--> statement-breakpoint
CREATE INDEX "assessment_versions_status_idx" ON "assessment_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assessment_versions_owner_role_idx" ON "assessment_versions" USING btree ("owner_role");--> statement-breakpoint
CREATE INDEX "assessment_versions_linked_sow_id_idx" ON "assessment_versions" USING btree ("linked_sow_id");