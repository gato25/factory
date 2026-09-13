import { beforeEach, expect, test } from 'bun:test';
import { MAX_TOTAL_BYTES } from '@factory/shared';
import { startRun } from '../../src/lib/services/run';
import {
  attachFiles,
  fileManifest,
  listFiles,
  readFiles,
  removeFile,
} from '../../src/lib/services/ticket-files';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * Requirement documents attached to a ticket, and what a run does with them.
 *
 * The property worth the most here is the last one: a document attached after
 * a run has started does not reach that run. That is the same rule the
 * pipeline, the agents and the ceilings already follow — a snapshot is
 * resolved once and never re-read (FR-044) — and it is what lets somebody
 * attach a corrected brief without wondering whether they have just changed
 * what a run in flight is building.
 */

const { db } = connect();
let scenario: Scenario;
const base = { callbackBaseUrl: 'https://factory.example' };

beforeEach(async () => {
  scenario = await seed(db);
});

const brief = (content = '# Brief\n\nBuild the thing.') => ({ name: 'brief.md', content });
/** Computed, because a hand-counted byte length fails for the wrong reason. */
const bytesOf = (content: string) => new TextEncoder().encode(content).length;

test('an attached document is listed with its size, and its content is readable', async () => {
  await attachFiles(db, scenario.ticketId, [brief()], scenario.userId);

  const listed = await listFiles(db, scenario.ticketId);
  expect(listed).toHaveLength(1);
  expect(listed[0]?.name).toBe('brief.md');
  expect(listed[0]?.contentType).toBe('text/markdown');
  // Bytes, not characters — a limit measured in characters would let a
  // document of multi-byte text be several times what the limit claims.
  expect(listed[0]?.bytes).toBe(bytesOf(brief().content));

  expect(await readFiles(db, scenario.ticketId)).toEqual([
    { name: 'brief.md', content: brief().content },
  ]);
});

test('a name that would escape the requirements directory is stored made safe', async () => {
  // The stored name becomes a path inside a sandbox. Making it safe at the
  // boundary rather than at the point of use means every later reader gets
  // the safe one without having to remember to ask for it.
  await attachFiles(
    db,
    scenario.ticketId,
    [{ name: '../../etc/passwd.txt', content: 'nope' }],
    scenario.userId,
  );
  expect((await listFiles(db, scenario.ticketId))[0]?.name).toBe('passwd.txt');
});

test('re-attaching the same name replaces it rather than storing two', async () => {
  await attachFiles(db, scenario.ticketId, [brief('first')], scenario.userId);
  await attachFiles(db, scenario.ticketId, [brief('second, corrected')], scenario.userId);

  const listed = await listFiles(db, scenario.ticketId);
  expect(listed).toHaveLength(1);
  expect((await readFiles(db, scenario.ticketId))[0]?.content).toBe('second, corrected');
});

test('two files picked at once whose safe names collide keep the last', async () => {
  // Two files of the same name from different folders. Storing both would
  // violate the unique index; refusing the whole upload would be worse than
  // the thing a person plainly meant.
  await attachFiles(
    db,
    scenario.ticketId,
    [
      { name: '/a/notes.md', content: 'from a' },
      { name: '/b/notes.md', content: 'from b' },
    ],
    scenario.userId,
  );
  const listed = await listFiles(db, scenario.ticketId);
  expect(listed).toHaveLength(1);
  expect((await readFiles(db, scenario.ticketId))[0]?.content).toBe('from b');
});

test('a document that is not text is refused, and nothing is stored', async () => {
  const failed = attachFiles(
    db,
    scenario.ticketId,
    [{ name: 'brief.txt', content: '%PDF-1.4\u0000\u0000\u0000binary' }],
    scenario.userId,
  );
  await expect(failed).rejects.toThrow(/not readable as text/);
  expect(await listFiles(db, scenario.ticketId)).toEqual([]);
});

test('a refused upload leaves earlier documents untouched', async () => {
  // The whole upload fails, and what was already there is still there. A
  // partially applied upload would be the worst outcome: neither the old set
  // nor the new one.
  await attachFiles(db, scenario.ticketId, [brief('keep me')], scenario.userId);
  const failed = attachFiles(
    db,
    scenario.ticketId,
    [{ name: 'huge.md', content: 'x'.repeat(MAX_TOTAL_BYTES + 1) }],
    scenario.userId,
  );
  await expect(failed).rejects.toThrow();

  const listed = await listFiles(db, scenario.ticketId);
  expect(listed).toHaveLength(1);
  expect((await readFiles(db, scenario.ticketId))[0]?.content).toBe('keep me');
});

test('files are listed by name, so a re-run sees them in the same order', async () => {
  await attachFiles(
    db,
    scenario.ticketId,
    [
      { name: 'z-last.md', content: 'z' },
      { name: 'a-first.md', content: 'a' },
    ],
    scenario.userId,
  );
  expect((await listFiles(db, scenario.ticketId)).map((file) => file.name)).toEqual([
    'a-first.md',
    'z-last.md',
  ]);
});

test('removing one is scoped to its ticket', async () => {
  await attachFiles(db, scenario.ticketId, [brief()], scenario.userId);
  const [file] = await listFiles(db, scenario.ticketId);

  // A file id from one ticket must not delete through another ticket's id.
  const wrongTicket = await removeFile(db, scenario.userId, file?.id as string);
  expect(wrongTicket.removed).toBe(false);
  expect(await listFiles(db, scenario.ticketId)).toHaveLength(1);

  expect((await removeFile(db, scenario.ticketId, file?.id as string)).removed).toBe(true);
  expect(await listFiles(db, scenario.ticketId)).toEqual([]);
});

test('removing one that is already gone is not an error', async () => {
  const { removed } = await removeFile(db, scenario.ticketId, scenario.userId);
  expect(removed).toBe(false);
});

test('the manifest carries names and sizes, and never content', async () => {
  // The reason this is a manifest at all: a snapshot is stored as one value
  // for the life of a run, and on the managed execution host that value is
  // capped at 128 KiB.
  await attachFiles(db, scenario.ticketId, [brief()], scenario.userId);
  const manifest = await fileManifest(db, scenario.ticketId);
  expect(manifest).toEqual([{ name: 'brief.md', bytes: bytesOf(brief().content) }]);
  expect(JSON.stringify(manifest)).not.toContain('Build the thing');
});

test('a run’s snapshot lists the documents the ticket had when it started', async () => {
  await attachFiles(db, scenario.ticketId, [brief()], scenario.userId);
  const { snapshot } = await startRun(db, { ticketId: scenario.ticketId, ...base });
  expect(snapshot.ticket.requirement_files).toEqual([
    { name: 'brief.md', bytes: bytesOf(brief().content) },
  ]);
});

test('a document attached after a run started does not reach that run', async () => {
  // The rule that makes attaching one safe at any moment. The snapshot is
  // resolved once; a later attachment belongs to the next attempt.
  const { snapshot } = await startRun(db, { ticketId: scenario.ticketId, ...base });
  expect(snapshot.ticket.requirement_files).toEqual([]);

  await attachFiles(db, scenario.ticketId, [brief()], scenario.userId);
  expect(snapshot.ticket.requirement_files).toEqual([]);
});

test('a ticket with no documents carries an empty manifest, not a missing one', async () => {
  // Absent and empty mean different things to the execution service: absent
  // is a snapshot written before this existed, and empty is a ticket that
  // genuinely has none. Only the second may be produced here.
  const { snapshot } = await startRun(db, { ticketId: scenario.ticketId, ...base });
  expect(snapshot.ticket.requirement_files).toEqual([]);
});
