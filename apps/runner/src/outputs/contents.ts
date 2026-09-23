import type { ArtifactRef } from '@factory/shared';
import type { ContainerHost } from '../container/host';
import { withinWorkspace } from '../container/paths';
import { quoteOne } from '../container/shell';
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
 * **Text here, bytes below.** A screen is a PNG and does not survive being
 * read as text, so `readOutputBytes` carries those instead. A design source
 * is binary too and is carried by neither: nothing renders it, and it is on
 * the branch for whoever wants it. The kinds that are not files at all — a
 * commit list, a merge request — have no content by definition.
 */

const TEXT_KINDS = new Set<ArtifactRef['kind']>(['document']);

/** Kinds the application shows as a picture, so it needs the picture. */
const IMAGE_KINDS = new Set<ArtifactRef['kind']>(['screen']);

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
      text = await host.readFile(
        containerId,
        `${workdir}/${withinWorkspace(output.path, 'output path')}`,
      );
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
 * How large a screen may be and still travel.
 *
 * A full page exported at twice scale is megabytes, so this has to be roomy
 * or it refuses the ordinary case — the first one produced here was 6.5 MB.
 * It is a ceiling rather than a target: base64 adds a third on top, and the
 * whole lot rides in one callback.
 */
export const MAX_SCREEN_BYTES = 12 * 1024 * 1024;

/**
 * The images a step exported, base64, by path.
 *
 * Read with `base64` in the sandbox rather than through `readFile`, which
 * decodes as text and would return something that is no longer a PNG. An
 * image that cannot be read, or is past the ceiling, is simply absent: the
 * artifact row is still written from the manifest, and a missing picture is
 * better than a corrupt one.
 *
 * Nothing is redacted here, and nothing needs to be. Redaction is defined
 * over text (FR-084); a credential cannot be pattern-matched out of a PNG,
 * and an image of a screen is not where one would be.
 */
export async function readOutputBytes(
  host: ContainerHost,
  containerId: string,
  workdir: string,
  outputs: ArtifactRef[],
): Promise<Record<string, string>> {
  const images: Record<string, string> = {};
  for (const output of outputs) {
    if (!IMAGE_KINDS.has(output.kind)) continue;
    const path = `${workdir}/${withinWorkspace(output.path, 'output path')}`;
    try {
      // Asked before it is read: pulling something enormous through a pipe to
      // then discard it is the one outcome worth avoiding.
      const info = await host.stat(containerId, path);
      if (!info) continue;
      if (info.size > MAX_SCREEN_BYTES) {
        log.warn('an exported screen was too large to carry', {
          path: output.path,
          bytes: info.size,
          ceiling: MAX_SCREEN_BYTES,
        });
        continue;
      }
      const read = await host.exec(containerId, ['sh', '-c', `base64 ${quoteOne(path)}`]);
      if (read.exitCode !== 0) {
        log.warn('an exported screen could not be read back', {
          path: output.path,
          detail: read.stderr.trim().slice(0, 400),
        });
        continue;
      }
      // `base64` wraps at 76 columns on most systems and not on others, so
      // the line breaks come out rather than being depended on either way.
      const encoded = read.stdout.replace(/\s+/g, '');
      if (encoded.length > 0) images[output.path] = encoded;
    } catch (error) {
      // A sandbox that went away between the step finishing and this read.
      log.warn('an exported screen could not be read back', {
        path: output.path,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return images;
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
