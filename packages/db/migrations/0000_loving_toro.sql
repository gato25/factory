CREATE TYPE "public"."agent_engine" AS ENUM('claude_cli', 'design_cli');--> statement-breakpoint
CREATE TYPE "public"."agent_kind" AS ENUM('default', 'custom');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('approved', 'changes_requested', 'edited', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."artifact_kind" AS ENUM('document', 'design_file', 'screen', 'commits', 'merge_request');--> statement-breakpoint
CREATE TYPE "public"."log_stream" AS ENUM('stdout', 'stderr');--> statement-breakpoint
CREATE TYPE "public"."credential_kind" AS ENUM('git', 'model', 'design');--> statement-breakpoint
CREATE TYPE "public"."credential_status" AS ENUM('valid', 'invalid', 'unverified');--> statement-breakpoint
CREATE TYPE "public"."git_provider" AS ENUM('gitlab', 'github');--> statement-breakpoint
CREATE TYPE "public"."repository_status" AS ENUM('connected', 'credential_expired', 'error');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'waiting_approval', 'opening_mr', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('pending', 'running', 'done', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('draft', 'queued', 'running', 'waiting_approval', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TABLE "agent_skills" (
	"agent_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	CONSTRAINT "agent_skills_agent_id_skill_id_pk" PRIMARY KEY("agent_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"kind" "agent_kind" DEFAULT 'custom' NOT NULL,
	"owner_id" uuid,
	"engine" "agent_engine" DEFAULT 'claude_cli' NOT NULL,
	"model" text NOT NULL,
	"system_prompt" text NOT NULL,
	"allowed_tools" text[] DEFAULT '{}' NOT NULL,
	"max_cost_usd" numeric(10, 4),
	"max_minutes" integer,
	"max_turns" integer,
	"default_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"content" text NOT NULL,
	"owner_id" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"decided_by" uuid,
	"decision" "approval_decision" NOT NULL,
	"feedback" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"timed_out" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"kind" "artifact_kind" NOT NULL,
	"path" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content" text,
	"bytes" "bytea",
	"screen_name" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "log_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"seq" integer NOT NULL,
	"stream" "log_stream" DEFAULT 'stdout' NOT NULL,
	"text" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"steps" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_id" uuid,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "credential_kind" NOT NULL,
	"ciphertext" text NOT NULL,
	"key_version" text NOT NULL,
	"last_verified_at" text,
	"status" "credential_status" DEFAULT 'unverified' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"full_path" text NOT NULL,
	"provider" "git_provider" NOT NULL,
	"clone_url" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"credential_id" uuid,
	"default_pipeline_id" uuid,
	"status" "repository_status" DEFAULT 'connected' NOT NULL,
	"status_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"current_step_index" integer,
	"orchestrator_execution_id" text,
	"resume_url" text,
	"container_id" text,
	"runner_image" text,
	"cost_usd" numeric(10, 4) DEFAULT '0.0000' NOT NULL,
	"cost_ceiling_usd" numeric(10, 4) NOT NULL,
	"time_ceiling_minutes" integer NOT NULL,
	"failure_reason" text,
	"failure_step_index" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"status" "step_status" DEFAULT 'pending' NOT NULL,
	"condition_not_met" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_s" integer,
	"cost_usd" numeric(10, 4) DEFAULT '0.0000' NOT NULL,
	"engine_session_id" text,
	"summary" text,
	"log_ref" text,
	"error_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"acceptance_criteria" text[] DEFAULT '{}' NOT NULL,
	"pipeline_id" uuid,
	"pipeline_version" integer,
	"status" "ticket_status" DEFAULT 'draft' NOT NULL,
	"current_run_id" uuid,
	"branch_name" text,
	"merge_request_url" text,
	"has_ui" boolean,
	"ui_rationale" text,
	"classification_missing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"avatar_url" text,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"password_hash" text,
	"provider" text,
	"provider_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"model_credential_id" text,
	"design_credential_id" text,
	"orchestrator_base_url" text,
	"orchestrator_workflow_id" text,
	"runner_base_url" text,
	"default_cost_ceiling_usd" numeric(10, 4) DEFAULT '5.0000' NOT NULL,
	"default_time_ceiling_minutes" integer DEFAULT 45 NOT NULL,
	"max_concurrent_runs" integer DEFAULT 6 NOT NULL,
	"sandbox_image" text DEFAULT 'code-factory/sandbox:latest' NOT NULL,
	"sandbox_cpu" integer DEFAULT 2 NOT NULL,
	"sandbox_memory_mb" integer DEFAULT 4096 NOT NULL,
	"sandbox_network_during_implement" boolean DEFAULT false NOT NULL,
	"retain_failed_sandboxes_hours" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_chunks" ADD CONSTRAINT "log_chunks_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_versions" ADD CONSTRAINT "pipeline_versions_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_versions" ADD CONSTRAINT "pipeline_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_results" ADD CONSTRAINT "step_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_run_step_key" ON "approvals" USING btree ("run_id","step_index");--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_run_path_version_key" ON "artifacts" USING btree ("run_id","path","version");--> statement-breakpoint
CREATE UNIQUE INDEX "log_chunks_run_step_seq_key" ON "log_chunks" USING btree ("run_id","step_index","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_versions_pipeline_version_key" ON "pipeline_versions" USING btree ("pipeline_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_ticket_attempt_key" ON "runs" USING btree ("ticket_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_one_active_per_ticket" ON "runs" USING btree ("ticket_id") WHERE "runs"."status" in ('queued', 'running', 'waiting_approval', 'opening_mr');--> statement-breakpoint
CREATE UNIQUE INDEX "step_results_run_step_key" ON "step_results" USING btree ("run_id","step_index");