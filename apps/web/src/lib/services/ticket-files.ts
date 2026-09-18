import type { Database } from '@factory/db';
import { ticketFiles, tickets } from '@factory/db/schema';
import {
  ACCEPTED_TYPES,
  byteLength,
  checkAddition,
  checkFile,
  extensionOf,
  type IncomingFile,
  invalidInput,
  notFound,
  safeFileName,
} from '@factory/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';

/**
 * Requirement documents a person attached to a ticket.
 *
 * The rules about what may be attached live in `shared`, because the form
 * applies them before uploading and this applies them again before storing.
 * That is not duplication: the form's copy is there so somebody learns about
 * a refusal immediately, and this one is there because a form is not a
 * boundary — anything reaching this function may have come from anywhere.
 */

export interface StoredFile {
  id: string;
  name: string;
  contentType: string;
  bytes: number;
  createdAt: Date;
}

/** Everything about a ticket's files except the content itself. */
export async function listFiles(database: Database, ticketId: string): Promise<StoredFile[]> {
  return (
    database
      .select({
        id: ticketFiles.id,
        name: ticketFiles.name,
        contentType: ticketFiles.contentType,
        bytes: ticketFiles.bytes,
        createdAt: ticketFiles.createdAt,
      })
      .from(ticketFiles)
      .where(eq(ticketFiles.ticketId, ticketId))
      // By name, not by upload time: this order is what an agent sees in the
      // index written into the sandbox, and a stable order makes a re-run
      // comparable with the run before it.
      .orderBy(asc(ticketFiles.name))
  );
}

/** The content too — only the execution service needs this. */
export async function readFiles(
  database: Database,
  ticketId: string,
): Promise<{ name: string; content: string }[]> {
  return database
    .select({ name: ticketFiles.name, content: ticketFiles.content })
    .from(ticketFiles)
    .where(eq(ticketFiles.ticketId, ticketId))
    .orderBy(asc(ticketFiles.name));
}

/**
 * Attach files, replacing any of the same name.
 *
 * Replacing rather than refusing is the behaviour somebody actually wants: a
 * requirements document gets corrected, and re-attaching it should mean what
 * it looks like it means. The alternative — a second `brief.md (1)` — leaves
 * two documents in the sandbox and no way for an agent to know which is
 * current.
 */
export async function attachFiles(
  database: Database,
  ticketId: string,
  incoming: IncomingFile[],
  uploadedBy: string,
): Promise<StoredFile[]> {
  if (incoming.length === 0) return listFiles(database, ticketId);

  const [ticket] = await database
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!ticket) throw notFound('тийм даалгавар алга');

  for (const file of incoming) {
    const problem = checkFile(file);
    if (problem) throw invalidInput(problem.message);
  }

  // Two files whose names differ but whose SAFE names do not would both be
  // stored under one name, and the second would violate the unique index. The
  // last one wins, which is what a person picking two files of the same name
  // from different folders would expect.
  const named = new Map<string, IncomingFile>();
  for (const file of incoming) named.set(safeFileName(file.name), file);

  const existing = await listFiles(database, ticketId);
  const problem = checkAddition(
    existing,
    [...named].map(([name, file]) => ({ name, content: file.content })),
  );
  if (problem) throw invalidInput(problem.message);

  await database.transaction(async (tx) => {
    const names = [...named.keys()];
    // Delete-then-insert rather than an upsert: a replacement has a new size
    // and a new uploader, and `onConflictDoUpdate` would have to list every
    // column anyway. This says what happens.
    await tx
      .delete(ticketFiles)
      .where(and(eq(ticketFiles.ticketId, ticketId), inArray(ticketFiles.name, names)));
    await tx.insert(ticketFiles).values(
      [...named].map(([name, file]) => ({
        ticketId,
        name,
        contentType: ACCEPTED_TYPES[extensionOf(name)] ?? 'text/plain',
        bytes: byteLength(file.content),
        content: file.content,
        uploadedBy,
      })),
    );
  });

  return listFiles(database, ticketId);
}

/** Removing one, by its id rather than its name. */
export async function removeFile(
  database: Database,
  ticketId: string,
  fileId: string,
): Promise<{ removed: boolean }> {
  // Scoped to the ticket as well as the id, so an id from another ticket
  // cannot delete a file through this route.
  const deleted = await database
    .delete(ticketFiles)
    .where(and(eq(ticketFiles.ticketId, ticketId), eq(ticketFiles.id, fileId)))
    .returning({ id: ticketFiles.id });
  return { removed: deleted.length > 0 };
}

/**
 * The manifest that travels in a run's snapshot: names and sizes, no content.
 *
 * Content is deliberately absent. The snapshot is held for the life of a run,
 * passed through the orchestration service, and stored again on every step —
 * so a few megabytes of requirements inside it would be copied at every one
 * of those points for content that is needed exactly once. The execution
 * service fetches the content at start, exactly as it already fetches
 * credentials.
 */
export async function fileManifest(
  database: Database,
  ticketId: string,
): Promise<{ name: string; bytes: number }[]> {
  const files = await listFiles(database, ticketId);
  return files.map((file) => ({ name: file.name, bytes: file.bytes }));
}
