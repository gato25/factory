import { describe, expect, test } from 'bun:test';
import { FactoryError, type PipelineSnapshot } from '@factory/shared';
import { fetchRequirementFiles, writeRequirementFiles } from '../../src/container/requirements';
import { snapshot as baseSnapshot, FakeHost } from '../fake-host';

/**
 * How a ticket's requirement documents reach a sandbox.
 *
 * Two properties matter here and neither is obvious from the code. The first
 * is that the content is FETCHED rather than carried in the snapshot, because
 * the snapshot is stored whole on every step and capped at 128 KiB on the
 * managed host. The second is that a ticket with no documents must not depend
 * on the application being reachable at all — most tickets have none, and
 * making every run wait on an extra call would be a cost paid by everybody for
 * a feature few use.
 */

const withFiles = (files: { name: string; bytes: number }[]): PipelineSnapshot => ({
  ...baseSnapshot,
  ticket: { ...baseSnapshot.ticket, requirement_files: files },
});

const answering = (status: number, body: unknown) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const doFetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, doFetch };
};

describe('collecting the documents', () => {
  test('a ticket with no documents never calls the application', async () => {
    // The ordinary case. An extra round trip on every run, for a ticket that
    // has nothing to collect, is a cost paid by everybody.
    const { calls, doFetch } = answering(200, { files: [] });
    const files = await fetchRequirementFiles(baseSnapshot, doFetch);
    expect(files).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test('the manifest in the snapshot is what decides, not a guess', async () => {
    const { calls, doFetch } = answering(200, {
      files: [{ name: 'brief.md', content: '# Brief' }],
    });
    const files = await fetchRequirementFiles(withFiles([{ name: 'brief.md', bytes: 7 }]), doFetch);
    expect(files).toEqual([{ name: 'brief.md', content: '# Brief' }]);
    expect(calls).toHaveLength(1);
  });

  test('the address is derived from the callback, and carries the run’s own secret', async () => {
    // The same exchange credentials use: authenticated as the run, never
    // through the orchestration service, which must hold neither.
    const { calls, doFetch } = answering(200, { files: [{ name: 'a.md', content: 'x' }] });
    await fetchRequirementFiles(withFiles([{ name: 'a.md', bytes: 1 }]), doFetch);
    const call = calls[0] as { url: string; init?: RequestInit };
    expect(call.url).toContain(`/api/runs/${baseSnapshot.run_id}/requirements`);
    expect(call.url).not.toContain('/api/hooks/n8n');
    const headers = (call.init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${baseSnapshot.resume_secret}`);
  });

  test('an unreachable application says so, and names only the origin', async () => {
    // The origin and not the URL: the URL has the run id in it, and an error
    // message travels further than the log does.
    const doFetch = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    let thrown: unknown;
    try {
      await fetchRequirementFiles(withFiles([{ name: 'a.md', bytes: 1 }]), doFetch);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FactoryError);
    const error = thrown as FactoryError;
    expect(error.reason).toBe('app_unreachable');
    expect(error.message).not.toContain(baseSnapshot.resume_secret);
    expect(error.message).not.toContain(baseSnapshot.run_id);
  });

  test('a refused call is told apart from an unreachable one', async () => {
    // They need different remedies: one is an address or a firewall, the
    // other is a secret that no longer matches.
    const { doFetch } = answering(401, { error: 'unauthorised' });
    const failed = fetchRequirementFiles(withFiles([{ name: 'a.md', bytes: 1 }]), doFetch);
    await expect(failed).rejects.toThrow(FactoryError);
    await failed.catch((error: FactoryError) => expect(error.reason).toBe('not_authorised'));
  });

  test('documents that were promised and did not arrive fail the run', async () => {
    // The failure this feature exists to prevent, arriving a different way.
    // Continuing would hand an agent a ticket whose brief is missing and let
    // it invent one — and the output would look like an ordinary bad run.
    const { doFetch } = answering(200, { files: [] });
    const failed = fetchRequirementFiles(withFiles([{ name: 'brief.md', bytes: 9 }]), doFetch);
    await expect(failed).rejects.toThrow(/returned none/);
  });

  test('a malformed entry is dropped rather than written as "undefined"', async () => {
    const { doFetch } = answering(200, {
      files: [{ name: 'good.md', content: 'yes' }, { name: 'no-content.md' }, { content: 'x' }],
    });
    const files = await fetchRequirementFiles(
      withFiles([
        { name: 'good.md', bytes: 3 },
        { name: 'no-content.md', bytes: 0 },
      ]),
      doFetch,
    );
    expect(files).toEqual([{ name: 'good.md', content: 'yes' }]);
  });
});

describe('writing them into the sandbox', () => {
  test('each document is written, and an index names them all', async () => {
    const host = new FakeHost();
    const written = await writeRequirementFiles(host, 'container-1', '/work', [
      { name: 'brief.md', content: '# Brief' },
      { name: 'rules.csv', content: 'a,b\n1,2\n' },
    ]);

    expect(written).toEqual(['brief.md', 'rules.csv']);
    expect(host.files.get('/work/.factory/requirements/brief.md')).toBe('# Brief');
    expect(host.files.get('/work/.factory/requirements/rules.csv')).toBe('a,b\n1,2\n');

    // The index exists because a step's prompt is written by whoever
    // configured the agent and may never mention requirements at all.
    const index = host.files.get('/work/.factory/requirements.md') as string;
    expect(index).toContain('.factory/requirements/brief.md');
    expect(index).toContain('.factory/requirements/rules.csv');
  });

  test('a name is made safe again here, not trusted from the application', async () => {
    // This service is the one holding rights on a container host. A boundary
    // that trusts its caller is not a boundary — even when the caller is us.
    const host = new FakeHost();
    await writeRequirementFiles(host, 'container-1', '/work', [
      { name: '../../etc/passwd.txt', content: 'nope' },
    ]);
    expect([...host.files.keys()]).toEqual([
      '/work/.factory/requirements/passwd.txt',
      '/work/.factory/requirements.md',
    ]);
  });

  test('nothing is written, and no directory made, when there are no documents', async () => {
    const host = new FakeHost();
    expect(await writeRequirementFiles(host, 'container-1', '/work', [])).toEqual([]);
    expect(host.files.size).toBe(0);
    expect(host.calls).toEqual([]);
  });
});
