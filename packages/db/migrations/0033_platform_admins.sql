-- Platform data (ADR-0037): neither table has an org_id, and neither has RLS. They are reached only through
-- platform-scope routes, /me/access and the sign-up gate. Grants are hand-written below.
CREATE TABLE "platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"granted_by" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admins_email_key" UNIQUE("email"),
	CONSTRAINT "platform_admins_email_check" CHECK ("platform_admins"."email" = lower(btrim("platform_admins"."email")) and "platform_admins"."email" <> '')
);
--> statement-breakpoint
CREATE TABLE "platform_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "platform_audit_log_created_at_idx" ON "platform_audit_log" USING btree ("created_at","id");
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "platform_admins" TO agentdesk_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "platform_audit_log" TO agentdesk_app;
