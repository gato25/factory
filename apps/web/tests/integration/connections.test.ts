import { afterAll, beforeEach, expect, test } from 'bun:test';
import { users, workspaces } from '@factory/db/schema';
import type { SessionUser } from '../../src/lib/services/auth';
import {
  readiness,
  testDesign,
  testEverything,
  testOrchestrator,
  testRunner,
} from '../../src/lib/services/connections';
import { connect, seed } from '../fixtures';

/**
 * FR-005a — a connection test that distinguishes reachable-and-authorised
 * from unreachable from unauthorised. Those three call for different actions
 * — fix the address, start the service, replace the credential — so a single
 * "failed" would leave an administrator guessing.
 *
 * The unauthorised case is the one that was wrong: the Runner probe hit
 * `/health`, which is unauthenticated by design, so a wrong token came back
 * 200 and the screen said the Runner "accepted our credential". A probe that
 * cannot fail is not a test, and this is the case an operator most needs.
 */

const { db, sql: raw } = connect();
let admin: SessionUser;
let member: SessionUser;

/** Answers as whatever the case under test needs, and records the request. */
function host(reply: (url: string, init?: RequestInit) => Response | Promise<Response>): {
  seen: { url: string; authorization: string | null }[];
  fetch: typeof fetch;
} {
  const seen: { url: string; authorization: string | null }[] = [];
  return {
    seen,
    fetch: (async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers as HeadersInit | undefined);
      seen.push({ url, authorization: headers.get('authorization') });
      return reply(url, init);
    }) as unknown as typeof fetch,
  };
}

const runnerBody = JSON.stringify({ status: 'ok', service: 'runner', container_host: 'reachable' });

beforeEach(async () => {
  const scenario = await seed(db);
  const [adminRow] = await db
    .insert(users)
    .values({ name: 'Admin', email: 'admin@netgroup.mn', role: 'admin' })
    .returning();
  if (!adminRow) throw new Error('no admin');
  admin = { id: adminRow.id, name: adminRow.name, email: adminRow.email, role: 'admin' };
  member = { id: scenario.userId, name: 'Bat', email: 'bat@netgroup.mn', role: 'member' };
});
afterAll(async () => {
  await raw.end();
});

test('nothing configured reports unconfigured, not a fault', async () => {
  const result = await testRunner(db, admin);
  expect(result.state).toBe('unconfigured');
  // An unconfigured connection is a step not yet taken, and saying "failed"
  // would send an administrator looking for a problem that is not there.
  expect(result.detail).toBe('Not configured yet.');
});

test('the runner probe sends the credential, so a wrong one can be refused', async () => {
  await db.update(workspaces).set({ runnerBaseUrl: 'http://runner:8080' });

  const probe = host(() => new Response(runnerBody, { status: 200 }));
  const result = await testRunner(db, admin, {
    fetch: probe.fetch,
    authToken: 'the-token',
  });
  expect(result.state).toBe('reachable');

  // `/ready`, not `/health`: health answers anyone, so probing it could only
  // ever report success whatever the credential was.
  expect(probe.seen).toEqual([
    { url: 'http://runner:8080/ready', authorization: 'Bearer the-token' },
  ]);
});

test('a refused credential is unauthorised, not unreachable', async () => {
  await db.update(workspaces).set({ runnerBaseUrl: 'http://runner:8080' });

  for (const status of [401, 403]) {
    const probe = host(() => new Response('unauthorised', { status }));
    const result = await testRunner(db, admin, { fetch: probe.fetch, authToken: 'wrong' });
    expect(result.state).toBe('unauthorised');
    expect(result.detail).toMatch(/refused our credential\. Replace the credential\./);
  }
});

test('something else listening on the port is wrong_shape, not reachable', async () => {
  await db.update(workspaces).set({ runnerBaseUrl: 'http://runner:8080' });
  const probe = host(() => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));

  // 200 and authorised is still not proof it is the Runner.
  const result = await testRunner(db, admin, { fetch: probe.fetch });
  expect(result.state).toBe('wrong_shape');
  expect(result.detail).toMatch(/not this service/);
});

test('nothing answering is unreachable, and a timeout says how long it waited', async () => {
  await db.update(workspaces).set({ runnerBaseUrl: 'http://runner:8080' });

  const refused = host(() => {
    throw new TypeError('fetch failed');
  });
  expect((await testRunner(db, admin, { fetch: refused.fetch })).state).toBe('unreachable');

  const slow = host((_url, init) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  });
  const timedOut = await testRunner(db, admin, { fetch: slow.fetch, timeoutMs: 20 });
  expect(timedOut.state).toBe('unreachable');
  expect(timedOut.detail).toMatch(/within 20ms/);
});

test('a degraded runner still counts as reachable, because the credential worked', async () => {
  await db.update(workspaces).set({ runnerBaseUrl: 'http://runner:8080' });
  const probe = host(
    () =>
      new Response(
        JSON.stringify({
          status: 'degraded',
          service: 'runner',
          container_host: 'unreachable',
        }),
        { status: 200 },
      ),
  );
  // A Runner that cannot reach its container host is a different problem
  // from a wrong address or a wrong token, and reporting it as either would
  // send somebody to change the thing that is right.
  expect((await testRunner(db, admin, { fetch: probe.fetch })).state).toBe('reachable');
});

test('an unexpected status names the status rather than guessing', async () => {
  await db.update(workspaces).set({ runnerBaseUrl: 'http://runner:8080' });
  const probe = host(() => new Response('gateway', { status: 502 }));
  const result = await testRunner(db, admin, { fetch: probe.fetch });
  expect(result.state).toBe('unreachable');
  expect(result.detail).toMatch(/It answered 502/);
});

test('the orchestrator is probed at its own health route', async () => {
  await db.update(workspaces).set({ orchestratorBaseUrl: 'http://n8n:5678/' });
  const probe = host(() => new Response('ok', { status: 200 }));
  expect((await testOrchestrator(db, admin, { fetch: probe.fetch })).state).toBe('reachable');
  // The trailing slash is not doubled: an address an administrator typed
  // should work whether or not they ended it with one.
  expect(probe.seen[0]?.url).toBe('http://n8n:5678/healthz');
});

test('the design service is only a problem for a pipeline that needs it', async () => {
  const result = await testDesign(db, admin);
  expect(result.state).toBe('unconfigured');
  expect(result.detail).toMatch(/only a problem for a pipeline containing a design step/);
});

test('testing everything reports all three, whatever each one says', async () => {
  await db.update(workspaces).set({ runnerBaseUrl: 'http://runner:8080' });
  const probe = host((url) =>
    url.includes('/ready')
      ? new Response('no', { status: 401 })
      : new Response('ok', { status: 200 }),
  );
  const results = await testEverything(db, admin, { fetch: probe.fetch });
  expect(results.map((r) => r.what)).toEqual(['orchestrator', 'runner', 'design']);
  expect(results.map((r) => r.state)).toEqual(['unconfigured', 'unauthorised', 'unconfigured']);
});

test('a member cannot test connections, because the address is a workspace setting', async () => {
  await expect(testRunner(db, member)).rejects.toThrow();
  await expect(testEverything(db, member)).rejects.toThrow();
  await expect(testEverything(db, null)).rejects.toThrow();
});

test('readiness names what is missing rather than only refusing', async () => {
  const before = await readiness(db);
  expect(before.ready).toBe(false);
  expect(before.missing).toEqual([
    'the orchestration service address',
    'the runner address',
    'a model credential',
  ]);

  await db.update(workspaces).set({
    orchestratorBaseUrl: 'http://n8n:5678',
    runnerBaseUrl: 'http://runner:8080',
    modelCredentialId: null,
  });
  const after = await readiness(db);
  expect(after.missing).toEqual(['a model credential']);
});
