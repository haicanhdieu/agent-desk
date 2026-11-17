ALTER TABLE "runs" ADD COLUMN "session_ending_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "pause_reason" text;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_pause_reason_check" CHECK ("runs"."pause_reason" in ('idle_timeout','pod_lost'));