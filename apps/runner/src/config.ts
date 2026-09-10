export interface RunnerConfig {
  port: number;
  databaseUrl: string;
  sandboxImage: string;
  authToken: string;
}

/** Fails loudly at startup rather than at the first run (T035). */
export function loadRunnerConfig(): RunnerConfig {
  const missing: string[] = [];
  const need = (key: string, fallback?: string): string => {
    const value = process.env[key] ?? fallback;
    if (value === undefined) missing.push(key);
    return value ?? '';
  };

  const config: RunnerConfig = {
    port: Number(need('RUNNER_PORT', '8080')),
    databaseUrl: need('DATABASE_URL', 'postgres://postgres@localhost:5432/factory'),
    sandboxImage: need('SANDBOX_IMAGE', 'code-factory/sandbox:latest'),
    authToken: need('RUNNER_AUTH_TOKEN', 'dev-only-token'),
  };

  if (missing.length > 0) {
    throw new Error(`runner: missing required configuration: ${missing.join(', ')}`);
  }
  if (!Number.isFinite(config.port)) {
    throw new Error('runner: RUNNER_PORT must be a number');
  }
  return config;
}
