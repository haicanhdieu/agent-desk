ALTER TABLE "agents" ADD COLUMN "base_url" text;--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_base_url_check" CHECK ("agents"."base_url" is null or ("agents"."base_url" like 'https://%' and char_length("agents"."base_url") <= 2048)) NOT VALID;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_model_check" CHECK ("rules"."model" is null or char_length("rules"."model") between 1 and 200) NOT VALID;--> statement-breakpoint
ALTER TABLE "agents" VALIDATE CONSTRAINT "agents_base_url_check";--> statement-breakpoint
ALTER TABLE "rules" VALIDATE CONSTRAINT "rules_model_check";
