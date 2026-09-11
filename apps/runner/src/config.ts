/**
 * Which execution host a deployment uses.
 *
 * `docker` is a container daemon on a machine the team administers; `hosted`
 * is a managed sandbox service. Choosing between them is configuration and
 * never a code change (002 FR-025), which is what makes the migration
 * reversible and what lets the whole test suite run with no account (FR-026).
 */
export type ExecutionHostName = 'docker' | 'hosted';

export interface RunnerConfig {
  port: number;
  sandboxImage: string;
  authToken: string;
  executionHost: ExecutionHostName;
}

/** Fails loudly at startup rather than at the first run (T035). */
export function loadRunnerConfig(env: Record<string, string | undefined> = process.env) {
  const missing: string[] = [];
  const need = (key: string, fallback?: string): string => {
    const value = env[key] ?? fallback;
    if (value === undefined) missing.push(key);
    return value ?? '';
  };

  const host = need('EXECUTION_HOST', 'docker');
  if (host !== 'docker' && host !== 'hosted') {
    throw new Error(`runner: EXECUTION_HOST must be 'docker' or 'hosted', not '${host}'`);
  }

  const config: RunnerConfig = {
    port: Number(need('RUNNER_PORT', '8080')),
    sandboxImage: need('SANDBOX_IMAGE', 'code-factory/sandbox:latest'),
    authToken: need('RUNNER_AUTH_TOKEN', 'dev-only-token'),
    // Defaults to the locally administered host, so an existing deployment
    // that has not been told about the hosted one keeps behaving as it did.
    executionHost: host,
  };

  if (missing.length > 0) {
    throw new Error(`runner: missing required configuration: ${missing.join(', ')}`);
  }
  if (!Number.isFinite(config.port)) {
    throw new Error('runner: RUNNER_PORT must be a number');
  }
  return config;
}
