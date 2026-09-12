CREATE TABLE IF NOT EXISTS "chat_group_invitation_links" (
  "token_hash" text PRIMARY KEY NOT NULL,
  "chat_group_id" text NOT NULL REFERENCES "chat_groups"("id") ON DELETE CASCADE,
  "inviter_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_group_invitation_links_group_idx" ON "chat_group_invitation_links" ("chat_group_id");
