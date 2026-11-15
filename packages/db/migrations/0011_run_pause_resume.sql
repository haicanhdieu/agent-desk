ALTER TABLE "runs" DROP CONSTRAINT "runs_status_check";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "paused_keep_seconds" integer DEFAULT 604800 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "done_keep_seconds" integer DEFAULT 86400 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "session_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "runs_project_session_idx" ON "runs" USING btree ("project_id","session_expires_at");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_paused_keep_check" CHECK ("agents"."paused_keep_seconds" between 3600 and 2592000);--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_done_keep_check" CHECK ("agents"."done_keep_seconds" between 0 and 604800);--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_status_check" CHECK ("runs"."status" in ('queued','starting','running','idle','paused','done','succeeded','failed','cancelled','timed_out','expired'));