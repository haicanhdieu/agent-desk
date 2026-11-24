CREATE TABLE "run_usage_entries" (
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_long_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer,
	"price_input" numeric(12, 6),
	"price_output" numeric(12, 6),
	"price_cache_read" numeric(12, 6),
	"price_cache_write" numeric(12, 6),
	"price_cache_write_long" numeric(12, 6),
	"price_as_of" timestamp with time zone,
	"price_source" text,
	"price_version_id" uuid,
	CONSTRAINT "run_usage_entries_pkey" PRIMARY KEY("run_id","source_id"),
	CONSTRAINT "run_usage_entries_tokens_check" CHECK ("run_usage_entries"."input_tokens" >= 0 and "run_usage_entries"."output_tokens" >= 0 and "run_usage_entries"."cache_read_tokens" >= 0 and "run_usage_entries"."cache_write_tokens" >= 0 and "run_usage_entries"."cache_write_long_tokens" >= 0 and ("run_usage_entries"."reasoning_tokens" is null or ("run_usage_entries"."reasoning_tokens" >= 0 and "run_usage_entries"."reasoning_tokens" <= "run_usage_entries"."output_tokens"))),
	CONSTRAINT "run_usage_entries_rates_check" CHECK (coalesce("run_usage_entries"."price_input", 0) >= 0 and coalesce("run_usage_entries"."price_output", 0) >= 0 and coalesce("run_usage_entries"."price_cache_read", 0) >= 0 and coalesce("run_usage_entries"."price_cache_write", 0) >= 0 and coalesce("run_usage_entries"."price_cache_write_long", 0) >= 0),
	CONSTRAINT "run_usage_entries_price_all_or_none_check" CHECK (("run_usage_entries"."price_input" is null and "run_usage_entries"."price_output" is null and "run_usage_entries"."price_cache_read" is null and "run_usage_entries"."price_cache_write" is null and "run_usage_entries"."price_cache_write_long" is null and "run_usage_entries"."price_as_of" is null and "run_usage_entries"."price_source" is null) or ("run_usage_entries"."price_input" is not null and "run_usage_entries"."price_output" is not null and "run_usage_entries"."price_cache_read" is not null and "run_usage_entries"."price_cache_write" is not null and "run_usage_entries"."price_cache_write_long" is not null and "run_usage_entries"."price_as_of" is not null and "run_usage_entries"."price_source" is not null))
);
--> statement-breakpoint
ALTER TABLE "run_usage_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "model_price_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"entry_count" integer NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_prices" (
	"version_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model_key" text NOT NULL,
	"price_input" numeric(12, 6) NOT NULL,
	"price_output" numeric(12, 6) NOT NULL,
	"price_cache_read" numeric(12, 6) NOT NULL,
	"price_cache_write" numeric(12, 6) NOT NULL,
	"price_cache_write_long" numeric(12, 6) NOT NULL,
	CONSTRAINT "model_prices_pkey" PRIMARY KEY("version_id","provider","model_key"),
	CONSTRAINT "model_prices_model_key_check" CHECK ("model_prices"."model_key" ~ '^[a-z0-9._:/@-]{1,128}$'),
	CONSTRAINT "model_prices_input_check" CHECK ("model_prices"."price_input" between 0 and 1000),
	CONSTRAINT "model_prices_output_check" CHECK ("model_prices"."price_output" between 0 and 1000),
	CONSTRAINT "model_prices_cache_read_check" CHECK ("model_prices"."price_cache_read" between 0 and 1000),
	CONSTRAINT "model_prices_cache_write_check" CHECK ("model_prices"."price_cache_write" between 0 and 1000),
	CONSTRAINT "model_prices_cache_write_long_check" CHECK ("model_prices"."price_cache_write_long" between 0 and 1000)
);
--> statement-breakpoint
ALTER TABLE "run_usage_entries" ADD CONSTRAINT "run_usage_entries_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_usage_entries" ADD CONSTRAINT "run_usage_entries_price_version_id_model_price_versions_id_fk" FOREIGN KEY ("price_version_id") REFERENCES "public"."model_price_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_prices" ADD CONSTRAINT "model_prices_version_id_model_price_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."model_price_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_usage_entries_org_idx" ON "run_usage_entries" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_price_versions_current_key" ON "model_price_versions" USING btree ("is_current") WHERE "model_price_versions"."is_current";--> statement-breakpoint
CREATE POLICY "org_isolation" ON "run_usage_entries" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- Hand-written: FORCE RLS binds the owner too; grants as in 0019. The price tables are org-less public data (worker only): versions are updatable, prices insert-only.
ALTER TABLE "run_usage_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "run_usage_entries" TO agentdesk_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "model_price_versions" TO agentdesk_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "model_prices" TO agentdesk_app;
