ALTER TABLE "agents" DROP CONSTRAINT "agents_timeout_check";--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "timeout_seconds" SET DEFAULT 86400;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_timeout_check" CHECK ("agents"."timeout_seconds" between 60 and 604800);