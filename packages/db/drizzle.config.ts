import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineConfig } from 'drizzle-kit';

/**
 * Where `drizzle-kit generate` and `migrate` find the database.
 *
 * The address comes from `DATABASE_URL`, and when that is not in the
 * environment it is read from the repository's own `.env`. That fallback is
 * not a convenience: `bun run db:migrate` runs this package's script with the
 * working directory set to `packages/db`, and Bun reads `.env` only from the
 * directory it starts in — so the root `.env` was never seen. The old
 * fallback was a URL with no password, which a server requiring one refuses;
 * drizzle-kit reports that as an exit code with no message, so the operator
 * saw `Exited with code 1` and nothing else. `scripts/dev.ts` documents the
 * same trap for the execution service, and solves it by handing children the
 * values as real variables — which is why `bun run dev` was unaffected.
 */
function databaseUrl(): string {
  const fromEnvironment = process.env.DATABASE_URL;
  if (fromEnvironment) return fromEnvironment;

  // Upwards from wherever this was started, because both are ordinary: the
  // repository root (`bunx drizzle-kit --config …`) and `packages/db` (the
  // package's own script). drizzle-kit bundles this file before running it,
  // so `import.meta.dirname` is not available to locate the root directly.
  let directory = process.cwd();
  for (let up = 0; up < 4; up += 1) {
    const file = join(directory, '.env');
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('DATABASE_URL=')) continue;
        let value = trimmed.slice('DATABASE_URL='.length).trim();
        // `KEY="value"` and `KEY='value'` both appear in the wild; the quotes
        // are the file's syntax, not part of the address.
        if (value.length > 1 && /^["']/.test(value) && value.at(-1) === value[0]) {
          value = value.slice(1, -1);
        }
        if (value) return value;
      }
    }
    directory = dirname(directory);
  }

  // Said rather than guessed: a wrong address here fails without a reason.
  throw new Error(
    'DATABASE_URL is not set and the repository root has no .env with one. ' +
      'Copy .env.example to .env, or export DATABASE_URL before running drizzle-kit.',
  );
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl() },
});
