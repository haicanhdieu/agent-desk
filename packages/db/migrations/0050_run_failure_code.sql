ALTER TABLE "runs" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_failure_code_check" CHECK ("runs"."failure_code" in ('no_credential'));