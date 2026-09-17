import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FactoryError } from '@factory/shared';

/**
 * Where `sh` is, on a machine that does not put it on the PATH.
 *
 * Every script the runner hands a sandbox is written for a POSIX shell, and
 * on Linux and macOS `sh` is simply there. On Windows it is not — and the
 * `bash` that IS on the PATH is Windows' own WSL launcher, which would run the
 * script in a Linux distribution that has none of this machine's tools. What
 * is wanted is the shell that comes with Git for Windows, because the Claude
 * CLI itself requires that same shell and so it is present on any machine that
 * can run an agent step at all.
 *
 * Resolved once and cached: the answer cannot change while the process runs.
 */
let resolved: string | undefined;

export function resolveShell(env: Record<string, string | undefined> = process.env): string {
  if (resolved) return resolved;
  resolved = findShell(env);
  return resolved;
}

function findShell(env: Record<string, string | undefined>): string {
  if (process.platform !== 'win32') return 'sh';

  const candidates: string[] = [];

  // The CLI's own setting for the same question, when somebody has made one.
  const claudeBash = env.CLAUDE_CODE_GIT_BASH_PATH?.trim();
  if (claudeBash) candidates.push(join(dirname(claudeBash), 'sh.exe'), claudeBash);

  // Next to git itself: `<Git>/cmd/git.exe` sits beside `<Git>/bin/sh.exe`.
  const git = Bun.which('git', { PATH: env.PATH ?? '' });
  if (git) {
    const root = dirname(dirname(git));
    candidates.push(join(root, 'bin', 'sh.exe'), join(root, 'usr', 'bin', 'sh.exe'));
  }

  // The usual install locations, for a git that is not on the PATH either.
  for (const base of [
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs'),
  ]) {
    if (base) candidates.push(join(base, 'Git', 'bin', 'sh.exe'));
  }

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new FactoryError(
      'engine_unavailable',
      'No POSIX shell was found. Install Git for Windows, which provides one, or set ' +
        'CLAUDE_CODE_GIT_BASH_PATH to its bash.exe.',
    );
  }
  return found;
}

/** For tests, which need to prove the fallback rather than the cached answer. */
export function forgetResolvedShell(): void {
  resolved = undefined;
}
