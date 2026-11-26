-- Expand step, schema only: safe with the previous app live. The five old limit columns on agents stay (a later
-- contract migration drops them). CHECKs are added NOT VALID, then validated.
ALTER TABLE "agents" DROP CONSTRAINT "agents_credential_type_check";--> statement-breakpoint
ALTER TABLE "rules" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "account_label" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "last_test_status" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "last_test_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "timeout_seconds" integer DEFAULT 86400 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "paused_keep_seconds" integer DEFAULT 604800 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "done_keep_seconds" integer DEFAULT 86400 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "idle_end_seconds" integer DEFAULT 1800 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "auto_resume_max" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "agent_name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_project_default_key" ON "agents" USING btree ("project_id") WHERE "agents"."is_default";--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_name_length_check" CHECK (char_length("agents"."name") between 1 and 256) NOT VALID;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_account_label_check" CHECK ("agents"."account_label" is null or char_length("agents"."account_label") between 1 and 256) NOT VALID;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_last_test_status_check" CHECK ("agents"."last_test_status" is null or "agents"."last_test_status" in ('ok','rejected','unreachable','invalid','unsupported')) NOT VALID;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_credential_type_check" CHECK ("agents"."credential_type" in ('oauth_token','api_key','auth_json')) NOT VALID;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_timeout_check" CHECK ("projects"."timeout_seconds" between 60 and 604800) NOT VALID;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_paused_keep_check" CHECK ("projects"."paused_keep_seconds" between 3600 and 2592000) NOT VALID;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_done_keep_check" CHECK ("projects"."done_keep_seconds" between 0 and 604800) NOT VALID;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_idle_end_check" CHECK ("projects"."idle_end_seconds" between 300 and 604800) NOT VALID;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_auto_resume_max_check" CHECK ("projects"."auto_resume_max" between 0 and 10) NOT VALID;--> statement-breakpoint
ALTER TABLE "agents" VALIDATE CONSTRAINT "agents_name_length_check";
--> statement-breakpoint
ALTER TABLE "agents" VALIDATE CONSTRAINT "agents_account_label_check";
--> statement-breakpoint
ALTER TABLE "agents" VALIDATE CONSTRAINT "agents_last_test_status_check";
--> statement-breakpoint
ALTER TABLE "agents" VALIDATE CONSTRAINT "agents_credential_type_check";
--> statement-breakpoint
ALTER TABLE "projects" VALIDATE CONSTRAINT "projects_timeout_check";
--> statement-breakpoint
ALTER TABLE "projects" VALIDATE CONSTRAINT "projects_paused_keep_check";
--> statement-breakpoint
ALTER TABLE "projects" VALIDATE CONSTRAINT "projects_done_keep_check";
--> statement-breakpoint
ALTER TABLE "projects" VALIDATE CONSTRAINT "projects_idle_end_check";
--> statement-breakpoint
ALTER TABLE "projects" VALIDATE CONSTRAINT "projects_auto_resume_max_check";
