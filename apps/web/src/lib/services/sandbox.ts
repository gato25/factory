/**
 * Releasing a sandbox. The container host belongs to the Runner (Principle
 * V: the web application never holds a container handle), so releasing one
 * is a request to the Runner rather than something done here.
 *
 * The Runner keys its sandboxes by RUN, not by container: `DELETE /runs/:id`
 * looks the container up in its own store and applies its own retention
 * rule. So a release has to carry the run id and how the run ended — the
 * container id alone cannot express the request.
 */
export interface Sandbox {
  runId: string;
  containerId: string;
  /** How the run ended, which is what decides whether it is retained. */
  outcome: 'done' | 'failed' | 'cancelled';
}

export type ReleaseSandbox = (sandbox: Sandbox) => Promise<void>;

export interface RunnerAccess {
  /**
   * The Runner's address, from the WORKSPACE rather than the environment —
   * the same source the settings screen configures and its connection test
   * probes. Taking it from the environment instead would mean an
   * administrator changing the address in Settings kept releasing against
   * the old one.
   */
  baseUrl: string;
  /** Deployment configuration, never a workspace setting (FR-011). */
  authToken: string;
  /**
   * The workspace's retention, passed through because the Runner has no way
   * to read it: the two deployables share a database only through the
   * snapshot, deliberately (FR-086).
   */
  retainFailedHours?: number;
}

export function runnerRelease(access: RunnerAccess): ReleaseSandbox {
  const base = access.baseUrl.replace(/\/+$/, '');
  return async (sandbox: Sandbox) => {
    if (!base) throw new Error('the runner address is not configured');
    const query = new URLSearchParams({
      outcome: sandbox.outcome,
      retain_failed_hours: String(access.retainFailedHours ?? 0),
    });
    const response = await fetch(`${base}/runs/${encodeURIComponent(sandbox.runId)}?${query}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${access.authToken}` },
    });
    if (!response.ok) {
      throw new Error(
        `the runner refused to release ${sandbox.containerId}: ` +
          `${response.status} ${response.statusText}`,
      );
    }
    const body = (await response.json()) as { released?: boolean; retainedUntil?: string };
    // `released: false` is not success, in either of its two shapes, and
    // treating it as one would clear the container id from the record —
    // discarding the only handle anything has for reclaiming a container
    // that is still running.
    if (body.released === false) {
      throw new Error(
        body.retainedUntil
          ? `${sandbox.containerId} is retained for diagnosis until ${body.retainedUntil}`
          : // The Runner keys sandboxes by run in memory, so a restart loses
            // the mapping. It cannot act, and the id has to stay visible.
            `the runner has no record of run ${sandbox.runId}, so it cannot release ` +
              `${sandbox.containerId} — check the container host by hand`,
      );
    }
  };
}
