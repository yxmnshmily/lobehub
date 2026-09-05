ALTER TABLE "chat_group_sponsored_credit_policies"
ADD COLUMN "default_member_sponsorship_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_group_sponsored_credit_policies"
ADD COLUMN "default_member_request_limit_credits" bigint;--> statement-breakpoint
ALTER TABLE "chat_group_sponsored_credit_policies"
ADD COLUMN "default_member_period_limit_credits" bigint;--> statement-breakpoint
ALTER TABLE "chat_group_sponsored_credit_policies"
ADD CONSTRAINT "chat_group_sponsored_credit_policies_default_member_template_check"
CHECK (
  (
    "default_member_sponsorship_enabled" = false
    AND "default_member_request_limit_credits" IS NULL
    AND "default_member_period_limit_credits" IS NULL
  ) OR (
    "default_member_sponsorship_enabled" = true
    AND "enabled" = true
    AND "default_member_request_limit_credits" IS NOT NULL
    AND "default_member_period_limit_credits" IS NOT NULL
    AND "default_member_request_limit_credits" > 0
    AND "default_member_period_limit_credits" > 0
    AND "default_member_request_limit_credits" <= "default_member_period_limit_credits"
    AND "default_member_period_limit_credits" <= "group_period_limit_credits"
    AND "default_member_period_limit_credits" <= 9007199254740991
  )
);--> statement-breakpoint
ALTER TABLE "chat_group_user_invitations"
ADD COLUMN "sponsorship_mode_snapshot" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_group_user_invitations"
ADD COLUMN "sponsor_policy_version_snapshot" integer;--> statement-breakpoint
ALTER TABLE "chat_group_user_invitations"
ADD COLUMN "sponsor_request_limit_credits_snapshot" bigint;--> statement-breakpoint
ALTER TABLE "chat_group_user_invitations"
ADD COLUMN "sponsor_period_limit_credits_snapshot" bigint;--> statement-breakpoint
ALTER TABLE "chat_group_user_invitations"
ADD CONSTRAINT "chat_group_user_invitations_sponsorship_snapshot_check"
CHECK (
  (
    "sponsorship_mode_snapshot" = 'none'
    AND "sponsor_policy_version_snapshot" IS NULL
    AND "sponsor_request_limit_credits_snapshot" IS NULL
    AND "sponsor_period_limit_credits_snapshot" IS NULL
  ) OR (
    "sponsorship_mode_snapshot" = 'group_owner'
    AND "sponsor_policy_version_snapshot" IS NOT NULL
    AND "sponsor_policy_version_snapshot" > 0
    AND "sponsor_request_limit_credits_snapshot" IS NOT NULL
    AND "sponsor_request_limit_credits_snapshot" > 0
    AND "sponsor_period_limit_credits_snapshot" IS NOT NULL
    AND "sponsor_period_limit_credits_snapshot" > 0
    AND "sponsor_request_limit_credits_snapshot" <= "sponsor_period_limit_credits_snapshot"
    AND "sponsor_period_limit_credits_snapshot" <= 9007199254740991
  )
);--> statement-breakpoint
ALTER TABLE "chat_group_sponsored_credit_audits"
DROP CONSTRAINT "chat_group_sponsored_credit_audits_action_check";--> statement-breakpoint
ALTER TABLE "chat_group_sponsored_credit_audits"
ADD CONSTRAINT "chat_group_sponsored_credit_audits_action_check"
CHECK (
  "action" IN (
    'member_granted', 'member_limits_updated', 'member_revoked',
    'policy_disabled', 'policy_default_member_template_updated',
    'policy_enabled', 'policy_limit_updated'
  )
);
