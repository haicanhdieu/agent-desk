CREATE TABLE "project_env_vars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"value" text,
	"size_bytes" integer NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_env_vars_project_name_key" UNIQUE("project_id","name"),
	CONSTRAINT "project_env_vars_name_check" CHECK ("project_env_vars"."name" ~ '^[A-Za-z_][A-Za-z0-9_]*$'),
	CONSTRAINT "project_env_vars_kind_check" CHECK ("project_env_vars"."kind" in ('plain','secret')),
	CONSTRAINT "project_env_vars_value_check" CHECK (("project_env_vars"."kind" = 'plain' and "project_env_vars"."value" is not null and octet_length("project_env_vars"."value") <= 8192 and "project_env_vars"."value" !~ '[\r\n]') or ("project_env_vars"."kind" = 'secret' and "project_env_vars"."value" is null)),
	CONSTRAINT "project_env_vars_size_check" CHECK ("project_env_vars"."size_bytes" between 1 and 8320)
);
--> statement-breakpoint
ALTER TABLE "project_env_vars" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_env_vars" ADD CONSTRAINT "project_env_vars_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_env_vars_org_idx" ON "project_env_vars" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "project_env_vars_project_kind_name_idx" ON "project_env_vars" USING btree ("project_id","kind","name" COLLATE "C");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "project_env_vars" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- Hand-written: FORCE RLS binds the owner too; the app role gets DML only.
ALTER TABLE "project_env_vars" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_env_vars" TO agentdesk_app;
