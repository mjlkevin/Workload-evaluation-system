CREATE TABLE "execution_emergency_audits" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text,
	"workflow_id" text,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"epoch" integer NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "execution_emergency_exact_root" CHECK (num_nonnulls("execution_emergency_audits"."skill_id", "execution_emergency_audits"."workflow_id") = 1),
	CONSTRAINT "execution_emergency_valid_values" CHECK ("execution_emergency_audits"."epoch" >= 0 AND "execution_emergency_audits"."revision" > 0 AND "execution_emergency_audits"."action" IN ('stop', 'release') AND length(btrim("execution_emergency_audits"."reason")) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "skill_definitions" ADD COLUMN "emergency_stopped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_definitions" ADD COLUMN "emergency_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_definitions" ADD COLUMN "emergency_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD COLUMN "emergency_stopped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD COLUMN "emergency_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD COLUMN "emergency_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_emergency_audits" ADD CONSTRAINT "execution_emergency_audits_skill_id_skill_definitions_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill_definitions"("skill_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_emergency_audits" ADD CONSTRAINT "execution_emergency_audits_workflow_id_workflow_definitions_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow_definitions"("workflow_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION wes_reject_execution_emergency_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'EXECUTION_EMERGENCY_AUDIT_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER execution_emergency_audit_append_only BEFORE UPDATE OR DELETE ON execution_emergency_audits
FOR EACH ROW EXECUTE FUNCTION wes_reject_execution_emergency_audit_change();
