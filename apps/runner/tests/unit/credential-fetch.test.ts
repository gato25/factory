import { describe, expect, test } from 'bun:test';
import { FactoryError, type PipelineSnapshot } from '@factory/shared';
import { fetchCredentials } from '../../src/runs';

/**
 * Asking the application for a run's credentials (FR-083).
 *
 * Written from a real loss: a run picked up after a restart asked 23 ms after
 * the service began listening, while the application beside it needed a second
 * to boot. The run died of `credential_missing` before the thing it was asking
 * had opened its port, and three finished steps went with it. An application
 * that cannot be reached is now waited for; one that answers and refuses is
 * still refused at once.
 */

const snapshot = {
  run_id: 'run-1',
  resume_secret: 'secret',
  callback_url: 'http://localhost:5173/api/hooks/orchestrator',
} as unknown as PipelineSnapshot;

const good = () =>
  new Response(JSON.stringify({ credentials: { gitToken: 'git', modelKey: 'model' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** No real waiting: the delays are recorded instead. */
function clock() {
  const waited: number[] = [];
  return { waited, sleep: async (ms: number) => void waited.push(ms) };
}

describe('when the application cannot be reached yet', () => {
  test('it waits and asks again, and the run proceeds', async () => {
    const { waited, sleep } = clock();
    let calls = 0;
    const doFetch = async () => {
      calls += 1;
      if (calls < 3) throw new Error('connect ECONNREFUSED 127.0.0.1:5173');
      return good();
    };

    const credentials = await fetchCredentials(snapshot, doFetch, { sleep });

    expect(credentials.modelKey).toBe('model');
    expect(calls).toBe(3);
    expect(waited).toEqual([250, 500]);
  });

  test('it gives up eventually, naming the application and not the secret', async () => {
    const { waited, sleep } = clock();
    let calls = 0;
    const doFetch = async () => {
      calls += 1;
      throw new Error('connect ECONNREFUSED 127.0.0.1:5173');
    };

    const failure = await fetchCredentials(snapshot, doFetch, { sleep }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(FactoryError);
    expect((failure as FactoryError).reason).toBe('credential_missing');
    expect((failure as FactoryError).message).toContain('http://localhost:5173');
    expect((failure as FactoryError).message).not.toContain('secret');
    // Seven waits, eight attempts, about half a minute.
    expect(calls).toBe(8);
    expect(waited.reduce((total, ms) => total + ms, 0)).toBe(30_750);
  });
});

describe('when the application answers', () => {
  test('a refusal is not retried, because waiting will not change its mind', async () => {
    const { waited, sleep } = clock();
    let calls = 0;
    const doFetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: 'no model credential is configured' }), {
        status: 400,
      });
    };

    const failure = await fetchCredentials(snapshot, doFetch, { sleep }).catch(
      (error: unknown) => error,
    );

    expect((failure as FactoryError).message).toContain('no model credential');
    expect(calls).toBe(1);
    expect(waited).toEqual([]);
  });

  test('a rejected secret is not authorised, and is not retried either', async () => {
    let calls = 0;
    const doFetch = async () => {
      calls += 1;
      return new Response('{}', { status: 401 });
    };

    const failure = await fetchCredentials(snapshot, doFetch, { sleep: async () => {} }).catch(
      (error: unknown) => error,
    );

    expect((failure as FactoryError).reason).toBe('not_authorised');
    expect(calls).toBe(1);
  });

  test('an answer missing either credential is refused as unusable', async () => {
    const doFetch = async () =>
      new Response(JSON.stringify({ credentials: { gitToken: 'git' } }), { status: 200 });

    const failure = await fetchCredentials(snapshot, doFetch, { sleep: async () => {} }).catch(
      (error: unknown) => error,
    );

    expect((failure as FactoryError).message).toContain('no usable credentials');
  });
});
