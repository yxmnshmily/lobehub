ALTER TABLE "messenger_account_links" ADD COLUMN IF NOT EXISTS "active_group_id" text REFERENCES "chat_groups"("id") ON DELETE SET NULL;
