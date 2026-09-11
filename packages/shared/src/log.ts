import { createRedactor, type Redactor } from './redact';

export type Level = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

/**
 * Structured, one JSON object per line. Every message and field passes
 * through the redactor before it is written, because redaction happens at
 * ingest rather than at display (Principle V).
 */
export function createLogger(
  service: string,
  options: {
    redact?: Redactor;
    bound?: Record<string, unknown>;
    sink?: (line: string) => void;
  } = {},
): Logger {
  const redact = options.redact ?? createRedactor();
  const bound = options.bound ?? {};
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));

  const emit = (level: Level, message: string, fields?: Record<string, unknown>) => {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries({ ...bound, ...fields })) {
      scrubbed[key] = typeof value === 'string' ? redact(value) : value;
    }
    sink(
      JSON.stringify({
        at: new Date().toISOString(),
        level,
        service,
        msg: redact(message),
        ...scrubbed,
      }),
    );
  };

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (fields) => createLogger(service, { ...options, bound: { ...bound, ...fields } }),
  };
}
