CREATE TYPE "public"."launch_status" AS ENUM('starting', 'running', 'failed', 'stopped');--> statement-breakpoint
CREATE TABLE "launches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"runner_launch_id" text NOT NULL,
	"branch" text NOT NULL,
	"command" text NOT NULL,
	"url" text,
	"status" "launch_status" DEFAULT 'starting' NOT NULL,
	"detail" text,
	"started_by" uuid,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "run_command" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "run_port" integer;--> statement-breakpoint
ALTER TABLE "launches" ADD CONSTRAINT "launches_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launches" ADD CONSTRAINT "launches_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launches" ADD CONSTRAINT "launches_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "launches_one_live_per_ticket" ON "launches" USING btree ("ticket_id") WHERE "launches"."stopped_at" is null;