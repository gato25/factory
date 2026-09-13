import { integer, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from './_shared';
import { users } from './workspace';

export const credentialKind = pgEnum('credential_kind', ['git', 'model', 'design']);
export const credentialStatus = pgEnum('credential_status', ['valid', 'invalid', 'unverified']);

/**
 * `provider` is a two-value enum on purpose: a third value is what FR-014b
 * must refuse. Only GitLab.com and GitHub.com are in scope (FR-014a).
 */
export const gitProvider = pgEnum('git_provider', ['gitlab', 'github']);
export const repositoryStatus = pgEnum('repository_status', [
  'connected',
  'credential_expired',
  'error',
]);

/**
 * Never readable back in plaintext through any interface (FR-011, FR-084).
 * The application holds the key; the Runner receives resolved values per run.
 */
export const credentials = pgTable('credentials', {
  id: idColumn(),
  kind: credentialKind('kind').notNull(),
  ciphertext: text('ciphertext').notNull(),
  keyVersion: text('key_version').notNull(),
  lastVerifiedAt: text('last_verified_at'),
  status: credentialStatus('status').notNull().default('unverified'),
  createdBy: uuid('created_by').references(() => users.id),
  ...timestamps(),
});

/** `status <> 'connected'` blocks new runs (FR-013). */
export const repositories = pgTable('repositories', {
  id: idColumn(),
  name: text('name').notNull(),
  fullPath: text('full_path').notNull(),
  provider: gitProvider('provider').notNull(),
  cloneUrl: text('clone_url').notNull(),
  defaultBranch: text('default_branch').notNull().default('main'),
  credentialId: uuid('credential_id').references(() => credentials.id),
  defaultPipelineId: uuid('default_pipeline_id'),
  status: repositoryStatus('status').notNull().default('connected'),
  statusDetail: text('status_detail'),
  /**
   * How to start this project for a launch (003 FR-005). Null means "detect
   * it from the workspace"; a value overrides detection entirely. Set once
   * per repository, because a wrong guess should cost one edit rather than a
   * failed start every time.
   */
  runCommand: text('run_command'),
  runPort: integer('run_port'),
  ...timestamps(),
});
