ALTER TABLE "runs" ADD COLUMN "setup_script_version" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "failure_stage" text;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_failure_stage_check" CHECK ("runs"."failure_stage" in ('setup','agent'));