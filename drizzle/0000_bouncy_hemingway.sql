CREATE TABLE "app_settings" (
	"user_email" text NOT NULL,
	"app" text DEFAULT 'github-dashboard' NOT NULL,
	"layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dev_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_user_email_app_pk" PRIMARY KEY("user_email","app")
);
--> statement-breakpoint
CREATE TABLE "commits" (
	"sha" text PRIMARY KEY NOT NULL,
	"repository" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"committed_at" timestamp with time zone,
	"author_login" text DEFAULT '' NOT NULL,
	"author_name" text DEFAULT '' NOT NULL,
	"author_email" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'Uncategorized' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"api_url" text DEFAULT '' NOT NULL,
	"is_merge" boolean DEFAULT false NOT NULL,
	"additions" integer,
	"deletions" integer,
	"files_changed" integer,
	"additions_raw" integer,
	"deletions_raw" integer,
	"files_changed_raw" integer,
	"stats_version" integer,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'issue' NOT NULL,
	"number" integer,
	"title" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"repository" text DEFAULT '' NOT NULL,
	"author_login" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"labels" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer,
	"title" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"repository" text DEFAULT '' NOT NULL,
	"author_login" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"labels" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_branch_cache" (
	"scope_key" text PRIMARY KEY NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer,
	"title" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"repository" text DEFAULT '' NOT NULL,
	"author_login" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone,
	"url" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"users" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"display_names" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"incomplete" boolean DEFAULT false NOT NULL,
	"message" text
);
--> statement-breakpoint
CREATE TABLE "scan_checkpoints" (
	"key" text PRIMARY KEY NOT NULL,
	"completed_repos" text[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"password_hash" text NOT NULL,
	"roles" text[] DEFAULT '{"viewer"}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "commits_author_committed_idx" ON "commits" USING btree ("author_login","committed_at");--> statement-breakpoint
CREATE INDEX "commits_repository_idx" ON "commits" USING btree ("repository");--> statement-breakpoint
CREATE INDEX "commits_category_idx" ON "commits" USING btree ("category");--> statement-breakpoint
CREATE INDEX "commits_stats_version_idx" ON "commits" USING btree ("stats_version");--> statement-breakpoint
CREATE INDEX "issues_author_created_idx" ON "issues" USING btree ("author_login","created_at");--> statement-breakpoint
CREATE INDEX "issues_repository_idx" ON "issues" USING btree ("repository");--> statement-breakpoint
CREATE INDEX "issues_type_idx" ON "issues" USING btree ("type");--> statement-breakpoint
CREATE INDEX "prs_author_created_idx" ON "pull_requests" USING btree ("author_login","created_at");--> statement-breakpoint
CREATE INDEX "reviews_author_created_idx" ON "reviews" USING btree ("author_login","created_at");--> statement-breakpoint
CREATE INDEX "runs_generated_at_idx" ON "runs" USING btree ("generated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");