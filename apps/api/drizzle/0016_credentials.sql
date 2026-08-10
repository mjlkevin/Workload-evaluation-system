CREATE TABLE "credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_scope_unique" UNIQUE("scope")
);
--> statement-breakpoint
CREATE TABLE "credential_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"action" text NOT NULL,
	"actor" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "credential_audit_scope_idx" ON "credential_audit" USING btree ("scope");
--> statement-breakpoint
CREATE INDEX "credential_audit_at_idx" ON "credential_audit" USING btree ("at");
