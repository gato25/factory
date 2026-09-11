import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, money, timestamps } from './_shared';
import { users } from './workspace';

export const agentKind = pgEnum('agent_kind', ['default', 'custom']);
/** Two engines behind one step vocabulary (research.md D6). */
export const agentEngine = pgEnum('agent_engine', ['claude_cli', 'design_cli']);

export const agents = pgTable('agents', {
  id: idColumn(),
  name: text('name').notNull(),
  description: text('description'),
  icon: text('icon'),
  kind: agentKind('kind').notNull().default('custom'),
  // Null for shipped defaults, which are available to every user (FR-006b).
  ownerId: uuid('owner_id').references(() => users.id),
  engine: agentEngine('engine').notNull().default('claude_cli'),
  model: text('model').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  // Empty and ignored when engine = 'design_cli' (FR-036a).
  allowedTools: text('allowed_tools').array().notNull().default([]),
  maxCostUsd: money('max_cost_usd'),
  maxMinutes: integer('max_minutes'),
  maxTurns: integer('max_turns'),
  // Shipped configuration, for Reset to default (FR-040).
  defaultConfig: jsonb('default_config'),
  ...timestamps(),
});

export const skills = pgTable('skills', {
  id: idColumn(),
  name: text('name').notNull().unique(),
  // Given to the agent so it knows when to apply the skill (FR-043).
  description: text('description').notNull(),
  content: text('content').notNull(),
  ownerId: uuid('owner_id').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  ...timestamps(),
});

/**
 * Every saved state of a skill, so a change can be read back.
 *
 * A skill is an instruction document several agents read, so "what did it say
 * last week, and who changed it?" is a question somebody asks when a run does
 * something unexpected. One row is written per save — version 1 is the skill
 * as it was created — following the same shape as `pipeline_versions`, and a
 * version can be restored by saving its content again.
 */
export const skillVersions = pgTable(
  'skill_versions',
  {
    id: idColumn(),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    content: text('content').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps(),
  },
  (t) => [uniqueIndex('skill_versions_skill_version_key').on(t.skillId, t.version)],
);

/** A skill attaches to any number of agents (FR-042). */
export const agentSkills = pgTable(
  'agent_skills',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.skillId] })],
);
