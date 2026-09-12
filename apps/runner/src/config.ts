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
  /**
   * The outgoing credential, accepted alongside `authToken` while a
   * replacement is rolled out (002 FR-018a).
   *
   * Absent in the ordinary case. Present only for as long as it takes to tell
   * every caller the new credential, and removed by a deploy — which is what
   * refuses it.
   */
  previousAuthToken?: string;
  executionHost: ExecutionHostName;
}

/**
 * The credential a developer gets when they have configured nothing.
 *
 * Named so the hosted-deployment check below can recognise it. A deployment
 * that has explicitly set this exact value has still chosen it, which is why
 * the check compares rather than asking whether the variable was present.
 */
const DEV_ONLY_TOKEN = 'dev-only-token';

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
    // The development fallback exists only for the locally administered host,
    // which used to sit behind a private network. A hosted deployment has a
    // public address by construction, so there the credential is the whole
    // boundary and a default would be a service anyone could drive — see the
    // check below.
    authToken: need('RUNNER_AUTH_TOKEN', 'dev-only-token'),
    // Optional, and NOT routed through `need`: an absent rotation window is
    // the normal state, not missing configuration. An empty value is treated
    // as absent so that clearing the variable, rather than deleting it, also
    // closes the window.
    ...(env.RUNNER_AUTH_TOKEN_PREVIOUS
      ? { previousAuthToken: env.RUNNER_AUTH_TOKEN_PREVIOUS }
      : {}),
    // Defaults to the locally administered host, so an existing deployment
    // that has not been told about the hosted one keeps behaving as it did.
    executionHost: host,
  };

  if (missing.length > 0) {
    throw new Error(`runner: missing required configuration: ${missing.join(', ')}`);
  }
  // Refused rather than defaulted (002 FR-018, Principle V). This was safe
  // while the service was reachable only from a private network; a hosted
  // deployment is reachable from anywhere, so a well-known credential is an
  // open door to creating and driving sandboxes on somebody's account. Failing
  // at startup is the only answer that cannot be missed.
  if (config.executionHost === 'hosted' && config.authToken === DEV_ONLY_TOKEN) {
    throw new Error(
      "runner: EXECUTION_HOST='hosted' requires RUNNER_AUTH_TOKEN to be set explicitly — a " +
        'hosted deployment is publicly reachable, so the default development credential would ' +
        'let anyone drive it (set it with `wrangler secret put RUNNER_AUTH_TOKEN`)',
    );
  }
  if (!Number.isFinite(config.port)) {
    throw new Error('runner: RUNNER_PORT must be a number');
  }
  return config;
}
