CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"handle" text NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'claude' NOT NULL,
	"model" text NOT NULL,
	"credential_secret_name" text,
	"credential_type" text,
	"credential_updated_at" timestamp with time zone,
	"credential_set_by" text,
	"max_turns" integer,
	"timeout_seconds" integer DEFAULT 1800 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_project_name_key" UNIQUE("project_id","name"),
	CONSTRAINT "agents_timeout_check" CHECK ("agents"."timeout_seconds" between 60 and 3300),
	CONSTRAINT "agents_credential_type_check" CHECK ("agents"."credential_type" in ('oauth_token','api_key'))
);
--> statement-breakpoint
ALTER TABLE "agents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"external_id" text NOT NULL,
	"account_name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"linked_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_provider_external_id_key" UNIQUE("provider","external_id"),
	CONSTRAINT "connections_status_check" CHECK ("connections"."status" in ('active','suspended','revoked'))
);
--> statement-breakpoint
ALTER TABLE "connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbound_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"channel" text NOT NULL,
	"delivery_id" text NOT NULL,
	"comment_id" text,
	"org_id" uuid,
	"project_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event" text,
	"action" text,
	"outcome" text NOT NULL,
	"ticket_ref" text,
	"author" text,
	"command" text,
	"detail" text,
	CONSTRAINT "inbound_events_provider_delivery_key" UNIQUE("provider","delivery_id"),
	CONSTRAINT "inbound_events_channel_check" CHECK ("inbound_events"."channel" in ('webhook','poll'))
);
--> statement-breakpoint
ALTER TABLE "inbound_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "poll_cursors" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"since" timestamp with time zone,
	"etag" text,
	"last_polled_at" timestamp with time zone,
	"last_error" text,
	"failures" integer DEFAULT 0 NOT NULL,
	"next_poll_at" timestamp with time zone,
	"paused_reason" text
);
--> statement-breakpoint
ALTER TABLE "poll_cursors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"repo_path" text NOT NULL,
	"code_connection_id" uuid NOT NULL,
	"board_connection_id" uuid NOT NULL,
	"trigger_mode" text DEFAULT 'webhook' NOT NULL,
	"poll_interval_seconds" integer DEFAULT 300 NOT NULL,
	"max_concurrent_runs" integer DEFAULT 2 NOT NULL,
	"max_runs_per_ticket" integer DEFAULT 5 NOT NULL,
	"setup_step" text DEFAULT 'agent' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_connection_repo_key" UNIQUE("code_connection_id","repo_path"),
	CONSTRAINT "projects_trigger_mode_check" CHECK ("projects"."trigger_mode" in ('webhook','polling')),
	CONSTRAINT "projects_poll_interval_check" CHECK ("projects"."poll_interval_seconds" in (300,600,900,1800)),
	CONSTRAINT "projects_setup_step_check" CHECK ("projects"."setup_step" in ('agent','skills','rules','ready'))
);
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"command" text NOT NULL,
	"label_filter" text[] DEFAULT '{}'::text[] NOT NULL,
	"target" text DEFAULT 'any' NOT NULL,
	"agent_id" uuid NOT NULL,
	"skill_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rules_project_command_key" UNIQUE("project_id","command"),
	CONSTRAINT "rules_target_check" CHECK ("rules"."target" in ('issue','pr','any'))
);
--> statement-breakpoint
ALTER TABLE "rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "run_events" (
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "run_events_pkey" PRIMARY KEY("run_id","seq"),
	CONSTRAINT "run_events_type_check" CHECK ("run_events"."type" in ('lifecycle','status','scrollback','comment'))
);
--> statement-breakpoint
ALTER TABLE "run_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer DEFAULT 0 NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"rule_id" uuid,
	"agent_id" uuid,
	"command" text NOT NULL,
	"skill_name" text NOT NULL,
	"ticket_ref" text NOT NULL,
	"ticket_kind" text NOT NULL,
	"ticket_number" integer,
	"ticket_title" text,
	"ticket_url" text,
	"ticket_labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checkout_ref" text NOT NULL,
	"args" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"workflow_id" text,
	"job_name" text,
	"trigger_source" text NOT NULL,
	"trigger_comment_id" text,
	"inbound_event_id" uuid,
	"triggered_by" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"idle_since" timestamp with time zone,
	"exit_code" integer,
	"failure_reason" text,
	"cost_usd" numeric(12, 4),
	"outbox" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "runs_project_trigger_comment_key" UNIQUE("project_id","trigger_comment_id"),
	CONSTRAINT "runs_project_number_key" UNIQUE("project_id","number"),
	CONSTRAINT "runs_status_check" CHECK ("runs"."status" in ('queued','starting','running','idle','succeeded','failed','cancelled','timed_out')),
	CONSTRAINT "runs_ticket_kind_check" CHECK ("runs"."ticket_kind" in ('issue','pr')),
	CONSTRAINT "runs_trigger_source_check" CHECK ("runs"."trigger_source" in ('webhook','polling','manual'))
);
--> statement-breakpoint
ALTER TABLE "runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_cursors" ADD CONSTRAINT "poll_cursors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_code_connection_id_connections_id_fk" FOREIGN KEY ("code_connection_id") REFERENCES "public"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_board_connection_id_connections_id_fk" FOREIGN KEY ("board_connection_id") REFERENCES "public"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_inbound_event_id_inbound_events_id_fk" FOREIGN KEY ("inbound_event_id") REFERENCES "public"."inbound_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "agents_org_idx" ON "agents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_at_idx" ON "audit_log" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "connections_org_idx" ON "connections" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "inbound_events_project_received_idx" ON "inbound_events" USING btree ("project_id","received_at");--> statement-breakpoint
CREATE INDEX "poll_cursors_org_idx" ON "poll_cursors" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "projects_org_idx" ON "projects" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "rules_org_idx" ON "rules" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "run_events_org_idx" ON "run_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "runs_org_idx" ON "runs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "runs_project_status_idx" ON "runs" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "runs_project_ticket_idx" ON "runs" USING btree ("project_id","ticket_ref");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "agents" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "audit_log" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "connections" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "inbound_events" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "intake_null_org_insert" ON "inbound_events" AS PERMISSIVE FOR INSERT TO public WITH CHECK (org_id is null);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "poll_cursors" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "projects" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "rules" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "run_events" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "runs" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);