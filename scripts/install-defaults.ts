#!/usr/bin/env bun
/**
 * Installs the shipped agents and the three shipped pipelines (FR-033,
 * FR-034). Idempotent: it creates what is missing and leaves alone anything
 * somebody has since changed — a re-install is not a reset.
 *
 * A fresh deployment does this by itself, when the workspace row is first
 * created. This exists for the two cases where that is not enough: a
 * deployment created before the installer existed, and one where the install
 * failed and the log said so.
 *
 *   bun run install-defaults
 */

import { createClient } from '@factory/db';
import { installDefaults } from '../apps/web/src/lib/services/install-defaults';

const { db, sql } = createClient();
const result = await installDefaults(db);

const say = (what: string, created: string[], kept: string[]) => {
  if (created.length > 0) console.log(`installed ${what}: ${created.join(', ')}`);
  if (kept.length > 0) console.log(`already there, left as they are: ${kept.join(', ')}`);
};
say('agents', result.agentsCreated, result.agentsKept);
say('pipelines', result.pipelinesCreated, result.pipelinesKept);
if (result.agentsCreated.length + result.pipelinesCreated.length === 0) {
  console.log('nothing to install');
}

await sql.end();
