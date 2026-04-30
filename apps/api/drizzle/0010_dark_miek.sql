CREATE TABLE "users" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "version_code_rules" (
	"rule_id" text PRIMARY KEY NOT NULL,
	"module_key" text NOT NULL,
	"module_name" text NOT NULL,
	"module_code" text NOT NULL,
	"prefix" text NOT NULL,
	"format" text NOT NULL,
	"sample" text,
	"status" text DEFAULT 'active' NOT NULL,
	"effective_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
