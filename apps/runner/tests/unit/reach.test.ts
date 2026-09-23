import { describe, expect, test } from 'bun:test';
import { REACH_TIMEOUT_MS } from '../../src/container/reach';
import { fetchRequirementFiles } from '../../src/container/requirements';
import { CALLBACK_TIMEOUT_MS, fetchCredentials } from '../../src/runs';
import { credentials, snapshot } from '../fake-host';

/**
 * Every request the runner makes out of its own process carries a timeout,
 * so an application that accepts the connection and then hangs fails the
 * request rather than holding the run.
 */

function recording(body: unknown) {
  const signals: (AbortSignal | null | undefined)[] = [];
  const doFetch = async (_url: string, init?: RequestInit) => {
    signals.push(init?.signal);
    return Response.json(body);
  };
  return { signals, doFetch };
}

describe('requests to the application', () => {
  test('the credentials fetch carries a timeout', async () => {
    const { signals, doFetch } = recording({ credentials });
    await fetchCredentials(snapshot, doFetch);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  test('the requirement documents fetch carries a timeout', async () => {
    const { signals, doFetch } = recording({ files: [{ name: 'brief.md', content: '# Brief' }] });
    // A ticket with a document attached; without one nothing is fetched at all.
    const withFiles = {
      ...snapshot,
      ticket: { ...snapshot.ticket, requirement_files: ['brief.md'] },
    } as unknown as typeof snapshot;
    await fetchRequirementFiles(withFiles, doFetch);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  test('one answer to how long the runner waits on the application', () => {
    expect(CALLBACK_TIMEOUT_MS).toBe(REACH_TIMEOUT_MS);
    expect(REACH_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(REACH_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
});
