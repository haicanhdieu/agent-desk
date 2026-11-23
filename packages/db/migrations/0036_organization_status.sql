ALTER TABLE "organization" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "runs_org_queued_idx" ON "runs" USING btree ("org_id","queued_at");--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_status_check" CHECK ("organization"."status" in ('active','suspended'));--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_suspended_at_check" CHECK (("organization"."status" = 'suspended') = ("organization"."suspended_at" is not null));