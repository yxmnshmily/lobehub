CREATE TABLE "platform_admin_operation_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_user_id" text NOT NULL,
	"target_user_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"action" text NOT NULL,
	"phase" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admin_operation_audits_action_valid" CHECK ("platform_admin_operation_audits"."action" IN ('user.profile_updated', 'user.banned', 'user.unbanned', 'user.password_reset_requested', 'user.sessions_revoked')),
	CONSTRAINT "platform_admin_operation_audits_phase_valid" CHECK ("platform_admin_operation_audits"."phase" IN ('requested', 'succeeded', 'failed')),
	CONSTRAINT "platform_admin_operation_audits_operator_user_id_non_empty" CHECK (length(trim("platform_admin_operation_audits"."operator_user_id")) BETWEEN 1 AND 255),
	CONSTRAINT "platform_admin_operation_audits_target_user_id_non_empty" CHECK (length(trim("platform_admin_operation_audits"."target_user_id")) BETWEEN 1 AND 255),
	CONSTRAINT "platform_admin_operation_audits_operation_id_non_empty" CHECK (length(trim("platform_admin_operation_audits"."operation_id")) BETWEEN 1 AND 128)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "platform_admin_operation_audits_operation_action_phase_unique" ON "platform_admin_operation_audits" USING btree ("operation_id","action","phase");--> statement-breakpoint
CREATE INDEX "platform_admin_operation_audits_target_occurred_idx" ON "platform_admin_operation_audits" USING btree ("target_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "platform_admin_operation_audits_operator_occurred_idx" ON "platform_admin_operation_audits" USING btree ("operator_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "platform_admin_operation_audits_action_occurred_idx" ON "platform_admin_operation_audits" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE FUNCTION reject_platform_admin_operation_audit_mutation()
RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'platform_admin_operation_audits is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER platform_admin_operation_audits_append_only
BEFORE UPDATE OR DELETE ON "platform_admin_operation_audits"
FOR EACH ROW EXECUTE FUNCTION reject_platform_admin_operation_audit_mutation();
