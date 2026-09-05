CREATE TABLE "platform_moderation_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"user_id_snapshot" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"verdict" text NOT NULL,
	"categories" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"redacted_preview" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disposition" text DEFAULT 'pending' NOT NULL,
	"disposed_at" timestamp with time zone,
	"operator_user_id" text,
	CONSTRAINT "platform_moderation_audits_source_type_valid" CHECK ("platform_moderation_audits"."source_type" IN ('chat', 'copy', 'document', 'image', 'video')),
	CONSTRAINT "platform_moderation_audits_verdict_valid" CHECK ("platform_moderation_audits"."verdict" IN ('allow', 'block', 'review')),
	CONSTRAINT "platform_moderation_audits_disposition_valid" CHECK ("platform_moderation_audits"."disposition" IN ('pending', 'reviewed', 'cleared', 'ban_recommended')),
	CONSTRAINT "platform_moderation_audits_disposition_metadata" CHECK ((
        ("platform_moderation_audits"."disposition" = 'pending' AND "platform_moderation_audits"."disposed_at" IS NULL AND "platform_moderation_audits"."operator_user_id" IS NULL)
        OR ("platform_moderation_audits"."disposition" <> 'pending' AND "platform_moderation_audits"."disposed_at" IS NOT NULL AND "platform_moderation_audits"."operator_user_id" IS NOT NULL)
      )),
	CONSTRAINT "platform_moderation_audits_categories_array" CHECK (jsonb_typeof("platform_moderation_audits"."categories") = 'array'),
	CONSTRAINT "platform_moderation_audits_fingerprint_sha256" CHECK ("platform_moderation_audits"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "platform_moderation_audits_preview_length" CHECK (char_length("platform_moderation_audits"."redacted_preview") <= 240),
	CONSTRAINT "platform_moderation_audits_user_snapshot_non_empty" CHECK (length(trim("platform_moderation_audits"."user_id_snapshot")) BETWEEN 1 AND 255),
	CONSTRAINT "platform_moderation_audits_source_id_non_empty" CHECK (length(trim("platform_moderation_audits"."source_id")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "platform_moderation_audits" ADD CONSTRAINT "platform_moderation_audits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_moderation_audits_user_detected_idx" ON "platform_moderation_audits" USING btree ("user_id_snapshot","detected_at");--> statement-breakpoint
CREATE INDEX "platform_moderation_audits_disposition_detected_idx" ON "platform_moderation_audits" USING btree ("disposition","detected_at");--> statement-breakpoint
CREATE INDEX "platform_moderation_audits_verdict_detected_idx" ON "platform_moderation_audits" USING btree ("verdict","detected_at");--> statement-breakpoint
CREATE INDEX "platform_moderation_audits_source_idx" ON "platform_moderation_audits" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "platform_moderation_audits_fingerprint_idx" ON "platform_moderation_audits" USING btree ("fingerprint");