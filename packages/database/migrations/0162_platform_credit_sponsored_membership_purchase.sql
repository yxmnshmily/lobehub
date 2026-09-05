DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "platform_credit_budgets"
		GROUP BY "account_id", "source_type", "source_id"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'platform_credit_budgets contains duplicate account source identities'
			USING ERRCODE = '23505';
	END IF;
END $$;--> statement-breakpoint
CREATE TABLE "chat_group_sponsored_credit_audits" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_group_id_snapshot" text NOT NULL,
	"actor_user_id_snapshot" text NOT NULL,
	"payer_user_id_snapshot" text NOT NULL,
	"target_user_id_snapshot" text,
	"action" text NOT NULL,
	"enabled" boolean,
	"group_period_limit_credits" bigint,
	"member_request_limit_credits" bigint,
	"member_period_limit_credits" bigint,
	"policy_version" integer,
	"membership_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_group_sponsored_credit_audits_action_check" CHECK ("chat_group_sponsored_credit_audits"."action" IN (
        'member_granted', 'member_limits_updated', 'member_revoked',
        'policy_disabled', 'policy_enabled', 'policy_limit_updated'
      )),
	CONSTRAINT "chat_group_sponsored_credit_audits_limit_check" CHECK (("chat_group_sponsored_credit_audits"."group_period_limit_credits" IS NULL OR ("chat_group_sponsored_credit_audits"."group_period_limit_credits" > 0 AND "chat_group_sponsored_credit_audits"."group_period_limit_credits" <= 9007199254740991))
        AND ("chat_group_sponsored_credit_audits"."member_request_limit_credits" IS NULL OR ("chat_group_sponsored_credit_audits"."member_request_limit_credits" > 0 AND "chat_group_sponsored_credit_audits"."member_request_limit_credits" <= 9007199254740991))
        AND ("chat_group_sponsored_credit_audits"."member_period_limit_credits" IS NULL OR ("chat_group_sponsored_credit_audits"."member_period_limit_credits" > 0 AND "chat_group_sponsored_credit_audits"."member_period_limit_credits" <= 9007199254740991))),
	CONSTRAINT "chat_group_sponsored_credit_audits_version_check" CHECK (("chat_group_sponsored_credit_audits"."policy_version" IS NULL OR "chat_group_sponsored_credit_audits"."policy_version" > 0)
        AND ("chat_group_sponsored_credit_audits"."membership_version" IS NULL OR "chat_group_sponsored_credit_audits"."membership_version" > 0)),
	CONSTRAINT "chat_group_sponsored_credit_audits_identity_check" CHECK (length(trim("chat_group_sponsored_credit_audits"."chat_group_id_snapshot")) > 0
        AND length(trim("chat_group_sponsored_credit_audits"."actor_user_id_snapshot")) > 0
        AND length(trim("chat_group_sponsored_credit_audits"."payer_user_id_snapshot")) > 0)
);
--> statement-breakpoint
CREATE TABLE "chat_group_sponsored_credit_policies" (
	"chat_group_id" text PRIMARY KEY NOT NULL,
	"payer_account_id" uuid NOT NULL,
	"payer_user_id" text,
	"payer_user_id_snapshot" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"group_period_limit_credits" bigint NOT NULL,
	"period_started_at" timestamp with time zone NOT NULL,
	"period_ends_at" timestamp with time zone NOT NULL,
	"period_duration_seconds" integer NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_group_sponsored_credit_policies_limits_check" CHECK ("chat_group_sponsored_credit_policies"."group_period_limit_credits" > 0 AND "chat_group_sponsored_credit_policies"."group_period_limit_credits" <= 9007199254740991),
	CONSTRAINT "chat_group_sponsored_credit_policies_period_check" CHECK ("chat_group_sponsored_credit_policies"."period_duration_seconds" > 0 AND "chat_group_sponsored_credit_policies"."period_duration_seconds" <= 31536000
        AND "chat_group_sponsored_credit_policies"."period_ends_at" > "chat_group_sponsored_credit_policies"."period_started_at"),
	CONSTRAINT "chat_group_sponsored_credit_policies_version_check" CHECK ("chat_group_sponsored_credit_policies"."policy_version" > 0),
	CONSTRAINT "chat_group_sponsored_credit_policies_identity_check" CHECK (length(trim("chat_group_sponsored_credit_policies"."payer_user_id_snapshot")) > 0)
);
--> statement-breakpoint
CREATE TABLE "chat_group_user_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_group_id" text NOT NULL,
	"inviter_user_id" text NOT NULL,
	"invitee_user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_group_user_invitations_role_check" CHECK ("chat_group_user_invitations"."role" = 'member'),
	CONSTRAINT "chat_group_user_invitations_status_check" CHECK ("chat_group_user_invitations"."status" IN ('pending', 'accepted', 'revoked', 'expired')),
	CONSTRAINT "chat_group_user_invitations_token_hash_check" CHECK ("chat_group_user_invitations"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "chat_group_user_memberships" (
	"chat_group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"invited_by_user_id" text,
	"role" text DEFAULT 'member' NOT NULL,
	"can_use_paid_ai" boolean DEFAULT false NOT NULL,
	"max_credits_per_request" bigint,
	"max_credits_per_period" bigint,
	"membership_version" integer DEFAULT 1 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_group_user_memberships_chat_group_id_user_id_pk" PRIMARY KEY("chat_group_id","user_id"),
	CONSTRAINT "chat_group_user_memberships_role_check" CHECK ("chat_group_user_memberships"."role" = 'member'),
	CONSTRAINT "chat_group_user_memberships_paid_ai_limits_check" CHECK ((
        "chat_group_user_memberships"."can_use_paid_ai" = false
        AND "chat_group_user_memberships"."max_credits_per_request" IS NULL
        AND "chat_group_user_memberships"."max_credits_per_period" IS NULL
      ) OR (
        "chat_group_user_memberships"."can_use_paid_ai" = true
        AND "chat_group_user_memberships"."max_credits_per_request" IS NOT NULL
        AND "chat_group_user_memberships"."max_credits_per_period" IS NOT NULL
        AND "chat_group_user_memberships"."max_credits_per_request" > 0
        AND "chat_group_user_memberships"."max_credits_per_period" > 0
        AND "chat_group_user_memberships"."max_credits_per_request" <= "chat_group_user_memberships"."max_credits_per_period"
        AND "chat_group_user_memberships"."max_credits_per_period" <= 9007199254740991
      )),
	CONSTRAINT "chat_group_user_memberships_version_check" CHECK ("chat_group_user_memberships"."membership_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "platform_credit_payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"provider_payment_id" text NOT NULL,
	"merchant_order_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"processing_status" text NOT NULL,
	"review_reason" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_credit_payment_events_status_valid" CHECK ("platform_credit_payment_events"."processing_status" IN ('accepted', 'review_required')),
	CONSTRAINT "platform_credit_payment_events_amount_positive" CHECK ("platform_credit_payment_events"."amount_minor" > 0),
	CONSTRAINT "platform_credit_payment_events_currency_valid" CHECK ("platform_credit_payment_events"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "platform_credit_payment_events_identity_non_empty" CHECK (
      length(trim("platform_credit_payment_events"."provider")) > 0
      AND length(trim("platform_credit_payment_events"."event_id")) > 0
      AND length(trim("platform_credit_payment_events"."event_type")) > 0
      AND length(trim("platform_credit_payment_events"."provider_payment_id")) > 0
      AND length(trim("platform_credit_payment_events"."merchant_order_id")) > 0
    )
);
--> statement-breakpoint
CREATE TABLE "platform_credit_purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_order_id" text NOT NULL,
	"user_id" text,
	"user_id_snapshot" text NOT NULL,
	"product_id" text NOT NULL,
	"credits" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"refund_status" text DEFAULT 'none' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"payment_provider" text,
	"provider_payment_id" text,
	"credit_entry_id" uuid,
	"expires_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_credit_purchase_orders_status_valid" CHECK ("platform_credit_purchase_orders"."status" IN ('created', 'payment_pending', 'payment_failed', 'paid', 'credited', 'cancelled', 'expired', 'review_required')),
	CONSTRAINT "platform_credit_purchase_orders_refund_status_valid" CHECK ("platform_credit_purchase_orders"."refund_status" IN ('none', 'requested', 'review_required', 'refunded')),
	CONSTRAINT "platform_credit_purchase_orders_amounts_positive" CHECK ("platform_credit_purchase_orders"."credits" > 0 AND "platform_credit_purchase_orders"."amount_minor" > 0),
	CONSTRAINT "platform_credit_purchase_orders_currency_valid" CHECK ("platform_credit_purchase_orders"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "platform_credit_purchase_orders_version_positive" CHECK ("platform_credit_purchase_orders"."version" > 0),
	CONSTRAINT "platform_credit_purchase_orders_credit_entry_consistent" CHECK (("platform_credit_purchase_orders"."status" = 'credited' AND "platform_credit_purchase_orders"."credit_entry_id" IS NOT NULL)
        OR ("platform_credit_purchase_orders"."status" <> 'credited' AND "platform_credit_purchase_orders"."credit_entry_id" IS NULL)),
	CONSTRAINT "platform_credit_purchase_orders_payment_identity_complete" CHECK ("platform_credit_purchase_orders"."status" NOT IN ('paid', 'credited') OR (
        "platform_credit_purchase_orders"."payment_provider" IS NOT NULL
        AND length(trim("platform_credit_purchase_orders"."payment_provider")) > 0
        AND "platform_credit_purchase_orders"."provider_payment_id" IS NOT NULL
        AND length(trim("platform_credit_purchase_orders"."provider_payment_id")) > 0
      )),
	CONSTRAINT "platform_credit_purchase_orders_unpaid_identity_empty" CHECK ("platform_credit_purchase_orders"."status" NOT IN ('created', 'payment_pending', 'cancelled', 'expired', 'payment_failed')
        OR ("platform_credit_purchase_orders"."payment_provider" IS NULL AND "platform_credit_purchase_orders"."provider_payment_id" IS NULL)),
	CONSTRAINT "platform_credit_purchase_orders_identity_non_empty" CHECK (
      length(trim("platform_credit_purchase_orders"."merchant_order_id")) > 0
      AND length(trim("platform_credit_purchase_orders"."user_id_snapshot")) > 0
      AND length(trim("platform_credit_purchase_orders"."product_id")) > 0
      AND length(trim("platform_credit_purchase_orders"."idempotency_key")) > 0
    )
);
--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" DROP CONSTRAINT "platform_credit_budgets_identity_non_empty";--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ADD COLUMN "actor_user_id" text;--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ADD COLUMN "actor_user_id_snapshot" text;--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ADD COLUMN "authorization_kind" text;--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ADD COLUMN "sponsor_chat_group_id_snapshot" text;--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ADD COLUMN "sponsor_policy_version_snapshot" integer;--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ADD COLUMN "sponsor_membership_version_snapshot" integer;--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ADD COLUMN "sponsor_period_started_at_snapshot" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ADD COLUMN "sponsor_period_ends_at_snapshot" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ADD COLUMN "sponsor_group_period_limit_credits_snapshot" bigint;--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ADD COLUMN "sponsor_member_period_limit_credits_snapshot" bigint;--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ADD COLUMN "sponsor_member_request_limit_credits_snapshot" bigint;--> statement-breakpoint
UPDATE "platform_credit_budgets"
SET
	"actor_user_id" = COALESCE(
		"user_id",
		(SELECT "users"."id" FROM "users" WHERE "users"."id" = "platform_credit_budgets"."user_id_snapshot")
	),
	"actor_user_id_snapshot" = "user_id_snapshot",
	"authorization_kind" = 'self';--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ALTER COLUMN "actor_user_id_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ALTER COLUMN "authorization_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_group_sponsored_credit_policies" ADD CONSTRAINT "chat_group_sponsored_credit_policies_chat_group_id_chat_groups_id_fk" FOREIGN KEY ("chat_group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_sponsored_credit_policies" ADD CONSTRAINT "chat_group_sponsored_credit_policies_payer_account_id_platform_credit_accounts_id_fk" FOREIGN KEY ("payer_account_id") REFERENCES "public"."platform_credit_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_sponsored_credit_policies" ADD CONSTRAINT "chat_group_sponsored_credit_policies_payer_user_id_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_user_invitations" ADD CONSTRAINT "chat_group_user_invitations_chat_group_id_chat_groups_id_fk" FOREIGN KEY ("chat_group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_user_invitations" ADD CONSTRAINT "chat_group_user_invitations_inviter_user_id_users_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_user_invitations" ADD CONSTRAINT "chat_group_user_invitations_invitee_user_id_users_id_fk" FOREIGN KEY ("invitee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_user_memberships" ADD CONSTRAINT "chat_group_user_memberships_chat_group_id_chat_groups_id_fk" FOREIGN KEY ("chat_group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_user_memberships" ADD CONSTRAINT "chat_group_user_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_user_memberships" ADD CONSTRAINT "chat_group_user_memberships_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_credit_payment_events" ADD CONSTRAINT "platform_credit_payment_events_order_id_platform_credit_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."platform_credit_purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_credit_purchase_orders" ADD CONSTRAINT "platform_credit_purchase_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_credit_purchase_orders" ADD CONSTRAINT "platform_credit_purchase_orders_credit_entry_id_platform_credit_entries_id_fk" FOREIGN KEY ("credit_entry_id") REFERENCES "public"."platform_credit_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_group_sponsored_credit_audits_group_created_idx" ON "chat_group_sponsored_credit_audits" USING btree ("chat_group_id_snapshot","created_at");--> statement-breakpoint
CREATE INDEX "chat_group_sponsored_credit_policies_payer_account_idx" ON "chat_group_sponsored_credit_policies" USING btree ("payer_account_id");--> statement-breakpoint
CREATE INDEX "chat_group_sponsored_credit_policies_enabled_idx" ON "chat_group_sponsored_credit_policies" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_group_user_invitations_token_hash_unique" ON "chat_group_user_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_group_user_invitations_pending_unique" ON "chat_group_user_invitations" USING btree ("chat_group_id","invitee_user_id") WHERE "chat_group_user_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "chat_group_user_invitations_invitee_status_idx" ON "chat_group_user_invitations" USING btree ("invitee_user_id","status");--> statement-breakpoint
CREATE INDEX "chat_group_user_memberships_user_id_idx" ON "chat_group_user_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_credit_payment_events_provider_event_unique" ON "platform_credit_payment_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_credit_payment_events_provider_payment_unique" ON "platform_credit_payment_events" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "platform_credit_payment_events_order_created_at_idx" ON "platform_credit_payment_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_credit_purchase_orders_merchant_order_unique" ON "platform_credit_purchase_orders" USING btree ("merchant_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_credit_purchase_orders_user_idempotency_unique" ON "platform_credit_purchase_orders" USING btree ("user_id_snapshot","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_credit_purchase_orders_credit_entry_unique" ON "platform_credit_purchase_orders" USING btree ("credit_entry_id") WHERE "platform_credit_purchase_orders"."credit_entry_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_credit_purchase_orders_provider_payment_unique" ON "platform_credit_purchase_orders" USING btree ("payment_provider","provider_payment_id") WHERE "platform_credit_purchase_orders"."payment_provider" IS NOT NULL AND "platform_credit_purchase_orders"."provider_payment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "platform_credit_purchase_orders_user_created_at_idx" ON "platform_credit_purchase_orders" USING btree ("user_id_snapshot","created_at");--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ADD CONSTRAINT "platform_credit_budgets_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_credit_budgets_account_source_unique" ON "platform_credit_budgets" USING btree ("account_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "platform_credit_budgets_actor_status_idx" ON "platform_credit_budgets" USING btree ("actor_user_id","status");--> statement-breakpoint
CREATE INDEX "platform_credit_budgets_sponsor_group_period_status_idx" ON "platform_credit_budgets" USING btree ("sponsor_chat_group_id_snapshot","sponsor_period_started_at_snapshot","status");--> statement-breakpoint
CREATE INDEX "platform_credit_budgets_sponsor_actor_period_status_idx" ON "platform_credit_budgets" USING btree ("sponsor_chat_group_id_snapshot","actor_user_id_snapshot","sponsor_period_started_at_snapshot","status");--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ADD CONSTRAINT "platform_credit_budgets_authorization_kind_valid" CHECK ("platform_credit_budgets"."authorization_kind" IN ('self', 'group_member_sponsored'));--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ADD CONSTRAINT "platform_credit_budgets_authorization_snapshot_valid" CHECK ((
        "platform_credit_budgets"."authorization_kind" = 'self'
        AND "platform_credit_budgets"."actor_user_id_snapshot" = "platform_credit_budgets"."user_id_snapshot"
        AND "platform_credit_budgets"."sponsor_chat_group_id_snapshot" IS NULL
        AND "platform_credit_budgets"."sponsor_policy_version_snapshot" IS NULL
        AND "platform_credit_budgets"."sponsor_membership_version_snapshot" IS NULL
        AND "platform_credit_budgets"."sponsor_period_started_at_snapshot" IS NULL
        AND "platform_credit_budgets"."sponsor_period_ends_at_snapshot" IS NULL
        AND "platform_credit_budgets"."sponsor_group_period_limit_credits_snapshot" IS NULL
        AND "platform_credit_budgets"."sponsor_member_period_limit_credits_snapshot" IS NULL
        AND "platform_credit_budgets"."sponsor_member_request_limit_credits_snapshot" IS NULL
      ) OR (
        "platform_credit_budgets"."authorization_kind" = 'group_member_sponsored'
        AND "platform_credit_budgets"."actor_user_id_snapshot" <> "platform_credit_budgets"."user_id_snapshot"
        AND "platform_credit_budgets"."sponsor_chat_group_id_snapshot" IS NOT NULL
        AND length(trim("platform_credit_budgets"."sponsor_chat_group_id_snapshot")) > 0
        AND "platform_credit_budgets"."sponsor_policy_version_snapshot" IS NOT NULL
        AND "platform_credit_budgets"."sponsor_policy_version_snapshot" > 0
        AND "platform_credit_budgets"."sponsor_membership_version_snapshot" IS NOT NULL
        AND "platform_credit_budgets"."sponsor_membership_version_snapshot" > 0
        AND "platform_credit_budgets"."sponsor_period_started_at_snapshot" IS NOT NULL
        AND "platform_credit_budgets"."sponsor_period_ends_at_snapshot" IS NOT NULL
        AND "platform_credit_budgets"."sponsor_period_ends_at_snapshot" > "platform_credit_budgets"."sponsor_period_started_at_snapshot"
        AND "platform_credit_budgets"."sponsor_group_period_limit_credits_snapshot" IS NOT NULL
        AND "platform_credit_budgets"."sponsor_group_period_limit_credits_snapshot" > 0
        AND "platform_credit_budgets"."sponsor_group_period_limit_credits_snapshot" <= 9007199254740991
        AND "platform_credit_budgets"."sponsor_member_period_limit_credits_snapshot" IS NOT NULL
        AND "platform_credit_budgets"."sponsor_member_period_limit_credits_snapshot" > 0
        AND "platform_credit_budgets"."sponsor_member_period_limit_credits_snapshot" <= 9007199254740991
        AND "platform_credit_budgets"."sponsor_member_request_limit_credits_snapshot" IS NOT NULL
        AND "platform_credit_budgets"."sponsor_member_request_limit_credits_snapshot" > 0
        AND "platform_credit_budgets"."sponsor_member_request_limit_credits_snapshot" <= "platform_credit_budgets"."sponsor_member_period_limit_credits_snapshot"
        AND "platform_credit_budgets"."sponsor_member_request_limit_credits_snapshot" <= "platform_credit_budgets"."sponsor_group_period_limit_credits_snapshot"
      ));--> statement-breakpoint
ALTER TABLE "platform_credit_budgets" ADD CONSTRAINT "platform_credit_budgets_identity_non_empty" CHECK (
      length(trim("platform_credit_budgets"."user_id_snapshot")) > 0
      AND length(trim("platform_credit_budgets"."actor_user_id_snapshot")) > 0
      AND length(trim("platform_credit_budgets"."source_type")) > 0
      AND length(trim("platform_credit_budgets"."source_id")) > 0
      AND length(trim("platform_credit_budgets"."idempotency_key")) > 0
      AND length(trim("platform_credit_budgets"."request_hash")) > 0
    );
