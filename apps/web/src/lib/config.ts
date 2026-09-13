import { FactoryError } from '@factory/shared';

export interface WebConfig {
  databaseUrl: string;
  runnerBaseUrl: string;
  runnerAuthToken: string;
  orchestratorBaseUrl: string;
  orchestratorApiKey: string;
  publicBaseUrl: string;
  sessionSecret: string;
}

const REQUIRED: (keyof WebConfig)[] = [
  'databaseUrl',
  'runnerBaseUrl',
  'runnerAuthToken',
  'orchestratorBaseUrl',
  'publicBaseUrl',
  'sessionSecret',
];

const ENV_NAMES: Record<keyof WebConfig, string> = {
  databaseUrl: 'DATABASE_URL',
  runnerBaseUrl: 'RUNNER_BASE_URL',
  runnerAuthToken: 'RUNNER_AUTH_TOKEN',
  orchestratorBaseUrl: 'ORCHESTRATOR_BASE_URL',
  orchestratorApiKey: 'ORCHESTRATOR_API_KEY',
  publicBaseUrl: 'PUBLIC_BASE_URL',
  sessionSecret: 'SESSION_SECRET',
};

/** Fails at startup rather than at the first run (T035). */
export function loadWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const config: WebConfig = {
    databaseUrl: env.DATABASE_URL ?? '',
    runnerBaseUrl: env.RUNNER_BASE_URL ?? '',
    runnerAuthToken: env.RUNNER_AUTH_TOKEN ?? '',
    orchestratorBaseUrl: env.ORCHESTRATOR_BASE_URL ?? '',
    orchestratorApiKey: env.ORCHESTRATOR_API_KEY ?? '',
    publicBaseUrl: env.PUBLIC_BASE_URL ?? '',
    sessionSecret: env.SESSION_SECRET ?? '',
  };

  const missing = REQUIRED.filter((key) => config[key] === '').map((key) => ENV_NAMES[key]);
  if (missing.length > 0) {
    throw new FactoryError(
      'invalid_input',
      `web: missing required configuration: ${missing.join(', ')}`,
    );
  }
  for (const key of ['runnerBaseUrl', 'orchestratorBaseUrl', 'publicBaseUrl'] as const) {
    try {
      new URL(config[key]);
    } catch {
      throw new FactoryError('invalid_input', `web: ${ENV_NAMES[key]} must be an absolute URL`);
    }
  }
  return config;
}

/**
 * What a fresh workspace can be given from the environment, once, at startup.
 *
 * Two of the things the dashboard reported missing on a new deployment —
 * the runner address and the orchestration address — were already in `.env`,
 * where the same person had just typed them. The application read them for
 * its own use and then asked for them again in Settings. That is not a
 * setting; it is the same fact wanted in two places, and the second place
 * should be filled from the first.
 *
 * The model credential is the third. It cannot have a default, but it can be
 * read from the environment the way every CLI tool reads it, and stored
 * sealed. `ANTHROPIC_API_KEY` first, then `CLAUDE_CODE_OAUTH_TOKEN`, which is
 * the same order the execution service resolves them in.
 *
 * Pure, and given its environment, so it can be tested without one. The
 * value of the key never leaves this object except into the sealing step;
 * `from` is what the log may name.
 */
export interface WorkspaceBootstrap {
  runnerBaseUrl?: string;
  orchestratorBaseUrl?: string;
  modelKey?: { value: string; from: 'ANTHROPIC_API_KEY' | 'CLAUDE_CODE_OAUTH_TOKEN' };
}

export function bootstrapFromEnv(env: NodeJS.ProcessEnv = process.env): WorkspaceBootstrap {
  const out: WorkspaceBootstrap = {};

  // An address that is not one is left out rather than seeded: the settings
  // screen validates what it is given, and `loadWebConfig` refuses the same
  // value with a message that names the variable.
  const url = (key: string): string | undefined => {
    const value = env[key]?.trim();
    if (!value) return undefined;
    try {
      new URL(value);
      return value;
    } catch {
      return undefined;
    }
  };
  const runner = url('RUNNER_BASE_URL');
  const orchestrator = url('ORCHESTRATOR_BASE_URL');
  if (runner) out.runnerBaseUrl = runner;
  if (orchestrator) out.orchestratorBaseUrl = orchestrator;

  const api = env.ANTHROPIC_API_KEY?.trim();
  const oauth = env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (api) out.modelKey = { value: api, from: 'ANTHROPIC_API_KEY' };
  else if (oauth) out.modelKey = { value: oauth, from: 'CLAUDE_CODE_OAUTH_TOKEN' };

  return out;
}
