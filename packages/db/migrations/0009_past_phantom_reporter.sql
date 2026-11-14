ALTER TABLE "runs" DROP CONSTRAINT "runs_status_check";--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "waiting_on" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "agent_note" text;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_waiting_on_check" CHECK ("runs"."waiting_on" in ('background'));--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_status_check" CHECK ("runs"."status" in ('queued','starting','running','idle','done','succeeded','failed','cancelled','timed_out'));