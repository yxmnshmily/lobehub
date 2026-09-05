CREATE TABLE "platform_credit_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"user_id_snapshot" text NOT NULL,
	"balance_credits" bigint DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_credit_accounts_balance_non_negative" CHECK ("platform_credit_accounts"."balance_credits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "platform_credit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" text,
	"user_id_snapshot" text NOT NULL,
	"actor_user_id" text,
	"actor_user_id_snapshot" text,
	"operator_user_id" text,
	"reversal_of_entry_id" uuid,
	"type" text NOT NULL,
	"amount_credits" bigint NOT NULL,
	"balance_after_credits" bigint NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider" text,
	"model" text,
	"generation_id" text,
	"generation_type" text,
	"workspace_id" text,
	"token_usage" jsonb,
	"cost_usd" numeric(30, 15),
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_credit_entries_type_valid" CHECK ("platform_credit_entries"."type" IN ('top_up', 'usage_charge', 'adjustment', 'reversal')),
	CONSTRAINT "platform_credit_entries_amount_matches_type" CHECK ((
        ("platform_credit_entries"."type" = 'top_up' AND "platform_credit_entries"."amount_credits" > 0)
        OR ("platform_credit_entries"."type" = 'usage_charge' AND "platform_credit_entries"."amount_credits" <= 0)
        OR ("platform_credit_entries"."type" = 'adjustment' AND "platform_credit_entries"."amount_credits" <> 0)
        OR ("platform_credit_entries"."type" = 'reversal' AND "platform_credit_entries"."reversal_of_entry_id" IS NOT NULL)
      )),
	CONSTRAINT "platform_credit_entries_usage_metadata_complete" CHECK ("platform_credit_entries"."type" <> 'usage_charge' OR (
        "platform_credit_entries"."actor_user_id_snapshot" IS NOT NULL
        AND "platform_credit_entries"."provider" IS NOT NULL
        AND length(trim("platform_credit_entries"."provider")) > 0
        AND "platform_credit_entries"."model" IS NOT NULL
        AND length(trim("platform_credit_entries"."model")) > 0
        AND "platform_credit_entries"."generation_id" IS NOT NULL
        AND length(trim("platform_credit_entries"."generation_id")) > 0
        AND "platform_credit_entries"."token_usage" IS NOT NULL
        AND "platform_credit_entries"."cost_usd" IS NOT NULL
        AND "platform_credit_entries"."cost_usd" >= 0
      )),
	CONSTRAINT "platform_credit_entries_balance_non_negative" CHECK ("platform_credit_entries"."balance_after_credits" >= 0),
	CONSTRAINT "platform_credit_entries_reason_non_empty" CHECK (length(trim("platform_credit_entries"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "platform_credit_accounts" ADD CONSTRAINT "platform_credit_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_credit_entries" ADD CONSTRAINT "platform_credit_entries_account_id_platform_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."platform_credit_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_credit_entries" ADD CONSTRAINT "platform_credit_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_credit_entries" ADD CONSTRAINT "platform_credit_entries_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_credit_entries" ADD CONSTRAINT "platform_credit_entries_operator_user_id_users_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_credit_entries" ADD CONSTRAINT "platform_credit_entries_reversal_of_entry_id_platform_credit_entries_id_fk" FOREIGN KEY ("reversal_of_entry_id") REFERENCES "public"."platform_credit_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_credit_accounts_user_snapshot_unique" ON "platform_credit_accounts" USING btree ("user_id_snapshot");--> statement-breakpoint
CREATE INDEX "platform_credit_accounts_user_id_idx" ON "platform_credit_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_credit_entries_account_idempotency_unique" ON "platform_credit_entries" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_credit_entries_reversal_once_unique" ON "platform_credit_entries" USING btree ("reversal_of_entry_id") WHERE "platform_credit_entries"."reversal_of_entry_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "platform_credit_entries_user_created_at_idx" ON "platform_credit_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_credit_entries_actor_created_at_idx" ON "platform_credit_entries" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_credit_entries_generation_idx" ON "platform_credit_entries" USING btree ("generation_id");--> statement-breakpoint
CREATE INDEX "platform_credit_entries_type_created_at_idx" ON "platform_credit_entries" USING btree ("type","created_at");