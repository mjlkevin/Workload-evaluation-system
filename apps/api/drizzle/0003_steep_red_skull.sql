CREATE TABLE "assessment_handoffs" (
	"handoff_id" uuid PRIMARY KEY NOT NULL,
	"assessment_version_id" uuid,
	"from_role" text NOT NULL,
	"to_role" text NOT NULL,
	"initiated_by_user_id" text,
	"accepted_by_user_id" text,
	"from_version_id" uuid,
	"to_version_id" uuid,
	"context_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_narratives" (
	"narrative_id" uuid PRIMARY KEY NOT NULL,
	"assessment_version_id" uuid,
	"template_id" uuid,
	"org_and_modules" text,
	"data_governance" text,
	"special_scenarios" text,
	"acceptance_scope" text,
	"timeline_and_cost" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_from" text DEFAULT 'template' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"last_edited_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliverables" (
	"deliverable_id" uuid PRIMARY KEY NOT NULL,
	"assessment_version_id" uuid,
	"deliverable_type" text NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_from" text DEFAULT 'auto' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"variance_baseline" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_gate_reviews" (
	"review_id" uuid PRIMARY KEY NOT NULL,
	"assessment_version_id" uuid,
	"reviewer_user_id" text,
	"checklist" jsonb DEFAULT '{"deliverablesComplete":false,"methodologySevenPhases":false,"rateCardCorrect":false,"narrativeComplete":false,"assumptionsDocumented":false}'::jsonb NOT NULL,
	"verdict" text,
	"rejection_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sealed_baselines" (
	"sealed_baseline_id" uuid PRIMARY KEY NOT NULL,
	"assessment_version_id" uuid NOT NULL,
	"sealed_by_user_id" text,
	"artifacts_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contract_flow_id" text,
	"seal_reason" text,
	"status" text DEFAULT 'sealed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "assessment_handoffs_version_idx" ON "assessment_handoffs" USING btree ("assessment_version_id");--> statement-breakpoint
CREATE INDEX "assessment_handoffs_from_role_idx" ON "assessment_handoffs" USING btree ("from_role");--> statement-breakpoint
CREATE INDEX "assessment_handoffs_to_role_idx" ON "assessment_handoffs" USING btree ("to_role");--> statement-breakpoint
CREATE INDEX "assessment_handoffs_status_idx" ON "assessment_handoffs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assessment_narratives_version_idx" ON "assessment_narratives" USING btree ("assessment_version_id");--> statement-breakpoint
CREATE INDEX "assessment_narratives_status_idx" ON "assessment_narratives" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deliverables_version_idx" ON "deliverables" USING btree ("assessment_version_id");--> statement-breakpoint
CREATE INDEX "deliverables_type_idx" ON "deliverables" USING btree ("deliverable_type");--> statement-breakpoint
CREATE INDEX "deliverables_status_idx" ON "deliverables" USING btree ("status");--> statement-breakpoint
CREATE INDEX "quality_gate_reviews_version_idx" ON "quality_gate_reviews" USING btree ("assessment_version_id");--> statement-breakpoint
CREATE INDEX "quality_gate_reviews_verdict_idx" ON "quality_gate_reviews" USING btree ("verdict");--> statement-breakpoint
CREATE INDEX "sealed_baselines_version_idx" ON "sealed_baselines" USING btree ("assessment_version_id");--> statement-breakpoint
CREATE INDEX "sealed_baselines_status_idx" ON "sealed_baselines" USING btree ("status");