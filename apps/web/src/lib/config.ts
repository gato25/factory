import { FactoryError } from '@factory/shared';

export interface WebConfig {
  databaseUrl: string;
  runnerBaseUrl: string;
  runnerAuthToken: string;
  orchestratorBaseUrl: string;
  orchestratorApiKey: string;
  publicBaseUrl: string;
  /**
   * Where the orchestration service reaches this application, which is not
   * necessarily where a browser does.
   *
   * `PUBLIC_BASE_URL` is the address a PERSON uses — it is in links and in
   * the provider sign-in callbacks, so it has to be the one their browser can
   * open. Where n8n runs on the same machine, as it does in development, the
   * two are the same address and this falls back to that one. Where n8n runs
   * somewhere `localhost` means something else — a container, another host —
   * it needs its own name, and this is it.
   */
  callbackBaseUrl: string;
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
  callbackBaseUrl: 'CALLBACK_BASE_URL',
  sessionSecret: 'SESSION_SECRET',
};

/**
 * Where the other two local services listen, when nobody has said otherwise.
 *
 * These are not preferences. `bun run dev` starts n8n on 5678, and the
 * execution service defaults itself to 8080 — so on a development machine
 * there is exactly one right answer for each, written down in the repository
 * already. Asking for them in `.env` and then AGAIN on the settings screen
 * asked twice for a fact neither person nor machine had any choice about.
 *
 * Development only. A deployment's services are somewhere else by definition,
 * and silently pointing it at its own localhost would turn a missing variable
 * into a connection refused much further along, so there the variable is
 * still required and `loadWebConfig` still refuses to start without it.
 */
const DEV_DEFAULTS: Record<string, string> = {
  RUNNER_BASE_URL: 'http://localhost:8080',
  ORCHESTRATOR_BASE_URL: 'http://localhost:5678',
  PUBLIC_BASE_URL: 'http://localhost:5173',
};

function devDefault(env: NodeJS.ProcessEnv, key: string): string | undefined {
  if (env.NODE_ENV === 'production') return undefined;
  return DEV_DEFAULTS[key];
}

/** Fails at startup rather than at the first run (T035). */
export function loadWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const read = (key: string): string => env[key]?.trim() || devDefault(env, key) || '';
  const config: WebConfig = {
    databaseUrl: env.DATABASE_URL ?? '',
    runnerBaseUrl: read('RUNNER_BASE_URL'),
    runnerAuthToken: env.RUNNER_AUTH_TOKEN ?? '',
    orchestratorBaseUrl: read('ORCHESTRATOR_BASE_URL'),
    orchestratorApiKey: env.ORCHESTRATOR_API_KEY ?? '',
    publicBaseUrl: read('PUBLIC_BASE_URL'),
    // Falls back to the public address: where n8n runs on this machine, as
    // `bun run dev` starts it, they ARE the same address, and asking for both
    // would be asking twice for one fact.
    callbackBaseUrl: read('CALLBACK_BASE_URL') || read('PUBLIC_BASE_URL'),
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
  orchestratorWorkflowId?: string;
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
  /**
   * The variable, or — only when it is not set at all — the local default.
   *
   * A variable that is SET but malformed falls through to nothing rather than
   * to the default. Quietly replacing somebody's typo with localhost would
   * start the application against the wrong service and report it as working;
   * leaving it out means `loadWebConfig` refuses to start and names the
   * variable, which is the behaviour a typo deserves.
   */
  const address = (key: string): string | undefined =>
    env[key]?.trim() ? url(key) : devDefault(env, key);

  const runner = address('RUNNER_BASE_URL');
  const orchestrator = address('ORCHESTRATOR_BASE_URL');
  if (runner) out.runnerBaseUrl = runner;
  if (orchestrator) out.orchestratorBaseUrl = orchestrator;

  // Discovered rather than chosen: `bun run dev` imports the workflow into
  // n8n, which assigns it an identifier, and passes that identifier back in.
  // Nobody can type it before the import has happened, so asking for it on
  // the settings screen only ever asked somebody to go and look it up.
  const workflow = env.ORCHESTRATOR_WORKFLOW_ID?.trim();
  if (workflow) out.orchestratorWorkflowId = workflow;

  const api = env.ANTHROPIC_API_KEY?.trim();
  const oauth = env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (api) out.modelKey = { value: api, from: 'ANTHROPIC_API_KEY' };
  else if (oauth) out.modelKey = { value: oauth, from: 'CLAUDE_CODE_OAUTH_TOKEN' };

  return out;
}
