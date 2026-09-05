CREATE SEQUENCE IF NOT EXISTS "public"."fts_search_sync_revision_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fts_search_sync_outbox" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dead_at" timestamp with time zone,
	"document_id" text NOT NULL,
	"entity" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"last_error" text,
	"locked_until" timestamp with time zone,
	"priority" smallint DEFAULT 10 NOT NULL,
	"revision" bigint DEFAULT nextval('fts_search_sync_revision_seq') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goal_traces" (
	"goal_id" text PRIMARY KEY NOT NULL,
	"trace_s3_key" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"final_status" text,
	"advances_total" integer,
	"ticks_total" integer,
	"advances_by_trigger" jsonb,
	"advances_by_outcome" jsonb,
	"ticks_by_branch" jsonb,
	"total_cost" numeric(20, 6),
	"work_operations" integer,
	"nodes_total" integer,
	"work_resolved" integer,
	"work_retired" integer,
	"findings_total" integer,
	"gates_opened" integer,
	"gates_resolved" integer,
	"human_waiting_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "metric_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"value" numeric(20, 6) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"operation_id" text,
	"source_type" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"key" text NOT NULL,
	"title" text,
	"kind" text DEFAULT 'gauge' NOT NULL,
	"unit" text,
	"config" jsonb,
	"metadata" jsonb,
	"deleted_at" timestamp with time zone,
	"is_deleted" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_working_directories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"device_id" uuid,
	"workspace_id" text,
	"added_by_user_id" text,
	"path" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"permission" text DEFAULT 'readWrite' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_working_directories_path_not_empty" CHECK (length(btrim("project_working_directories"."path")) > 0),
	CONSTRAINT "project_working_directories_name_not_empty" CHECK (length(btrim("project_working_directories"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trash_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"title" text,
	"meta" jsonb,
	"root_id" uuid,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"deleted_by_user_id" text,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_group_sponsored_credit_policies" DROP CONSTRAINT IF EXISTS "chat_group_sponsored_credit_policies_default_member_template_check";--> statement-breakpoint
ALTER TABLE "chat_group_user_invitations" DROP CONSTRAINT IF EXISTS "chat_group_user_invitations_sponsorship_snapshot_check";--> statement-breakpoint
ALTER TABLE "goal_nodes" DROP CONSTRAINT IF EXISTS "goal_nodes_task_requires_work_kind";--> statement-breakpoint
UPDATE "goal_nodes" SET "kind" = 'task' WHERE "kind" = 'work';--> statement-breakpoint
ALTER TABLE "agent_eval_datasets" ALTER COLUMN "benchmark_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "agent_cron_jobs" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_cron_jobs" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "chat_groups" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_groups" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "generation_batches" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_batches" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "generation_topics" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_topics" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "session_groups" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session_groups" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "project_id" text;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "project_working_directory_id" uuid;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "user_memories" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_memories" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "document_likes" DROP CONSTRAINT IF EXISTS "document_likes_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "document_likes" ADD CONSTRAINT "document_likes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_likes" DROP CONSTRAINT IF EXISTS "document_likes_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "document_likes" ADD CONSTRAINT "document_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_likes" DROP CONSTRAINT IF EXISTS "document_likes_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "document_likes" ADD CONSTRAINT "document_likes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_traces" DROP CONSTRAINT IF EXISTS "goal_traces_goal_id_goals_id_fk";--> statement-breakpoint
ALTER TABLE "goal_traces" ADD CONSTRAINT "goal_traces_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_points" DROP CONSTRAINT IF EXISTS "metric_points_metric_id_metrics_id_fk";--> statement-breakpoint
ALTER TABLE "metric_points" ADD CONSTRAINT "metric_points_metric_id_metrics_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."metrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_points" DROP CONSTRAINT IF EXISTS "metric_points_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "metric_points" ADD CONSTRAINT "metric_points_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_points" DROP CONSTRAINT IF EXISTS "metric_points_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "metric_points" ADD CONSTRAINT "metric_points_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics" DROP CONSTRAINT IF EXISTS "metrics_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics" DROP CONSTRAINT IF EXISTS "metrics_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_working_directories" DROP CONSTRAINT IF EXISTS "project_working_directories_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "project_working_directories" ADD CONSTRAINT "project_working_directories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_working_directories" DROP CONSTRAINT IF EXISTS "project_working_directories_device_id_devices_id_fk";--> statement-breakpoint
ALTER TABLE "project_working_directories" ADD CONSTRAINT "project_working_directories_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_working_directories" DROP CONSTRAINT IF EXISTS "project_working_directories_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "project_working_directories" ADD CONSTRAINT "project_working_directories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_working_directories" DROP CONSTRAINT IF EXISTS "project_working_directories_added_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "project_working_directories" ADD CONSTRAINT "project_working_directories_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trash_items" DROP CONSTRAINT IF EXISTS "trash_items_root_id_trash_items_id_fk";--> statement-breakpoint
ALTER TABLE "trash_items" ADD CONSTRAINT "trash_items_root_id_trash_items_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."trash_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trash_items" DROP CONSTRAINT IF EXISTS "trash_items_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "trash_items" ADD CONSTRAINT "trash_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trash_items" DROP CONSTRAINT IF EXISTS "trash_items_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "trash_items" ADD CONSTRAINT "trash_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trash_items" DROP CONSTRAINT IF EXISTS "trash_items_deleted_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "trash_items" ADD CONSTRAINT "trash_items_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_likes_document_id_user_id_unique" ON "document_likes" USING btree ("document_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_likes_document_id_created_at_idx" ON "document_likes" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_likes_user_id_idx" ON "document_likes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_likes_workspace_id_idx" ON "document_likes" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fts_search_sync_outbox_entity_document_id_unique" ON "fts_search_sync_outbox" USING btree ("entity","document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fts_search_sync_outbox_claim_idx" ON "fts_search_sync_outbox" USING btree ("priority","available_at","revision") WHERE "fts_search_sync_outbox"."dead_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fts_search_sync_outbox_dead_idx" ON "fts_search_sync_outbox" USING btree ("dead_at") WHERE "fts_search_sync_outbox"."dead_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fts_search_sync_outbox_lease_idx" ON "fts_search_sync_outbox" USING btree ("locked_until") WHERE "fts_search_sync_outbox"."dead_at" IS NULL AND "fts_search_sync_outbox"."locked_until" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_traces_started_at_idx" ON "goal_traces" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_traces_final_status_idx" ON "goal_traces" USING btree ("final_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metric_points_series_time_idx" ON "metric_points" USING btree ("metric_id","observed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metric_points_user_id_idx" ON "metric_points" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metric_points_workspace_id_idx" ON "metric_points" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "metrics_subject_key_unique" ON "metrics" USING btree ("subject_type","subject_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metrics_user_id_idx" ON "metrics" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metrics_workspace_id_idx" ON "metrics" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_working_directories_project_device_path_unique" ON "project_working_directories" USING btree ("project_id","device_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_working_directories_project_primary_unique" ON "project_working_directories" USING btree ("project_id") WHERE "project_working_directories"."is_primary" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_working_directories_project_sort_order_idx" ON "project_working_directories" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_working_directories_device_id_idx" ON "project_working_directories" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_working_directories_workspace_id_idx" ON "project_working_directories" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trash_items_resource_unique" ON "trash_items" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trash_items_personal_listing_idx" ON "trash_items" USING btree ("user_id","deleted_at") WHERE "trash_items"."root_id" IS NULL AND "trash_items"."workspace_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trash_items_workspace_listing_idx" ON "trash_items" USING btree ("workspace_id","deleted_at") WHERE "trash_items"."root_id" IS NULL AND "trash_items"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trash_items_expires_at_idx" ON "trash_items" USING btree ("expires_at") WHERE "trash_items"."root_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trash_items_root_id_idx" ON "trash_items" USING btree ("root_id");--> statement-breakpoint
ALTER TABLE "topics" DROP CONSTRAINT IF EXISTS "topics_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" DROP CONSTRAINT IF EXISTS "topics_project_working_directory_id_project_working_directories_id_fk";--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_project_working_directory_id_project_working_directories_id_fk" FOREIGN KEY ("project_working_directory_id") REFERENCES "public"."project_working_directories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_project_id_idx" ON "topics" USING btree ("project_id") WHERE "topics"."project_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_project_working_directory_id_idx" ON "topics" USING btree ("project_working_directory_id") WHERE "topics"."project_working_directory_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_contexts_user_memory_ids_gin_idx" ON "user_memories_contexts" USING gin ("user_memory_ids");--> statement-breakpoint
ALTER TABLE "chat_group_sponsored_credit_policies" DROP CONSTRAINT IF EXISTS "chat_group_sponsored_credit_policies_default_member_template_check";--> statement-breakpoint
ALTER TABLE "chat_group_sponsored_credit_policies" ADD CONSTRAINT "chat_group_sponsored_credit_policies_default_member_template_check" CHECK ((
        "chat_group_sponsored_credit_policies"."default_member_sponsorship_enabled" = false
        AND "chat_group_sponsored_credit_policies"."default_member_request_limit_credits" IS NULL
        AND "chat_group_sponsored_credit_policies"."default_member_period_limit_credits" IS NULL
      ) OR (
        "chat_group_sponsored_credit_policies"."default_member_sponsorship_enabled" = true
        AND "chat_group_sponsored_credit_policies"."enabled" = true
        AND "chat_group_sponsored_credit_policies"."default_member_request_limit_credits" IS NOT NULL
        AND "chat_group_sponsored_credit_policies"."default_member_period_limit_credits" IS NOT NULL
        AND "chat_group_sponsored_credit_policies"."default_member_request_limit_credits" > 0
        AND "chat_group_sponsored_credit_policies"."default_member_period_limit_credits" > 0
        AND "chat_group_sponsored_credit_policies"."default_member_request_limit_credits" <= "chat_group_sponsored_credit_policies"."default_member_period_limit_credits"
        AND "chat_group_sponsored_credit_policies"."default_member_period_limit_credits" <= "chat_group_sponsored_credit_policies"."group_period_limit_credits"
        AND "chat_group_sponsored_credit_policies"."default_member_period_limit_credits" <= 9007199254740991
      ));--> statement-breakpoint
ALTER TABLE "chat_group_user_invitations" DROP CONSTRAINT IF EXISTS "chat_group_user_invitations_sponsorship_snapshot_check";--> statement-breakpoint
ALTER TABLE "chat_group_user_invitations" ADD CONSTRAINT "chat_group_user_invitations_sponsorship_snapshot_check" CHECK ((
        "chat_group_user_invitations"."sponsorship_mode_snapshot" = 'none'
        AND "chat_group_user_invitations"."sponsor_policy_version_snapshot" IS NULL
        AND "chat_group_user_invitations"."sponsor_request_limit_credits_snapshot" IS NULL
        AND "chat_group_user_invitations"."sponsor_period_limit_credits_snapshot" IS NULL
      ) OR (
        "chat_group_user_invitations"."sponsorship_mode_snapshot" = 'group_owner'
        AND "chat_group_user_invitations"."sponsor_policy_version_snapshot" IS NOT NULL
        AND "chat_group_user_invitations"."sponsor_policy_version_snapshot" > 0
        AND "chat_group_user_invitations"."sponsor_request_limit_credits_snapshot" IS NOT NULL
        AND "chat_group_user_invitations"."sponsor_request_limit_credits_snapshot" > 0
        AND "chat_group_user_invitations"."sponsor_period_limit_credits_snapshot" IS NOT NULL
        AND "chat_group_user_invitations"."sponsor_period_limit_credits_snapshot" > 0
        AND "chat_group_user_invitations"."sponsor_request_limit_credits_snapshot" <= "chat_group_user_invitations"."sponsor_period_limit_credits_snapshot"
        AND "chat_group_user_invitations"."sponsor_period_limit_credits_snapshot" <= 9007199254740991
      ));
