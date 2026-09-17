import { FactoryError } from '@factory/shared';

export interface WebConfig {
  databaseUrl: string;
  runnerBaseUrl: string;
  runnerAuthToken: string;
  publicBaseUrl: string;
  /**
   * Where the execution service reaches this application to post callbacks,
   * which is not necessarily where a browser does.
   *
   * `PUBLIC_BASE_URL` is the address a PERSON uses — it is in links and in
   * the provider sign-in callbacks, so it has to be the one their browser can
   * open. Where the execution service runs on the same machine, as it does in
   * development, the two are the same address and this falls back to that
   * one. Where it runs somewhere `localhost` means something else — a
   * container, another host — it needs its own name, and this is it.
   */
  callbackBaseUrl: string;
  sessionSecret: string;
}

const REQUIRED: (keyof WebConfig)[] = [
  'databaseUrl',
  'runnerBaseUrl',
  'runnerAuthToken',
  'publicBaseUrl',
  'sessionSecret',
];

const ENV_NAMES: Record<keyof WebConfig, string> = {
  databaseUrl: 'DATABASE_URL',
  runnerBaseUrl: 'RUNNER_BASE_URL',
  runnerAuthToken: 'RUNNER_AUTH_TOKEN',
  publicBaseUrl: 'PUBLIC_BASE_URL',
  callbackBaseUrl: 'CALLBACK_BASE_URL',
  sessionSecret: 'SESSION_SECRET',
};

/**
 * Where the execution service listens, and where this application does, when
 * nobody has said otherwise.
 *
 * These are not preferences. The execution service defaults itself to 8080
 * and Vite serves 5173 — so on a development machine there is exactly one
 * right answer for each, written down in the repository already. Asking for
 * them in `.env` and then AGAIN on the settings screen asked twice for a fact
 * neither person nor machine had any choice about.
 *
 * Development only. A deployment's services are somewhere else by definition,
 * and silently pointing it at its own localhost would turn a missing variable
 * into a connection refused much further along, so there the variable is
 * still required and `loadWebConfig` still refuses to start without it.
 */
const DEV_DEFAULTS: Record<string, string> = {
  RUNNER_BASE_URL: 'http://localhost:8080',
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
    publicBaseUrl: read('PUBLIC_BASE_URL'),
    // Falls back to the public address: where the execution service runs on
    // this machine, as `bun run dev` starts it, they ARE the same address, and
    // asking for both would be asking twice for one fact.
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
  for (const key of ['runnerBaseUrl', 'publicBaseUrl'] as const) {
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
 * The runner address the dashboard reported missing on a new deployment was
 * already in `.env`, where the same person had just typed it. The application
 * read it for its own use and then asked for it again in Settings. That is
 * not a setting; it is the same fact wanted in two places, and the second
 * place should be filled from the first.
 *
 * The model credential is the second. It cannot have a default, but it can be
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
  if (runner) out.runnerBaseUrl = runner;

  const api = env.ANTHROPIC_API_KEY?.trim();
  const oauth = env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (api) out.modelKey = { value: api, from: 'ANTHROPIC_API_KEY' };
  else if (oauth) out.modelKey = { value: oauth, from: 'CLAUDE_CODE_OAUTH_TOKEN' };

  return out;
}
