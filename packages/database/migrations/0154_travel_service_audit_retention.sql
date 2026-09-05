ALTER TABLE "travel_service_accounts" DROP CONSTRAINT "travel_service_accounts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "travel_service_ledger_entries" DROP CONSTRAINT "travel_service_ledger_entries_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "travel_service_orders" DROP CONSTRAINT "travel_service_orders_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "travel_service_accounts" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_service_ledger_entries" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_service_orders" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_service_accounts" ADD COLUMN "user_id_snapshot" text;--> statement-breakpoint
UPDATE "travel_service_accounts"
SET "user_id_snapshot" = "user_id"
WHERE "user_id_snapshot" IS NULL;--> statement-breakpoint
ALTER TABLE "travel_service_accounts" ALTER COLUMN "user_id_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_service_orders" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
UPDATE "travel_service_orders"
SET "idempotency_key" = 'legacy-order:' || "id"::text
WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "travel_service_orders" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_service_accounts" ADD CONSTRAINT "travel_service_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_service_ledger_entries" ADD CONSTRAINT "travel_service_ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_service_orders" ADD CONSTRAINT "travel_service_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travel_service_orders_account_idempotency_unique" ON "travel_service_orders" USING btree ("account_id","idempotency_key");
