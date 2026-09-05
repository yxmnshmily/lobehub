CREATE TABLE "travel_generation_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"group_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"input" jsonb NOT NULL,
	"artifacts" jsonb,
	"usage" jsonb,
	"provider" text,
	"code" text,
	"message" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "travel_generation_tasks" ADD CONSTRAINT "travel_generation_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_generation_tasks" ADD CONSTRAINT "travel_generation_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_generation_tasks" ADD CONSTRAINT "travel_generation_tasks_group_id_chat_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "travel_generation_tasks_user_id_idx" ON "travel_generation_tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "travel_generation_tasks_group_id_idx" ON "travel_generation_tasks" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "travel_generation_tasks_workspace_id_idx" ON "travel_generation_tasks" USING btree ("workspace_id");
