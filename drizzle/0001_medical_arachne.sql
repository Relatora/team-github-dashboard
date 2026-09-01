CREATE TABLE "secrets" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"hint" text DEFAULT '' NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL
);
