ALTER TABLE "runs" ADD COLUMN "pause_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "pause_requested_by" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_pause_requested_by_users_id_fk" FOREIGN KEY ("pause_requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;