CREATE TABLE "setup_script_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setup_script_versions_project_version_key" UNIQUE("project_id","version"),
	CONSTRAINT "setup_script_versions_body_check" CHECK (octet_length("setup_script_versions"."body") <= 65536),
	CONSTRAINT "setup_script_versions_note_check" CHECK ("setup_script_versions"."note" is null or char_length("setup_script_versions"."note") <= 200)
);
--> statement-breakpoint
ALTER TABLE "setup_script_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "setup_script_versions" ADD CONSTRAINT "setup_script_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "setup_script_versions_org_idx" ON "setup_script_versions" USING btree ("org_id");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "setup_script_versions" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

-- Hand-written: FORCE RLS binds the owner too. Append-only history: the app role gets SELECT and INSERT only,
-- no UPDATE or DELETE (rows go away only through the project's ON DELETE CASCADE). project_id is indexed by the
-- unique (project_id, version) key, so no separate FK index.
ALTER TABLE "setup_script_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON setup_script_versions TO agentdesk_app;
