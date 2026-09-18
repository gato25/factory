/**
 * What an agent may not do to the machine it is running on.
 *
 * The constitution's sandbox is "non-root, bounded in processing power,
 * memory and lifetime". The process host delivers the lifetime ceiling and
 * none of the rest: a step there is an ordinary process owned by whoever
 * started the runner, sharing that account's whole process table. So an agent
 * asked to verify its work against a running dev server can start one, and
 * then tidy up with the command anybody would reach for:
 *
 *     Get-Process -Name bun | Stop-Process -Force
 *
 * which on this host names the runner supervising the step, the application
 * serving the browser, and every other project open on the desktop. That is
 * not a hypothetical. It ended a run four steps in, left the agent orphaned
 * and still writing for twenty minutes into a workspace nobody was reading,
 * and froze the run at a point no callback would ever arrive from.
 *
 * A container answers this by making the process table small enough that the
 * command means what the agent thought it meant. Until every step runs in
 * one, the CLI is told to refuse the shape of command that cannot be meant:
 * ending processes chosen by NAME rather than by an id the agent itself
 * obtained. Ending something it started is ordinary work and stays allowed.
 *
 * This is a guard rail and not a boundary. It reads the command as text, so a
 * determined agent could phrase its way around it, and a `PreToolUse` hook
 * that fails to run at all lets the call through — the CLI treats every exit
 * code but 2 as a non-blocking error. Both are acceptable for what this is
 * for, which is the accident and not the adversary. Neither is acceptable
 * silently, which is why `SELF_TEST` exists and why the caller checks it.
 */

import type { ContainerHost } from './host';

interface Rule {
  /** Denied when this matches the command... */
  deny: RegExp;
  /** ...unless this does, which is how a pid-scoped kill stays allowed. */
  unless?: RegExp;
  /** Said to the agent, so it can do what it meant a different way. */
  reason: string;
}

const BY_NAME =
  'This would end processes chosen by name, which reaches every process this step can see rather ' +
  'than the one you meant. Where a step runs outside a container that includes the runner ' +
  'supervising it, so a kill by name ends this run along with its target. End only what you ' +
  'started, by the process id you captured when you started it — in PowerShell ' +
  '`$p = Start-Process ... -PassThru` and then `Stop-Process -Id $p.Id`, and on a POSIX shell ' +
  'the `$!` of the command you backgrounded.';

const NOT_YOURS =
  'Services, machine power state and other sessions do not belong to this run, and where a step ' +
  'runs outside a container this reaches the whole machine. Keep the work inside the workspace.';

/**
 * Where a command can begin: the start of the line, or after a separator.
 *
 * Without this the guard matched the word wherever it appeared, including
 * inside somebody else's text — `git commit -m "add the killall helper"` was
 * refused, which teaches an agent that the rule is arbitrary. Anchoring to a
 * command position costs nothing against the accident this is for, because a
 * command that runs is a command at a command position.
 */
const AT = String.raw`(?:^|[;|&(){}\n]|&&|\|\|)\s*(?:sudo\s+)?`;

/** A rule whose verb must be the command being run, not a word in a string. */
const at = (pattern: string, flags = 'i'): RegExp => new RegExp(AT + pattern, flags);

export const RULES: Rule[] = [
  // `Stop-Process -Name x`, and the pipeline form, which carries no selector
  // of its own: `Get-Process -Name x | Stop-Process`.
  { deny: at(String.raw`Stop-Process\b`), unless: /-Id\b/i, reason: BY_NAME },
  // `taskkill /IM bun.exe` ends by image name; `/PID` is the scoped form.
  { deny: at(String.raw`taskkill\b`), unless: /\/PID\b/i, reason: BY_NAME },
  // Both of these select by name by definition.
  { deny: at(String.raw`(?:pkill|killall)\b`), reason: BY_NAME },
  // A name resolved to ids and then killed is a kill by name with one step in
  // between: `kill $(pgrep -f bun)`, `pgrep bun | xargs kill -9`.
  { deny: at(String.raw`kill\b[^\n]*\$\((?:pgrep|pidof)\b`), reason: BY_NAME },
  {
    deny: /\b(?:pgrep|pidof)\b[^\n]*\|\s*(?:sudo\s+)?(?:xargs[^|\n]*)?kill\b/i,
    reason: BY_NAME,
  },
  // The .NET route to the same place. Distinctive enough to need no anchor.
  { deny: /GetProcessesByName/i, reason: BY_NAME },
  // `wmic process where name='bun.exe' delete`.
  { deny: at(String.raw`wmic\b[^\n]*\bdelete\b`), reason: BY_NAME },
  {
    // One group, not two alternations: a top-level `|` here would escape the
    // anchor `at` adds and leave the second half matching anywhere, which is
    // the false positive this anchoring exists to prevent.
    deny: at(
      '(?:Stop-Service|Restart-Service|Restart-Computer|Stop-Computer|shutdown' +
        String.raw`|net\s+stop|systemctl\s+(?:stop|restart|disable))\b`,
    ),
    reason: NOT_YOURS,
  },
];

/** The reason this command is refused, or null when it is allowed. */
export function deniedReason(command: string): string | null {
  for (const rule of RULES) {
    if (!rule.deny.test(command)) continue;
    if (rule.unless?.test(command)) continue;
    return rule.reason;
  }
  return null;
}

/**
 * The command the guard checks itself against.
 *
 * Exactly the one that caused the incident, so a self-test that passes is
 * evidence about what actually happened rather than about a pattern invented
 * to be caught.
 */
export const SELF_TEST = 'Get-Process -Name bun | Stop-Process -Force';

/** Where the two files live, relative to the workspace root. */
export const GUARD_SCRIPT_PATH = '.claude/factory-guard.mjs';
export const GUARD_SETTINGS_PATH = '.claude/factory-guard.json';

/**
 * The hook, as a script the sandbox's `node` can run.
 *
 * The rules are serialised out of the list above rather than written a second
 * time in JavaScript: one statement of the policy, tested once, in
 * `guard.test.ts`.
 */
export function guardScript(): string {
  const serialised = JSON.stringify(
    RULES.map((rule) => ({
      deny: rule.deny.source,
      denyFlags: rule.deny.flags,
      unless: rule.unless?.source ?? null,
      unlessFlags: rule.unless?.flags ?? '',
      reason: rule.reason,
    })),
  );
  return [
    '// Written by the runner for this workspace. Editing it here changes nothing:',
    '// it is rewritten from apps/runner/src/container/guard.ts before every step.',
    `const RULES = ${serialised};`,
    '',
    'function deniedReason(command) {',
    '  for (const rule of RULES) {',
    '    if (!new RegExp(rule.deny, rule.denyFlags).test(command)) continue;',
    '    if (rule.unless && new RegExp(rule.unless, rule.unlessFlags).test(command)) continue;',
    '    return rule.reason;',
    '  }',
    '  return null;',
    '}',
    '',
    '// Asked by the runner before the step runs, because a hook that cannot',
    '// run does not block anything and says nothing while not blocking it.',
    'if (process.argv.includes("--self-test")) {',
    `  process.exit(deniedReason(${JSON.stringify(SELF_TEST)}) ? 2 : 9);`,
    '}',
    '',
    'let raw = "";',
    'process.stdin.setEncoding("utf8");',
    'for await (const chunk of process.stdin) raw += chunk;',
    'let input = {};',
    'try { input = JSON.parse(raw); } catch {}',
    'const given = input && input.tool_input ? input.tool_input : {};',
    '// The command, under whatever key this tool names it; failing that, every',
    '// string it was given, so a rename upstream cannot quietly disable the',
    '// guard.',
    'const command = typeof given.command === "string"',
    '  ? given.command',
    '  : Object.values(given).filter((value) => typeof value === "string").join(" ");',
    'const reason = deniedReason(command);',
    'if (reason) {',
    '  process.stderr.write(reason);',
    '  // 2 is the only code that blocks. Every other code, including a crash',
    '  // in this file, lets the command through as a non-blocking error.',
    '  process.exit(2);',
    '}',
    'process.exit(0);',
    '',
  ].join('\n');
}

/**
 * The settings the CLI is started with.
 *
 * Passed as `--settings` rather than left in the workspace's own
 * `.claude/settings.json` for two reasons: it takes precedence over whatever
 * the repository ships, and it does not depend on the trust dialog having
 * been accepted for this directory.
 *
 * `${CLAUDE_PROJECT_DIR}` rather than a relative path because the hook's
 * working directory is not guaranteed to be the workspace root, and rather
 * than an absolute one because the two execution hosts disagree about what
 * the workspace is called — `/work` in a container, a directory under the
 * work root on a developer machine.
 */
export function guardSettings(): unknown {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash|PowerShell',
          hooks: [
            {
              type: 'command',
              command: 'node',
              args: [`\${CLAUDE_PROJECT_DIR}/${GUARD_SCRIPT_PATH}`],
            },
          ],
        },
      ],
    },
  };
}

/**
 * Writes the guard into the workspace and checks that it works.
 *
 * The check is the point. A hook the CLI cannot run is not an error anybody
 * sees: the command is allowed, the step carries on, and the only evidence is
 * a line in a debug log nobody is reading. So the guard is asked, before the
 * step starts, to judge the command from the incident, and it must answer the
 * way it would answer for real — exit 2. Anything else means there is no
 * guard, and the step says so in its own log rather than pretending.
 *
 * Not fatal. A missing `node` is a reason to warn loudly and carry on, not a
 * reason to refuse to run a ticket; the run was going to have no guard either
 * way, and now somebody knows.
 */
export async function installGuard(
  host: ContainerHost,
  containerId: string,
  workdir: string,
  warn?: (line: string) => void,
): Promise<void> {
  await host.writeFile(containerId, `${workdir}/${GUARD_SCRIPT_PATH}`, guardScript());
  await host.writeFile(
    containerId,
    `${workdir}/${GUARD_SETTINGS_PATH}`,
    `${JSON.stringify(guardSettings(), null, 2)}\n`,
  );

  if (!warn) return;
  const probe = await host
    .exec(containerId, ['node', `${workdir}/${GUARD_SCRIPT_PATH}`, '--self-test'])
    .catch((error: unknown) => ({
      exitCode: -1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    }));
  if (probe.exitCode === 2) return;
  warn(
    `⚠ The command guard did not answer (exit ${probe.exitCode}). Commands this step runs are ` +
      `not being checked, and on this execution host they reach the whole machine. ` +
      `${probe.stderr.trim() || probe.stdout.trim()}`.trim(),
  );
}
