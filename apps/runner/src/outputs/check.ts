import { FactoryError } from '@factory/shared';
import type { ContainerHost } from '../container/host';

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
