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
