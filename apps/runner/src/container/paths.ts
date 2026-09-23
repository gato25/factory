import { FactoryError } from '@factory/shared';

/**
 * A path a person or the application named, held inside the workspace.
 *
 * Several paths reach a step's workspace as text somebody typed: the
 * documents a reviewer edited at a checkpoint (`edited_documents`, keyed by
 * path), the files a step must produce (`output_files`), the name of a skill
 * (which becomes a directory). Each was joined onto `/work/` and used. Under
 * the Docker host `/work/../../etc/x` stays inside the container; under the
 * process host `/work` is a directory on the machine and `..` walks out of
 * it — into `~/.claude/skills/`, say, where a skill named `../../.claude/
 * skills/ops` became a persistent instruction to every Claude Code session
 * on that machine. Confined here, once, and refused rather than corrected:
 * a caller that names a path outside the workspace is not making a typo.
 */
export function withinWorkspace(relative: string, what = 'path'): string {
  const raw = String(relative);
  if (raw.length === 0 || raw.includes('\0')) {
    throw new FactoryError('invalid_input', `the ${what} is empty or not a path`);
  }
  // Backslashes are separators to the Windows host and characters to a
  // POSIX one; treating them as separators everywhere is the safe reading.
  const slashed = raw.replaceAll('\\', '/');
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) {
    throw new FactoryError(
      'invalid_input',
      `the ${what} must be relative to the workspace: ${raw}`,
    );
  }
  const parts: string[] = [];
  for (const segment of slashed.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) {
        throw new FactoryError('invalid_input', `the ${what} leaves the workspace: ${raw}`);
      }
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  if (parts.length === 0) {
    throw new FactoryError('invalid_input', `the ${what} names the workspace itself: ${raw}`);
  }
  return parts.join('/');
}

/**
 * A name that becomes one directory: letters, digits, `.`, `-`, `_`, and
 * nothing that is a separator or a dot-only name. Used for skill names.
 */
export function directoryName(name: string, what = 'name'): string {
  const trimmed = String(name).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed) || /^\.+$/.test(trimmed)) {
    throw new FactoryError(
      'invalid_input',
      `the ${what} must be a single directory name (letters, digits, . - _): ${name}`,
    );
  }
  return trimmed;
}
