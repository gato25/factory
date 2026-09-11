import { describe, expect, test } from 'bun:test';
import type { PipelineSnapshot } from '@factory/shared';

/**
 * User Story 1's Independent Test: a real ticket, a real sandbox, a real
 * branch pushed (T021, SC-001).
 *
 * **Excluded from `bun test` by T004**, and that exclusion is the point. Every
 * other test in this repository runs with no daemon, no account and no network
 * (FR-026). This one cannot: it exists precisely to answer the question no fake
 * can, which is whether the deployed thing works. Run it deliberately:
 *
 *   E2E_RUNNER_URL=https://factory-runner.example.workers.dev \
 *   E2E_RUNNER_AUTH_TOKEN=... \
 *   E2E_REPO_CLONE_URL=https://gitlab.com/you/scratch.git \
 *   E2E_GIT_TOKEN=... \
 *   E2E_MODEL_KEY=... \
 *   bun test apps/runner/tests/e2e
 *
 * It SKIPS rather than fails when `E2E_RUNNER_URL` is absent, because a
 * developer who runs the whole directory by accident should not see a red suite
 * for not having an account. What it must never do is pass while half
 * configured — so setting that one variable makes every other one required.
 *
 * It costs money and it creates a branch on a real repository. Point it at a
 * scratch repository, never a customer's.
 */

interface E2EConfig {
  runnerUrl: string;
  authToken: string;
  cloneUrl: string;
  gitToken: string;
  modelKey: string;
}

/**
 * One variable is the switch, and every other is then required.
 *
 * The switch matters. Keying "do I mean to run this" off the presence of any
 * runner variable trips on a `RUNNER_AUTH_TOKEN` set for ordinary local
 * development — which is exactly what happened the first time this was written.
 * So every variable here carries the `E2E_` prefix and cannot collide with a
 * deployment's own configuration. The rest being required once the switch is on
 * catches the real mistake: four of five set, the suite quietly skipping, and
 * somebody believing the hosted path was proven.
 */
const SWITCH = 'E2E_RUNNER_URL';
const ALSO_NEEDED = [
  'E2E_RUNNER_AUTH_TOKEN',
  'E2E_REPO_CLONE_URL',
  'E2E_GIT_TOKEN',
  'E2E_MODEL_KEY',
] as const;

const wanted = Boolean(process.env[SWITCH]);
const missing = ALSO_NEEDED.filter((key) => !process.env[key]);
const configured: E2EConfig | undefined =
  wanted && missing.length === 0
    ? {
        runnerUrl: (process.env[SWITCH] as string).replace(/\/$/, ''),
        authToken: process.env.E2E_RUNNER_AUTH_TOKEN as string,
        cloneUrl: process.env.E2E_REPO_CLONE_URL as string,
        gitToken: process.env.E2E_GIT_TOKEN as string,
        modelKey: process.env.E2E_MODEL_KEY as string,
      }
    : undefined;

test('asking for this run means supplying everything it needs', () => {
  if (!wanted) {
    console.info(
      `e2e: skipped — set ${SWITCH} and ${ALSO_NEEDED.join(', ')} to run a real ticket ` +
        'against a real sandbox',
    );
    return;
  }
  expect(missing, `${SWITCH} is set, so these are required too`).toEqual([]);
});

/**
 * A ticket small enough to finish in one step and specific enough that a
 * failure is unambiguous. It asks for a file with exact contents, so "the
 * agent did something else" is distinguishable from "the agent did nothing".
 */
function snapshotFor(config: E2EConfig, runId: string): PipelineSnapshot {
  const branch = `factory/e2e-${runId.slice(0, 8)}`;
  return {
    run_id: runId,
    attempt: 1,
    ticket: {
      reference: 'E2E-1',
      title: 'Add a README line naming this run',
      description:
        `Create or append to docs/e2e.md a single line reading exactly: run ${runId}. ` +
        'Change nothing else.',
      acceptance_criteria: [`docs/e2e.md contains the line "run ${runId}"`],
    },
    repo: {
      clone_url: config.cloneUrl,
      default_branch: 'main',
      branch,
      provider: 'gitlab',
      credential_ref: 'e2e',
    },
    pipeline: {
      id: 'e2e',
      version: 1,
      name: 'End to end',
      steps: [
        {
          type: 'agent',
          condition: 'always',
          agent_id: 'e2e-implement',
          output_files: ['docs/e2e.md'],
        },
      ],
    },
    agents: [
      {
        id: 'e2e-implement',
        name: 'Implement',
        prompt: 'Do exactly what the ticket asks and nothing more. Write the file, then stop.',
        skill: '',
        allowed_tools: ['Read', 'Write', 'Edit'],
      },
    ],
    limits: { cost_ceiling_usd: '1.0000', time_ceiling_minutes: 10 },
    sandbox: {
      image: 'unused-on-the-hosted-host',
      cpu: 1,
      memory_mb: 4096,
      wall_clock_minutes: 15,
      network_during_implement: true,
    },
    // Never reached: credentials are supplied in the start body below, so this
    // test needs no running application. The URL still has to parse.
    callback_url: 'https://e2e.invalid/api/hooks/n8n',
    resume_secret: 'unused-in-this-test',
  } as unknown as PipelineSnapshot;
}

describe.skipIf(!configured)('a real ticket on a real sandbox (SC-001)', () => {
  const config = configured as E2EConfig;
  const runId = crypto.randomUUID();

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${config.runnerUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.authToken}`,
        'content-type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };

  test('readiness answers before anything is spent', async () => {
    const ready = await call('GET', '/ready');
    expect(ready.status).toBe(200);
    expect((ready.body as { status: string }).status).toBe('ok');
  });

  test(
    'start, one agent step, verify-and-push, destroy',
    async () => {
      const snapshot = snapshotFor(config, runId);

      const started = await call('POST', `/runs/${runId}/start`, {
        snapshot,
        credentials: { gitToken: config.gitToken, modelKey: config.modelKey },
      });
      expect(started.status).toBe(200);
      const containerId = (started.body as { container_id: string }).container_id;
      expect(containerId).toBeTruthy();

      try {
        // A second start must return the same sandbox rather than making
        // another — the FR-008 guarantee, against a real Durable Object this
        // time rather than a `Map`.
        const again = await call('POST', `/runs/${runId}/start`, {
          snapshot,
          credentials: { gitToken: config.gitToken, modelKey: config.modelKey },
        });
        expect((again.body as { container_id: string }).container_id).toBe(containerId);

        const step = await call('POST', `/runs/${runId}/steps/0`, {
          step: snapshot.pipeline.steps[0],
        });
        expect(step.status).toBe(200);
        const outcome = step.body as { status: string; cost_usd?: string };
        expect(outcome.status).toBe('succeeded');

        // The document the step was required to produce is in the workspace,
        // which is the whole of FR-006 on a real sandbox: a separate request
        // reached the same filesystem.
        const push = await call('POST', `/runs/${runId}/verify-and-push`);
        expect(push.status).toBe(200);
        expect((push.body as { pushed: boolean }).pushed).toBe(true);
      } finally {
        // Always, even on failure: a sandbox left running costs money for as
        // long as it runs (FR-022, SC-012).
        const destroyed = await call('DELETE', `/runs/${runId}?outcome=done`);
        expect(destroyed.status).toBe(200);
        expect((destroyed.body as { released: boolean }).released).toBe(true);
      }
    },
    // A cold container, a clone and a model-driven step. Measured at ~4s cold
    // for the container alone (D15); the step is the rest.
    10 * 60_000,
  );

  test('a step for a run that was released is refused, not silently restarted', async () => {
    const step = await call('POST', `/runs/${runId}/steps/0`, {
      step: snapshotFor(config, runId).pipeline.steps[0],
    });
    expect(step.status).toBe(404);
  });
});
