CREATE TABLE "run_transcript_entries" (
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"source_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"tool" text,
	"text" text NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	CONSTRAINT "run_transcript_entries_pkey" PRIMARY KEY("run_id","seq"),
	CONSTRAINT "run_transcript_entries_source_key" UNIQUE("run_id","source_id"),
	CONSTRAINT "run_transcript_entries_kind_check" CHECK ("run_transcript_entries"."kind" in ('user','agent','tool','notice'))
);
--> statement-breakpoint
ALTER TABLE "run_transcript_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "run_transcript_entries" ADD CONSTRAINT "run_transcript_entries_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_transcript_entries_org_idx" ON "run_transcript_entries" USING btree ("org_id");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "run_transcript_entries" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- Hand-written: FORCE RLS binds the owner too; the app role gets the same grants as run_events.
ALTER TABLE "run_transcript_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "run_transcript_entries" TO agentdesk_app;
