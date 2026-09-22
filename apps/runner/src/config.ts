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
 * The development credential, accepted only where the service is plainly a
 * development one — see `developmentCredentialAllowed`.
 */
export const DEVELOPMENT_AUTH_TOKEN = 'dev-only-token';

/**
 * Values that are a placeholder in `.env.example`, never a credential. Refused
 * outright: a service that starts with one is a service anyone who has read
 * the example file can drive.
 */
const PLACEHOLDER_TOKENS = new Set(['change-me']);

/**
 * A configuration value, or nothing.
 *
 * `.env.example` ships several keys blank — `FACTORY_WORK_DIR=`, and so on —
 * so that a person can see every name at once. Copied verbatim, those arrive
 * here as EMPTY STRINGS, and `env[key] ?? fallback` keeps an empty string: the
 * runner started with `workDir: ''`, made every run's directory relative to
 * whatever its working directory happened to be, and logged `"work_dir":""`
 * while `bun run dev` — which reads the same file with `||` — printed the
 * right default beside it. Blank is absent, here and everywhere a variable is
 * read.
 */
export function envValue(env: Record<string, string | undefined>, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Whether the built-in development credential may stand in for a configured
 * one.
 *
 * The fallback exists so that a developer can start the service with nothing
 * set, on a machine the team administers, where the credential is defence in
 * depth rather than the whole boundary. Once the service is hosted, the
 * credential IS the boundary (constitution Principle V), and a well-known
 * default is no credential at all. So the fallback is refused wherever the
 * configuration says this is not that machine: `NODE_ENV=production`, or a
 * public address that is not loopback — a service the application reaches at
 * `https://runner.example.com` is not one anyone is developing on.
 */
export function developmentCredentialAllowed(
  env: Record<string, string | undefined>,
  publicBaseUrl: string,
): boolean {
  if (envValue(env, 'NODE_ENV') === 'production') return false;
  try {
    const { hostname } = new URL(publicBaseUrl);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Fails loudly at startup rather than at the first run (T035).
 *
 * The development fallback for the credential exists because this service
 * sits on a machine the team administers, behind whatever network that machine
 * is on; the credential is defence in depth there, not the whole boundary. A
 * deployment reachable from the internet must set `RUNNER_AUTH_TOKEN`
 * explicitly — `developmentCredentialAllowed` refuses the fallback where the
 * configuration shows a deployment — and `bun run dev` refuses to start while
 * it is still the example's placeholder.
 */
export function loadRunnerConfig(env: Record<string, string | undefined> = process.env) {
  const missing: string[] = [];
  const need = (key: string, fallback?: string): string => {
    const value = envValue(env, key) ?? fallback;
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
    authToken: need('RUNNER_AUTH_TOKEN', DEVELOPMENT_AUTH_TOKEN),
    // Optional, and NOT routed through `need`: an absent rotation window is
    // the normal state, not missing configuration. An empty value is treated
    // as absent so that clearing the variable, rather than deleting it, also
    // closes the window.
    ...(envValue(env, 'RUNNER_AUTH_TOKEN_PREVIOUS')
      ? { previousAuthToken: envValue(env, 'RUNNER_AUTH_TOKEN_PREVIOUS') }
      : {}),
  };

  if (PLACEHOLDER_TOKENS.has(config.authToken)) {
    throw new Error(
      `runner: RUNNER_AUTH_TOKEN is still the example's placeholder "${config.authToken}" — set a credential of your own`,
    );
  }
  if (
    envValue(env, 'RUNNER_AUTH_TOKEN') === undefined &&
    !developmentCredentialAllowed(env, config.publicBaseUrl)
  ) {
    throw new Error(
      'runner: RUNNER_AUTH_TOKEN must be set. The built-in development credential is accepted ' +
        'only for a service at a localhost address with NODE_ENV unset; this configuration ' +
        `names ${envValue(env, 'NODE_ENV') === 'production' ? 'NODE_ENV=production' : `RUNNER_BASE_URL=${config.publicBaseUrl}`}, which is a deployment`,
    );
  }

  if (missing.length > 0) {
    throw new Error(`runner: missing required configuration: ${missing.join(', ')}`);
  }
  if (!Number.isFinite(config.port)) {
    throw new Error('runner: RUNNER_PORT must be a number');
  }
  return config;
}
