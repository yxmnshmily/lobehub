CREATE TABLE "travel_service_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"balance_fen" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_service_accounts_currency_cny" CHECK ("travel_service_accounts"."currency" = 'CNY'),
	CONSTRAINT "travel_service_accounts_balance_non_negative" CHECK ("travel_service_accounts"."balance_fen" >= 0)
);
--> statement-breakpoint
CREATE TABLE "travel_service_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"operator_user_id" text,
	"order_id" uuid,
	"reversal_of_entry_id" uuid,
	"type" text NOT NULL,
	"amount_fen" integer NOT NULL,
	"balance_after_fen" integer NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_service_ledger_entries_amount_non_zero" CHECK ("travel_service_ledger_entries"."amount_fen" <> 0),
	CONSTRAINT "travel_service_ledger_entries_balance_non_negative" CHECK ("travel_service_ledger_entries"."balance_after_fen" >= 0),
	CONSTRAINT "travel_service_ledger_entries_reason_non_empty" CHECK (length(trim("travel_service_ledger_entries"."reason")) > 0),
	CONSTRAINT "travel_service_ledger_entries_type_valid" CHECK ("travel_service_ledger_entries"."type" IN ('manual_adjustment', 'reversal', 'service_charge'))
);
--> statement-breakpoint
CREATE TABLE "travel_service_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"amount_fen" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_service_orders_amount_positive" CHECK ("travel_service_orders"."amount_fen" > 0),
	CONSTRAINT "travel_service_orders_status_valid" CHECK ("travel_service_orders"."status" IN ('pending', 'completed', 'cancelled', 'refunded'))
);
--> statement-breakpoint
ALTER TABLE "travel_service_accounts" ADD CONSTRAINT "travel_service_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_service_ledger_entries" ADD CONSTRAINT "travel_service_ledger_entries_account_id_travel_service_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."travel_service_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_service_ledger_entries" ADD CONSTRAINT "travel_service_ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_service_ledger_entries" ADD CONSTRAINT "travel_service_ledger_entries_operator_user_id_users_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_service_ledger_entries" ADD CONSTRAINT "travel_service_ledger_entries_order_id_travel_service_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."travel_service_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_service_ledger_entries" ADD CONSTRAINT "travel_service_ledger_entries_reversal_of_entry_id_travel_service_ledger_entries_id_fk" FOREIGN KEY ("reversal_of_entry_id") REFERENCES "public"."travel_service_ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_service_orders" ADD CONSTRAINT "travel_service_orders_account_id_travel_service_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."travel_service_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_service_orders" ADD CONSTRAINT "travel_service_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travel_service_accounts_user_id_unique" ON "travel_service_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "travel_service_ledger_entries_account_idempotency_unique" ON "travel_service_ledger_entries" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "travel_service_ledger_entries_reversal_once_unique" ON "travel_service_ledger_entries" USING btree ("reversal_of_entry_id") WHERE "travel_service_ledger_entries"."reversal_of_entry_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "travel_service_ledger_entries_user_created_at_idx" ON "travel_service_ledger_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "travel_service_ledger_entries_account_id_idx" ON "travel_service_ledger_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "travel_service_ledger_entries_order_id_idx" ON "travel_service_ledger_entries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "travel_service_orders_user_created_at_idx" ON "travel_service_orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "travel_service_orders_account_id_idx" ON "travel_service_orders" USING btree ("account_id");
--> statement-breakpoint
INSERT INTO "travel_service_accounts" ("user_id")
SELECT "id" FROM "users"
ON CONFLICT ("user_id") DO NOTHING;
