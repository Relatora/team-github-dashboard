CREATE TABLE "scan_schedule" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"mode" text DEFAULT 'daily' NOT NULL,
	"interval_value" integer DEFAULT 1 NOT NULL,
	"interval_unit" text DEFAULT 'days' NOT NULL,
	"times_of_day" text[] DEFAULT '{"06:00"}' NOT NULL,
	"days_of_week" integer[] DEFAULT '{1}' NOT NULL,
	"day_of_month" integer DEFAULT 1 NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"window_mode" text DEFAULT 'rolling' NOT NULL,
	"window_days" integer DEFAULT 30 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_status" text DEFAULT '' NOT NULL,
	"last_message" text DEFAULT '' NOT NULL,
	"next_run_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracked_users" (
	"handle" text PRIMARY KEY NOT NULL,
	"display_handle" text DEFAULT '' NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"avatar_url" text DEFAULT '' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" text DEFAULT '' NOT NULL,
	"last_scanned_at" timestamp with time zone
);
