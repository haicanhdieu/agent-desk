CREATE TABLE "setup_test_events" (
	"org_id" uuid NOT NULL,
	"setup_test_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "setup_test_events_pkey" PRIMARY KEY("setup_test_id","seq"),
	CONSTRAINT "setup_test_events_type_check" CHECK ("setup_test_events"."type" in ('lifecycle','status'))
);
--> statement-breakpoint
ALTER TABLE "setup_test_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "setup_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text NOT NULL,
	"script_sha256" text NOT NULL,
	"script_body" text,
	"checkout_sha" text,
	"plugins" jsonb DEFAULT '{"installed":[],"skipped":[],"failed":[]}'::jsonb NOT NULL,
	"exit_code" integer,
	"started_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	CONSTRAINT "setup_tests_status_check" CHECK ("setup_tests"."status" in ('queued','running','passed','failed','ended')),
	CONSTRAINT "setup_tests_script_body_check" CHECK (octet_length("setup_tests"."script_body") <= 65536)
);
--> statement-breakpoint
ALTER TABLE "setup_tests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "setup_test_events" ADD CONSTRAINT "setup_test_events_setup_test_id_setup_tests_id_fk" FOREIGN KEY ("setup_test_id") REFERENCES "public"."setup_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_tests" ADD CONSTRAINT "setup_tests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "setup_test_events_org_idx" ON "setup_test_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "setup_tests_project_created_idx" ON "setup_tests" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "setup_tests_org_idx" ON "setup_tests" USING btree ("org_id");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "setup_test_events" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "setup_tests" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

-- Hand-written: FORCE RLS binds the owner too. setup_tests is read and written by the app role (status, result,
-- script_body cleared at the end); no DELETE, rows go away through the project's ON DELETE CASCADE. setup_test_events
-- follows run_events. FK indexes: setup_tests.project_id leads setup_tests_project_created_idx, and
-- setup_test_events.setup_test_id leads its primary key.
ALTER TABLE "setup_tests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "setup_test_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "setup_tests" TO agentdesk_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "setup_test_events" TO agentdesk_app;
