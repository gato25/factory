import type { ArtifactRef } from '@factory/shared';
import type { ContainerHost } from '../container/host';
import { log } from '../errors';

/**
 * The text of the documents a step produced, to travel with its outcome.
 *
 * The callback used to carry a MANIFEST — kind, path and version — and the
 * application stored exactly that: a row per document with no text in it. So
 * a checkpoint had nothing to review, the artifact viewer showed an empty
 * document, and the merge request would have opened with an empty
 * Specification and an empty Plan. The application's `captureArtifacts` has
 * taken the contents since it was written; nothing ever passed them.
 *
 * Read here rather than fetched by the application, because only this service
 * can reach the workspace, and the file is on its disk already — the same
 * reason the credentials exchange runs the other way.
 *
 * **Documents only.** A screen is a PNG and a design source is a binary file,
 * and neither survives being read as text; they are the same gap and need a
 * way to read bytes out of a sandbox, which is a separate piece of work. The
 * kinds that are not files at all — a commit list, a merge request — have no
 * content by definition.
 */

const TEXT_KINDS = new Set<ArtifactRef['kind']>(['document']);

/**
 * How much of one document travels. A specification or a plan is a few tens
 * of kilobytes; this is generous for that and small enough that a step whose
 * agent wrote something enormous cannot make one callback enormous with it.
 */
export const MAX_DOCUMENT_BYTES = 512 * 1024;

/**
 * Redacted before it leaves this service, never where it is displayed
 * (Principle V). A document is named in FR-084 alongside output and merge
 * request descriptions: an agent that quotes an environment variable into a
 * specification must not put a credential into a row that is kept for ever.
 */
export type Redact = (text: string) => string;

export async function readOutputContents(
  host: ContainerHost,
  containerId: string,
  workdir: string,
  outputs: ArtifactRef[],
  redact: Redact,
): Promise<Record<string, string>> {
  const contents: Record<string, string> = {};
  for (const output of outputs) {
    if (!TEXT_KINDS.has(output.kind)) continue;
    let text: string | null;
    try {
      text = await host.readFile(containerId, `${workdir}/${output.path}`);
    } catch (error) {
      // A sandbox that went away between the step finishing and this read.
      // The step's own outcome is what matters; the document is reported
      // without its text rather than turning a finished step into a failure.
      log.warn('a produced document could not be read back', {
        path: output.path,
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (text === null) continue;
    contents[output.path] = redact(cap(text, output.path));
  }
  return contents;
}

/**
 * The first `MAX_DOCUMENT_BYTES` of a document, and a line saying so.
 *
 * Truncated rather than dropped: a reviewer at a gate is better served by the
 * beginning of a long plan and a note than by a blank pane, and the note is
 * what stops the beginning being mistaken for the whole.
 */
function cap(text: string, path: string): string {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= MAX_DOCUMENT_BYTES) return text;
  const kept = Buffer.from(text, 'utf8').subarray(0, MAX_DOCUMENT_BYTES).toString('utf8');
  log.warn('a produced document was too large to carry whole', { path, bytes });
  return `${kept}\n\n---\n\n*This document is ${bytes.toLocaleString()} bytes; the first ${MAX_DOCUMENT_BYTES.toLocaleString()} are shown. The whole of it is on the run's branch.*\n`;
}
