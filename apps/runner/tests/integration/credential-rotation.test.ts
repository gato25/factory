import { beforeEach, expect, test } from 'bun:test';
import { accepts } from '../../src/auth';
import type { RunnerConfig } from '../../src/config';
import { handlerFor } from '../../src/router';
import { memoryStore } from '../../src/runs';
import { credentials, FakeHost, snapshot } from '../fake-host';

/**
 * Replacing the credential the execution service authenticates with, without
 * failing the runs already going through it (T020, FR-018a).
 *
 * The problem is that this is a two-sided change: the service is told the new
 * credential and every caller is told the new credential, and those cannot
 * happen in the same instant. With one accepted credential, whichever side
 * moves first breaks every request until the other catches up — which means a
 * routine rotation fails runs. So both are accepted for a window, and the
 * window is closed by removing the old one.
 *
 * A run is driven ACROSS the change here rather than around it: started under
 * the old credential, stepped under the new, pushed and released after the old
 * one is withdrawn. The sandbox is the same sandbox throughout, which is the
 * part that would break if rotation had been done by restarting the service.
 */

const OLD = 'old-credential-0000';
const NEW = 'new-credential-1111';

const sandbox = {
  image: 'factory/runner:1',
  cpu: 2,
  memoryMb: 4096,
  wallClockMinutes: 60,
  // True because these fixtures run agent steps, which reach the model from
  // inside the sandbox: the isolated combination is refused at the start.
  networkDuringImplement: true,
};

let host: FakeHost;
let store: ReturnType<typeof memoryStore>;

function handlerWith(authToken: string, previousAuthToken?: string) {
  const config: RunnerConfig = {
    port: 8080,
    sandboxImage: 'factory/runner:1',
    executionHost: 'process',
    workDir: '/tmp/factory-tests',
    authToken,
    ...(previousAuthToken ? { previousAuthToken } : {}),
  };
  return handlerFor({
    config,
    host,
    store,
    probeHost: async () => ({ reachable: true, detail: 'a fake host is always reachable' }),
  });
}

const call = (
  handle: (request: Request) => Promise<Response>,
  token: string,
  method: string,
  path: string,
  body?: unknown,
) =>
  handle(
    new Request(`http://runner.internal${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );

beforeEach(() => {
  host = new FakeHost();
  store = memoryStore();
  host.files.set('/work/docs/spec.md', '# Spec');
  host.responses = [{ match: 'claude', result: { stdout: '{"total_cost_usd":0.42}' } }];
});

test('a run in flight finishes across a credential replacement (FR-018a, SC-012)', async () => {
  const runId = snapshot.run_id;

  // 1. The run starts under the credential every caller currently holds.
  const before = handlerWith(OLD);
  const started = await call(before, OLD, 'POST', `/runs/${runId}/start`, {
    snapshot,
    credentials,
    sandbox,
  });
  expect(started.status).toBe(200);
  const { container_id } = (await started.json()) as { container_id: string };

  // 2. The service is given the new credential and told to keep accepting the
  // old one. Callers have not been updated yet, so this must not break them.
  const during = handlerWith(NEW, OLD);
  const stepUnderOld = await call(during, OLD, 'POST', `/runs/${runId}/steps/0`, {
    step: snapshot.pipeline.steps[0],
  });
  expect(stepUnderOld.status).toBe(200);

  // 3. A caller that HAS been updated works against the same run and the same
  // sandbox — which is the whole point. A rotation done by restarting the
  // service would have lost the workspace here.
  const pushUnderNew = await call(during, NEW, 'POST', `/runs/${runId}/verify-and-push`);
  expect(pushUnderNew.status).toBe(200);
  expect((await store.get(runId))?.containerId).toBe(container_id);

  // 4. The window closes: the old credential is removed from configuration.
  const after = handlerWith(NEW);
  const stepUnderWithdrawn = await call(after, OLD, 'POST', `/runs/${runId}/steps/0`, {
    step: snapshot.pipeline.steps[0],
  });
  expect(stepUnderWithdrawn.status).toBe(401);

  // 5. And the run still releases cleanly under the new credential.
  const destroyed = await call(after, NEW, 'DELETE', `/runs/${runId}`);
  expect(destroyed.status).toBe(200);
  expect(await destroyed.json()).toEqual({ released: true, retainedUntil: undefined });
  expect(host.destroyed).toEqual([container_id]);
  // One sandbox for the whole run, across two credentials (FR-002, SC-012).
  expect(host.created).toHaveLength(1);
});

test('the replaced credential is refused the moment it is withdrawn', () => {
  expect(accepts(OLD, NEW, OLD)).toBe(true);
  expect(accepts(OLD, NEW)).toBe(false);
  // Closing the window by clearing the variable rather than deleting it must
  // work too, or an operator's rotation silently leaves the old one live.
  expect(accepts(OLD, NEW, '')).toBe(false);
});

test('an empty presented credential never matches an empty previous one', () => {
  // The case that would turn a cleared variable into "no authentication at
  // all": a request with no authorization header presents the empty string.
  expect(accepts('', NEW, '')).toBe(false);
  expect(accepts('', NEW, undefined)).toBe(false);
});

test('both credentials are compared whichever one matches', () => {
  // Not a timing measurement — `auth.test.ts` does that. This pins the
  // property that makes it possible: neither argument short-circuits the
  // other, so holding the current credential is not observably different
  // from holding the previous one.
  expect(accepts(NEW, NEW, OLD)).toBe(true);
  expect(accepts(OLD, NEW, OLD)).toBe(true);
  expect(accepts('neither', NEW, OLD)).toBe(false);
});
