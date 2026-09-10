import { sql } from 'drizzle-orm';
import { boolean, integer, pgEnum, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { idColumn, money, timestamps } from './_shared';

/** Exactly two roles (FR-003). */
export const userRole = pgEnum('user_role', ['admin', 'member']);

/**
 * One row per deployment — single workspace per deployment (spec Assumptions).
 * The ceilings here are the ones a member's own limits cannot exceed (FR-079a).
 */
export const workspaces = pgTable(
  'workspaces',
  {
    id: idColumn(),
    name: text('name').notNull(),
    modelCredentialId: text('model_credential_id'),
    designCredentialId: text('design_credential_id'),
    orchestratorBaseUrl: text('orchestrator_base_url'),
    orchestratorWorkflowId: text('orchestrator_workflow_id'),
    runnerBaseUrl: text('runner_base_url'),
    defaultCostCeilingUsd: money('default_cost_ceiling_usd').notNull().default('5.0000'),
    defaultTimeCeilingMinutes: integer('default_time_ceiling_minutes').notNull().default(45),
    maxConcurrentRuns: integer('max_concurrent_runs').notNull().default(6),
    sandboxImage: text('sandbox_image').notNull().default('code-factory/sandbox:latest'),
    sandboxCpu: integer('sandbox_cpu').notNull().default(2),
    sandboxMemoryMb: integer('sandbox_memory_mb').notNull().default(4096),
    sandboxNetworkDuringImplement: boolean('sandbox_network_during_implement')
      .notNull()
      .default(false),
    /** A sandbox's own lifetime, which reclaims one nothing else did (FR-085). */
    sandboxWallClockMinutes: integer('sandbox_wall_clock_minutes').notNull().default(90),
    retainFailedSandboxesHours: integer('retain_failed_sandboxes_hours').notNull().default(0),
    ...timestamps(),
  },
  () => [
    /**
     * One row per deployment (spec Assumptions). Without this, a second row
     * could exist and a read and a write could land on different ones — a
     * saved ceiling would silently appear not to save.
     */
    uniqueIndex('workspaces_singleton').on(sql`(true)`),
  ],
);

/**
 * `role` gates workspace credentials, connections, ceilings and membership only
 * (FR-004). It does not gate pipelines, agents or skills — those go by
 * ownership (FR-006, FR-006c).
 */
export const users = pgTable('users', {
  id: idColumn(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  avatarUrl: text('avatar_url'),
  role: userRole('role').notNull().default('member'),
  // Null for accounts that only sign in through a provider (data-model.md).
  passwordHash: text('password_hash'),
  provider: text('provider'),
  providerUserId: text('provider_user_id'),
  ...timestamps(),
});
