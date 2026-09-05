CREATE TABLE "platform_credit_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" text,
	"user_id_snapshot" text NOT NULL,
	"workspace_id" text,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"authorized_credits" bigint NOT NULL,
	"consumed_credits" bigint DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"lease_version" bigint DEFAULT 1 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_credit_budgets_amounts_valid" CHECK ("platform_credit_budgets"."authorized_credits" > 0 AND "platform_credit_budgets"."consumed_credits" >= 0 AND "platform_credit_budgets"."consumed_credits" <= "platform_credit_budgets"."authorized_credits"),
	CONSTRAINT "platform_credit_budgets_status_valid" CHECK ("platform_credit_budgets"."status" IN ('active', 'settled', 'released', 'expired')),
	CONSTRAINT "platform_credit_budgets_lease_valid" CHECK ("platform_credit_budgets"."lease_version" > 0),
	CONSTRAINT "platform_credit_budgets_identity_non_empty" CHECK (
      length(trim("platform_credit_budgets"."user_id_snapshot")) > 0
      AND length(trim("platform_credit_budgets"."source_type")) > 0
      AND length(trim("platform_credit_budgets"."source_id")) > 0
      AND length(trim("platform_credit_budgets"."idempotency_key")) > 0
      AND length(trim("platform_credit_budgets"."request_hash")) > 0
    )
);
--> statement-breakpoint
CREATE TABLE "platform_credit_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"generation_id" text NOT NULL,
	"generation_type" text,
	"call_kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"workspace_id" text,
	"idempotency_key" text NOT NULL,
	"reserved_credits" bigint NOT NULL,
	"settled_credits" bigint DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"lease_version" bigint DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"provider_request_id" text,
	"actual_usage" jsonb,
	"usage_entry_id" uuid,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_credit_reservations_amounts_valid" CHECK ("platform_credit_reservations"."reserved_credits" > 0 AND "platform_credit_reservations"."settled_credits" >= 0 AND "platform_credit_reservations"."settled_credits" <= "platform_credit_reservations"."reserved_credits"),
	CONSTRAINT "platform_credit_reservations_call_kind_valid" CHECK ("platform_credit_reservations"."call_kind" IN ('call_llm', 'compress_context', 'image')),
	CONSTRAINT "platform_credit_reservations_status_valid" CHECK ("platform_credit_reservations"."status" IN ('reserved', 'provider_started', 'provider_completed', 'settled', 'released', 'expired')),
	CONSTRAINT "platform_credit_reservations_completion_valid" CHECK ((
        "platform_credit_reservations"."status" NOT IN ('provider_completed', 'settled')
        OR "platform_credit_reservations"."actual_usage" IS NOT NULL
      ) AND ("platform_credit_reservations"."status" <> 'settled' OR "platform_credit_reservations"."usage_entry_id" IS NOT NULL)),
	CONSTRAINT "platform_credit_reservations_lease_valid" CHECK ("platform_credit_reservations"."lease_version" > 0),
	CONSTRAINT "platform_credit_reservations_identity_non_empty" CHECK (
      length(trim("platform_credit_reservations"."generation_id")) > 0
      AND length(trim("platform_credit_reservations"."provider")) > 0
      AND length(trim("platform_credit_reservations"."model")) > 0
      AND length(trim("platform_credit_reservations"."idempotency_key")) > 0
    )
);
--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ADD CONSTRAINT "platform_credit_budgets_account_id_platform_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."platform_credit_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ADD CONSTRAINT "platform_credit_budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_credit_reservations" ADD CONSTRAINT "platform_credit_reservations_budget_id_platform_credit_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."platform_credit_budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_credit_reservations" ADD CONSTRAINT "platform_credit_reservations_account_id_platform_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."platform_credit_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_credit_reservations" ADD CONSTRAINT "platform_credit_reservations_usage_entry_id_platform_credit_entries_id_fk" FOREIGN KEY ("usage_entry_id") REFERENCES "public"."platform_credit_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_credit_budgets_account_idempotency_unique" ON "platform_credit_budgets" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "platform_credit_budgets_account_status_idx" ON "platform_credit_budgets" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "platform_credit_budgets_status_expires_at_idx" ON "platform_credit_budgets" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_credit_reservations_account_idempotency_unique" ON "platform_credit_reservations" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_credit_reservations_usage_entry_unique" ON "platform_credit_reservations" USING btree ("usage_entry_id") WHERE "platform_credit_reservations"."usage_entry_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "platform_credit_reservations_budget_status_idx" ON "platform_credit_reservations" USING btree ("budget_id","status");--> statement-breakpoint
CREATE INDEX "platform_credit_reservations_status_expires_at_idx" ON "platform_credit_reservations" USING btree ("status","expires_at");
