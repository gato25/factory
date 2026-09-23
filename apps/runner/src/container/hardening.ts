/**
 * What every sandbox container is denied, beyond running as an unprivileged
 * user.
 *
 * `--user 1000:1000` is the first line: an agent runs arbitrary code from a
 * customer repository, and it must not run as root (FR-046). These are the
 * second, for the ways a non-root process becomes something more, or takes
 * the machine down without becoming anything:
 *
 * - `--cap-drop ALL`: no capability at all, even the handful Docker grants a
 *   container by default (chown, setuid, net_bind_service, …). Nothing a
 *   build or a test suite does as uid 1000 needs one.
 * - `--security-opt no-new-privileges`: a setuid binary in the image — or in
 *   a dependency an install pulled in — cannot raise the process's
 *   privileges when executed. This is what turns "runs as 1000" from a
 *   starting point into a ceiling.
 * - `--pids-limit`: a fork bomb, deliberate or a runaway test runner, ends
 *   at the limit instead of at the host's process table. The number counts
 *   THREADS, not processes: a browser under Playwright is dozens of them and
 *   a Node test runner with workers is a few hundred, so this is set well
 *   above anything a real build needs and well below anything that could
 *   hurt the machine.
 *
 * Applied to a run's sandbox (`host.ts`) and to an isolated step's container
 * (`isolate.ts`) alike; the image is proven to build, test and commit under
 * all three (`sandbox-images.test.ts` reads this file to hold them in place).
 */

export const SANDBOX_PIDS_LIMIT = 2048;

export const HARDENING_ARGS: readonly string[] = [
  '--cap-drop',
  'ALL',
  '--security-opt',
  'no-new-privileges',
  '--pids-limit',
  String(SANDBOX_PIDS_LIMIT),
];
