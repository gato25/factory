import { createLogger } from '@factory/shared';
import type { ContainerHost } from './host';

const log = createLogger('runner');

/**
 * A run's sandbox is released when the run ends (SC-012), unless the
 * workspace keeps failed runs' sandboxes for diagnosis, in which case it is
 * retained for the configured window and destroyed after (FR-086).
 */
export async function destroyRunWorkspace(
  host: ContainerHost,
  containerId: string,
  options: { outcome: 'done' | 'failed' | 'cancelled'; retainFailedHours: number },
): Promise<{ destroyed: boolean; retainedUntil?: string }> {
  const retain = options.outcome === 'failed' && options.retainFailedHours > 0;
  if (retain) {
    const until = new Date(Date.now() + options.retainFailedHours * 3_600_000).toISOString();
    log.info('retaining a failed run sandbox for diagnosis', { containerId, until });
    return { destroyed: false, retainedUntil: until };
  }
  await host.destroy(containerId);
  log.info('sandbox released', { containerId, outcome: options.outcome });
  return { destroyed: true };
}
