CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"project_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invited_by" text NOT NULL,
	"accepted_by" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_scope_type_check" CHECK ("invitations"."scope_type" in ('org','project')),
	CONSTRAINT "invitations_status_check" CHECK ("invitations"."status" in ('pending','accepted','revoked','expired')),
	CONSTRAINT "invitations_scope_check" CHECK (("invitations"."scope_type" = 'org' and "invitations"."project_ids" = '{}') or ("invitations"."scope_type" = 'project' and cardinality("invitations"."project_ids") >= 1))
);
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"project_id" uuid,
	"granted_by" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_assignments_org_user_role_project_key" UNIQUE NULLS NOT DISTINCT("org_id","user_id","role_id","project_id"),
	CONSTRAINT "role_assignments_scope_type_check" CHECK ("role_assignments"."scope_type" in ('org','project')),
	CONSTRAINT "role_assignments_scope_check" CHECK (("role_assignments"."scope_type" = 'org' and "role_assignments"."project_id" is null) or ("role_assignments"."scope_type" = 'project' and "role_assignments"."project_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "role_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"org_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"condition" text DEFAULT 'any' NOT NULL,
	CONSTRAINT "role_permissions_pkey" PRIMARY KEY("role_id","permission"),
	CONSTRAINT "role_permissions_condition_check" CHECK ("role_permissions"."condition" in ('any','own'))
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "role_template_permissions" (
	"template_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"condition" text DEFAULT 'any' NOT NULL,
	CONSTRAINT "role_template_permissions_pkey" PRIMARY KEY("template_id","permission"),
	CONSTRAINT "role_template_permissions_condition_check" CHECK ("role_template_permissions"."condition" in ('any','own'))
);
--> statement-breakpoint
CREATE TABLE "role_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"assignable_scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_templates_key_key" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"built_in" boolean DEFAULT false NOT NULL,
	"template_id" uuid,
	"assignable_scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_org_id_key_key" UNIQUE("org_id","key"),
	CONSTRAINT "roles_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "origin_run_id" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_role_fkey" FOREIGN KEY ("org_id","role_id") REFERENCES "public"."roles"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_org_role_fkey" FOREIGN KEY ("org_id","role_id") REFERENCES "public"."roles"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_org_role_fkey" FOREIGN KEY ("org_id","role_id") REFERENCES "public"."roles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_template_permissions" ADD CONSTRAINT "role_template_permissions_template_id_role_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."role_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_template_id_role_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."role_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_org_email_pending_key" ON "invitations" USING btree ("org_id","email") WHERE "invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "invitations_email_pending_idx" ON "invitations" USING btree ("email") WHERE "invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "invitations_org_role_idx" ON "invitations" USING btree ("org_id","role_id");--> statement-breakpoint
CREATE INDEX "role_assignments_org_user_idx" ON "role_assignments" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "role_assignments_user_id_idx" ON "role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "role_assignments_project_idx" ON "role_assignments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "role_assignments_org_role_idx" ON "role_assignments" USING btree ("org_id","role_id");--> statement-breakpoint
CREATE INDEX "role_permissions_org_idx" ON "role_permissions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "roles_template_id_idx" ON "roles" USING btree ("template_id");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_origin_run_id_runs_id_fk" FOREIGN KEY ("origin_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_owner_user_idx" ON "runs" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "runs_origin_run_id_idx" ON "runs" USING btree ("origin_run_id");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "invitations" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "role_assignments" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "role_permissions" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "roles" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);