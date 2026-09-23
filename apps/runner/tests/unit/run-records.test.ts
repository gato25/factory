import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileRunStore } from '../../src/run-records';
import { credentials, snapshot } from '../fake-host';

/**
 * A run's record survives a restart; its credentials do not survive the
 * process (FR-016, FR-083).
 */

let dir: string;
const sandbox = {
  image: 'factory/runner:1',
  cpu: 2,
  memoryMb: 4096,
  wallClockMinutes: 60,
  networkDuringImplement: true,
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'factory-records-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the file-backed run store', () => {
  test('gives back what was put, credentials included, within one process', async () => {
    const store = fileRunStore(dir);
    await store.set(snapshot.run_id, {
      snapshot,
      sandbox,
      credentials,
      containerId: 'container-1',
      outcome: 'running',
    });
    const record = await store.get(snapshot.run_id);
    expect(record?.containerId).toBe('container-1');
    expect(record?.credentials).toEqual(credentials);
  });

  test('writes no credential to disk, ever', async () => {
    const store = fileRunStore(dir);
    await store.set(snapshot.run_id, { snapshot, sandbox, credentials, containerId: 'c-1' });
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    const text = await readFile(join(dir, files[0] as string), 'utf8');
    expect(text).not.toContain(credentials.gitToken);
    expect(text).not.toContain(credentials.modelKey);
    expect(text).not.toContain('"credentials"');
    expect(text).toContain('"containerId": "c-1"');
  });

  test('a new store on the same directory sees the record, without its credentials', async () => {
    await fileRunStore(dir).set(snapshot.run_id, {
      snapshot,
      sandbox,
      credentials,
      containerId: 'c-1',
      outcome: 'failed',
      retainedUntil: '2026-09-23T12:00:00.000Z',
    });
    // The restart: nothing in memory but the files.
    const record = await fileRunStore(dir).get(snapshot.run_id);
    expect(record).toMatchObject({
      containerId: 'c-1',
      outcome: 'failed',
      retainedUntil: '2026-09-23T12:00:00.000Z',
    });
    expect(record?.credentials).toBeUndefined();
  });

  test('deleting forgets both the file and the credentials', async () => {
    const store = fileRunStore(dir);
    await store.set(snapshot.run_id, { snapshot, sandbox, credentials, containerId: 'c-1' });
    await store.delete(snapshot.run_id);
    expect(await store.get(snapshot.run_id)).toBeUndefined();
    expect(await readdir(dir)).toEqual([]);
  });

  test('a record set without credentials drops the ones held', async () => {
    const store = fileRunStore(dir);
    await store.set(snapshot.run_id, { snapshot, sandbox, credentials, containerId: 'c-1' });
    // What `destroyRun` does for a retained sandbox: the mapping stays, the token goes.
    await store.set(snapshot.run_id, { snapshot, sandbox, containerId: 'c-1', outcome: 'failed' });
    expect((await store.get(snapshot.run_id))?.credentials).toBeUndefined();
  });

  test('an unknown run is unknown', async () => {
    expect(await fileRunStore(dir).get('nobody')).toBeUndefined();
  });
});
