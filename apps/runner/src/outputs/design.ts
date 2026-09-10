import { FactoryError } from '@factory/shared';
import type { ContainerHost } from '../container/host';

/**
 * What a design step must have produced: an editable design source, and at
 * least one exported image (FR-103, FR-104). Whatever it did produce is
 * retained either way — a step that drew three screens and failed on the
 * fourth leaves three screens worth looking at (FR-104).
 */

export interface DesignOutputs {
  /** Path of the design source, relative to the workspace. */
  source: string;
  /** Exported image paths, relative to the workspace, in listing order. */
  screens: string[];
}

const IMAGE = /\.(png|jpe?g|webp)$/i;

/** Everything the step exported, whether or not it is enough to pass. */
export async function collectDesignOutputs(
  host: ContainerHost,
  containerId: string,
  workdir: string,
  sourcePath: string,
  exportDir: string,
): Promise<{ sourceExists: boolean; screens: string[] }> {
  const source = await host.stat(containerId, `${workdir}/${sourcePath}`);
  const listing = await host.exec(containerId, [
    'sh',
    '-c',
    `ls -1 '${workdir}/${exportDir}' 2>/dev/null || true`,
  ]);
  const screens = listing.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => IMAGE.test(line))
    .sort()
    .map((name) => `${exportDir.replace(/\/+$/, '')}/${name}`);

  return { sourceExists: Boolean(source && source.size > 0), screens };
}

/**
 * The check FR-104 requires. It throws rather than returning a verdict so a
 * caller cannot forget to look, and the error names what is missing so the
 * failure is legible without opening the step's output (FR-087).
 */
export async function checkDesignOutputs(
  host: ContainerHost,
  containerId: string,
  workdir: string,
  sourcePath: string,
  exportDir: string,
): Promise<DesignOutputs> {
  const { sourceExists, screens } = await collectDesignOutputs(
    host,
    containerId,
    workdir,
    sourcePath,
    exportDir,
  );

  if (!sourceExists && screens.length === 0) {
    throw new FactoryError(
      'missing_output',
      `The design step produced neither ${sourcePath} nor any exported screen.`,
      { detail: JSON.stringify({ source: sourcePath, exportDir, screens }) },
    );
  }
  if (!sourceExists) {
    throw new FactoryError(
      'missing_output',
      `The design step exported ${screens.length} screen(s) but no editable design ` +
        `source at ${sourcePath}, so nothing can revise it later.`,
      { detail: JSON.stringify({ screens }) },
    );
  }
  if (screens.length === 0) {
    throw new FactoryError(
      'missing_output',
      `The design step wrote ${sourcePath} but exported no screen, so there is nothing ` +
        'for a person to review or for a later step to build against.',
      { detail: JSON.stringify({ source: sourcePath, exportDir }) },
    );
  }

  return { source: sourcePath, screens };
}
