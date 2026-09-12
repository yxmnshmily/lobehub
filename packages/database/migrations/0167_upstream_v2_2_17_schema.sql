-- Generated from the merged schema. Local 0165/0166 changes remain in their original migrations.
-- Preserve upstream deferred constraints and create the referenced composite key before its foreign keys.
CREATE TABLE IF NOT EXISTS "acceptance_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"acceptance_id" uuid NOT NULL,
	"author_user_id" text,
	"author_agent_id" text,
	"workspace_id" text,
	"parent_comment_id" text,
	"kind" text DEFAULT 'comment' NOT NULL,
	"anchor_type" text DEFAULT 'acceptance' NOT NULL,
	"context_run_id" uuid,
	"check_item_id" text,
	"evidence_id" uuid,
	"anchor_rect" jsonb,
	"content" text NOT NULL,
	"editor_data" jsonb,
	"attachments" jsonb,
	"client_id" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acceptance_flow_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"source_node_id" uuid NOT NULL,
	"target_node_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"condition" text,
	"required" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acceptance_flow_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"criterion_id" uuid,
	"sub_flow_id" uuid,
	"is_entry" boolean DEFAULT false NOT NULL,
	"overrides" jsonb,
	CONSTRAINT "acceptance_flow_nodes_target_check" CHECK (num_nonnulls("acceptance_flow_nodes"."criterion_id", "acceptance_flow_nodes"."sub_flow_id") = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acceptance_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"acceptance_id" uuid NOT NULL,
	"title" text NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "file_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"pathname" text NOT NULL,
	"size" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"multipart_upload_id" text,
	"multipart_part_size" integer,
	"completed_at" timestamp with time zone,
	"file_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"actor_user_id" text,
	"actor_agent_id" text,
	"type" text NOT NULL,
	"payload" jsonb,
	"visibility" text DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verify_check_results" ADD COLUMN IF NOT EXISTS "source_criterion_id" uuid;
--> statement-breakpoint
ALTER TABLE "verify_criteria" ADD COLUMN IF NOT EXISTS "definition" jsonb;
--> statement-breakpoint
ALTER TABLE "verify_criteria" ADD COLUMN IF NOT EXISTS "tags" text[] DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "verify_criteria" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "verify_runs" ADD COLUMN IF NOT EXISTS "flow_snapshots" jsonb;
--> statement-breakpoint
ALTER TABLE "acceptance_comments" DROP CONSTRAINT IF EXISTS "acceptance_comments_acceptance_id_acceptances_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD CONSTRAINT "acceptance_comments_acceptance_id_acceptances_id_fk" FOREIGN KEY ("acceptance_id") REFERENCES "public"."acceptances"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "acceptance_comments" DROP CONSTRAINT IF EXISTS "acceptance_comments_author_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD CONSTRAINT "acceptance_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "acceptance_comments" DROP CONSTRAINT IF EXISTS "acceptance_comments_author_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD CONSTRAINT "acceptance_comments_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "acceptance_comments" DROP CONSTRAINT IF EXISTS "acceptance_comments_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD CONSTRAINT "acceptance_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "acceptance_comments" DROP CONSTRAINT IF EXISTS "acceptance_comments_parent_comment_id_acceptance_comments_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD CONSTRAINT "acceptance_comments_parent_comment_id_acceptance_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."acceptance_comments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "acceptance_comments" DROP CONSTRAINT IF EXISTS "acceptance_comments_context_run_id_verify_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD CONSTRAINT "acceptance_comments_context_run_id_verify_runs_id_fk" FOREIGN KEY ("context_run_id") REFERENCES "public"."verify_runs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "acceptance_comments" DROP CONSTRAINT IF EXISTS "acceptance_comments_evidence_id_verify_evidence_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD CONSTRAINT "acceptance_comments_evidence_id_verify_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."verify_evidence"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "acceptance_comments" DROP CONSTRAINT IF EXISTS "acceptance_comments_resolved_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD CONSTRAINT "acceptance_comments_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acceptance_flow_nodes_flow_id_unique" ON "acceptance_flow_nodes" USING btree ("flow_id","id");
--> statement-breakpoint
ALTER TABLE "acceptance_flow_edges" DROP CONSTRAINT IF EXISTS "acceptance_flow_edges_flow_id_acceptance_flows_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_flow_edges" ADD CONSTRAINT "acceptance_flow_edges_flow_id_acceptance_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."acceptance_flows"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "acceptance_flow_edges" DROP CONSTRAINT IF EXISTS "acceptance_flow_edges_flow_id_source_node_id_acceptance_flow_nodes_flow_id_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_flow_edges" ADD CONSTRAINT "acceptance_flow_edges_flow_id_source_node_id_acceptance_flow_nodes_flow_id_id_fk" FOREIGN KEY ("flow_id","source_node_id") REFERENCES "public"."acceptance_flow_nodes"("flow_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "acceptance_flow_edges" DROP CONSTRAINT IF EXISTS "acceptance_flow_edges_flow_id_target_node_id_acceptance_flow_nodes_flow_id_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_flow_edges" ADD CONSTRAINT "acceptance_flow_edges_flow_id_target_node_id_acceptance_flow_nodes_flow_id_id_fk" FOREIGN KEY ("flow_id","target_node_id") REFERENCES "public"."acceptance_flow_nodes"("flow_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "acceptance_flow_nodes" DROP CONSTRAINT IF EXISTS "acceptance_flow_nodes_flow_id_acceptance_flows_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_flow_nodes" ADD CONSTRAINT "acceptance_flow_nodes_flow_id_acceptance_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."acceptance_flows"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "acceptance_flow_nodes" DROP CONSTRAINT IF EXISTS "acceptance_flow_nodes_criterion_id_verify_criteria_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_flow_nodes" ADD CONSTRAINT "acceptance_flow_nodes_criterion_id_verify_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."verify_criteria"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "acceptance_flow_nodes" DROP CONSTRAINT IF EXISTS "acceptance_flow_nodes_sub_flow_id_acceptance_flows_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_flow_nodes" ADD CONSTRAINT "acceptance_flow_nodes_sub_flow_id_acceptance_flows_id_fk" FOREIGN KEY ("sub_flow_id") REFERENCES "public"."acceptance_flows"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "acceptance_flows" DROP CONSTRAINT IF EXISTS "acceptance_flows_acceptance_id_acceptances_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_flows" ADD CONSTRAINT "acceptance_flows_acceptance_id_acceptances_id_fk" FOREIGN KEY ("acceptance_id") REFERENCES "public"."acceptances"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "file_uploads" DROP CONSTRAINT IF EXISTS "file_uploads_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "file_uploads" DROP CONSTRAINT IF EXISTS "file_uploads_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "file_uploads" DROP CONSTRAINT IF EXISTS "file_uploads_file_id_files_id_fk";
--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_activities" DROP CONSTRAINT IF EXISTS "task_activities_task_id_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_activities" DROP CONSTRAINT IF EXISTS "task_activities_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_activities" DROP CONSTRAINT IF EXISTS "task_activities_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_activities" DROP CONSTRAINT IF EXISTS "task_activities_actor_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_activities" DROP CONSTRAINT IF EXISTS "task_activities_actor_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acceptance_comments_acceptance_id_author_user_id_client_id_unique" ON "acceptance_comments" USING btree ("acceptance_id","author_user_id","client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_comments_acceptance_id_created_at_id_idx" ON "acceptance_comments" USING btree ("acceptance_id","created_at","id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_comments_parent_comment_id_idx" ON "acceptance_comments" USING btree ("parent_comment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_comments_evidence_id_idx" ON "acceptance_comments" USING btree ("evidence_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_comments_author_user_id_idx" ON "acceptance_comments" USING btree ("author_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_comments_author_agent_id_idx" ON "acceptance_comments" USING btree ("author_agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_comments_workspace_id_idx" ON "acceptance_comments" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_flow_edges_source_idx" ON "acceptance_flow_edges" USING btree ("flow_id","source_node_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_flow_edges_target_idx" ON "acceptance_flow_edges" USING btree ("flow_id","target_node_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_flow_nodes_sub_flow_idx" ON "acceptance_flow_nodes" USING btree ("sub_flow_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acceptance_flow_nodes_entry_unique" ON "acceptance_flow_nodes" USING btree ("flow_id") WHERE "acceptance_flow_nodes"."is_entry" = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_flow_nodes_criterion_idx" ON "acceptance_flow_nodes" USING btree ("criterion_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_flows_acceptance_idx" ON "acceptance_flows" USING btree ("acceptance_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_uploads_user_scope_status_idx" ON "file_uploads" USING btree ("user_id","workspace_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_uploads_workspace_status_idx" ON "file_uploads" USING btree ("workspace_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_uploads_status_expires_at_idx" ON "file_uploads" USING btree ("status","expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_uploads_status_updated_at_id_idx" ON "file_uploads" USING btree ("status","updated_at","id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "file_uploads_live_pathname_unique" ON "file_uploads" USING btree ("pathname") WHERE "file_uploads"."status" IN ('active', 'cleaning');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_activities_task_id_idx" ON "task_activities" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_activities_user_id_idx" ON "task_activities" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_activities_workspace_id_idx" ON "task_activities" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_activities_workspace_visibility_idx" ON "task_activities" USING btree ("workspace_id","visibility","user_id");
--> statement-breakpoint
ALTER TABLE "verify_check_results" DROP CONSTRAINT IF EXISTS "verify_check_results_source_criterion_id_verify_criteria_id_fk";
--> statement-breakpoint
ALTER TABLE "verify_check_results" ADD CONSTRAINT "verify_check_results_source_criterion_id_verify_criteria_id_fk" FOREIGN KEY ("source_criterion_id") REFERENCES "public"."verify_criteria"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_check_results_criterion_created_idx" ON "verify_check_results" USING btree ("source_criterion_id","created_at");
