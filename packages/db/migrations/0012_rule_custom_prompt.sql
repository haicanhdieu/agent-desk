ALTER TABLE "rules" ALTER COLUMN "skill_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "skill_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "final_prompt" text;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_skill_or_prompt_check" CHECK (("rules"."skill_name" is null) <> ("rules"."prompt" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_prompt_length_check" CHECK (char_length("rules"."prompt") <= 4000) NOT VALID;--> statement-breakpoint
ALTER TABLE "rules" VALIDATE CONSTRAINT "rules_skill_or_prompt_check";--> statement-breakpoint
ALTER TABLE "rules" VALIDATE CONSTRAINT "rules_prompt_length_check";
