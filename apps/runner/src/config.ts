import { homedir } from 'node:os';
import { join } from 'node:path';
import { defaultWorkRoot } from './container/process-host';

/**
 * Where a run executes.
 *
 * `process`: as ordinary processes on this machine, each run in a fresh
 * directory under `workDir` — the development default, needing nothing but
 * the git, node and Claude CLI already installed. `docker`: one fresh
 * container per run, non-root and bounded, which is what the constitution's
 * sandbox invariant describes and what a deployment should use.
 */
export type ExecutionHostKind = 'process' | 'docker';

export interface RunnerConfig {
  port: number;
  /**
   * This service's address as the application reaches it. It appears in the
   * resume addresses handed to the application when a run waits at a
   * checkpoint or a pause, and those must be addresses the application can
   * open — not this process's own idea of `localhost`.
   */
  publicBaseUrl: string;
  executionHost: ExecutionHostKind;
  /** Where the process host makes each run's directory. */
  workDir: string;
  /** Where each run's position in its pipeline is written, so a restart resumes it. */
  stateDir: string;
  sandboxImage: string;
  authToken: string;
  /**
   * The outgoing credential, accepted alongside `authToken` while a
   * replacement is rolled out.
   *
   * Absent in the ordinary case. Present only for as long as it takes to tell
   * every caller the new credential, and removed by a restart — which is what
   * refuses it. Replacing a credential is a two-sided change — the execution
   * service is told the new one, then every caller is — and those cannot
   * happen in the same instant, so both are accepted for a window.
   */
  previousAuthToken?: string;
}

/**
 * Fails loudly at startup rather than at the first run (T035).
 *
 * The development fallback for the credential exists because this service
 * sits on a machine the team administers, behind whatever network that machine
 * is on; the credential is defence in depth there, not the whole boundary. A
 * deployment reachable from the internet must set `RUNNER_AUTH_TOKEN`
 * explicitly, and `bun run dev` refuses to start while it is still the
 * example's placeholder.
 */
export function loadRunnerConfig(env: Record<string, string | undefined> = process.env) {
  const missing: string[] = [];
  const need = (key: string, fallback?: string): string => {
    const value = env[key] ?? fallback;
    if (value === undefined) missing.push(key);
    return value ?? '';
  };

  const executionHost = need('EXECUTION_HOST', 'process');
  if (executionHost !== 'process' && executionHost !== 'docker') {
    throw new Error(`runner: EXECUTION_HOST must be "process" or "docker", not "${executionHost}"`);
  }

  const port = Number(need('RUNNER_PORT', '8080'));
  const config: RunnerConfig = {
    port,
    publicBaseUrl: need('RUNNER_BASE_URL', `http://localhost:${port}`),
    executionHost,
    workDir: need('FACTORY_WORK_DIR', defaultWorkRoot(env as NodeJS.ProcessEnv)),
    stateDir: need('FACTORY_STATE_DIR', join(homedir(), '.code-factory', 'state')),
    sandboxImage: need('SANDBOX_IMAGE', 'code-factory/sandbox:latest'),
    authToken: need('RUNNER_AUTH_TOKEN', 'dev-only-token'),
    // Optional, and NOT routed through `need`: an absent rotation window is
    // the normal state, not missing configuration. An empty value is treated
    // as absent so that clearing the variable, rather than deleting it, also
    // closes the window.
    ...(env.RUNNER_AUTH_TOKEN_PREVIOUS
      ? { previousAuthToken: env.RUNNER_AUTH_TOKEN_PREVIOUS }
      : {}),
  };

  if (missing.length > 0) {
    throw new Error(`runner: missing required configuration: ${missing.join(', ')}`);
  }
  if (!Number.isFinite(config.port)) {
    throw new Error('runner: RUNNER_PORT must be a number');
  }
  return config;
}
