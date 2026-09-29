import { FactoryError } from '@factory/shared';
import type { ContainerHost } from '../container/host';
import { quoteOne } from '../container/shell';

/**
 * Every declared output must exist AND be non-empty (FR-051). An agent that
 * produced the file but left it empty has not produced it.
 */
export async function checkRequiredOutputs(
  host: ContainerHost,
  containerId: string,
  workdir: string,
  outputFiles: string[],
): Promise<void> {
  const missing: string[] = [];
  const empty: string[] = [];

  for (const relative of outputFiles) {
    const path = `${workdir}/${relative}`;
    const stat = await host.stat(containerId, path);
    if (!stat) missing.push(relative);
    else if (stat.size === 0) empty.push(relative);
  }

  if (missing.length === 0 && empty.length === 0) return;

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`did not produce ${missing.join(', ')}`);
  if (empty.length > 0) parts.push(`left ${empty.join(', ')} empty`);
  throw new FactoryError('missing_output', `The step ${parts.join(' and ')}.`, {
    detail: JSON.stringify({ missing, empty }),
  });
}

/**
 * Every declared output must also be THIS step's work: new, or changed from
 * the default branch the run was cloned from.
 *
 * Existence alone is not enough. A repository an earlier ticket was merged
 * into already has that ticket's documents, and a step that wrote nothing
 * passed the check above with them — the new ticket was then planned and
 * built from the old one's specification. A file that is tracked, and
 * identical to the default branch in the commit, the index and the working
 * tree, is one this run did not write.
 *
 * Anything git cannot answer — no such ref, no repository — counts as
 * written: this check exists to catch a stale file, not to fail a step over
 * a question it could not ask.
 */
export async function checkOutputsAreNew(
  host: ContainerHost,
  containerId: string,
  workdir: string,
  outputFiles: string[],
  defaultBranch: string,
): Promise<void> {
  if (outputFiles.length === 0) return;
  const base = quoteOne(`origin/${defaultBranch}`);
  const script = outputFiles
    .map((file) => {
      const path = quoteOne(file);
      return (
        `if git ls-files --error-unmatch -- ${path} >/dev/null 2>&1 && ` +
        `git diff --quiet ${base} -- ${path} && git diff --quiet -- ${path} && ` +
        `git diff --quiet --cached -- ${path}; then echo STALE:${path}; fi`
      );
    })
    .join('; ');
  const result = await host.exec(containerId, ['sh', '-c', script], { cwd: workdir });
  const stale = result.stdout
    .split('\n')
    .filter((line) => line.startsWith('STALE:'))
    .map((line) => line.slice('STALE:'.length).trim());
  if (stale.length === 0) return;

  throw new FactoryError(
    'missing_output',
    `The step did not write ${stale.join(', ')}: the file is exactly as it is on ` +
      `${defaultBranch}, left there by an earlier ticket.`,
    { detail: JSON.stringify({ stale }) },
  );
}
