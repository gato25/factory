/**
 * Ending a command means ending what it started.
 *
 * A step is `sh -c '…'` around a CLI around whatever that CLI spawned, and
 * signalling the shell alone leaves the rest running: on the deadline for an
 * agent step, that would be a Claude CLI still working — and still spending —
 * after the runner had recorded the step as stopped. So the whole tree goes,
 * deepest first, because killing a parent first reparents its children and
 * they stop being findable through the tree being walked.
 *
 * The same idea `scripts/lib/process-tree.ts` applies to the dev services,
 * repeated here rather than imported because the runner does not depend on
 * the scripts directory.
 */
export function descendants(pid: number): number[] {
  const found = Bun.spawnSync(['pgrep', '-P', String(pid)], { stdout: 'pipe', stderr: 'ignore' });
  return new TextDecoder()
    .decode(found.stdout)
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((child) => Number.isInteger(child) && child > 0)
    .flatMap((child) => [...descendants(child), child]);
}

/** Kills a process and everything underneath it. Never throws. */
export function killTree(pid: number): void {
  if (process.platform === 'win32') {
    // `/T` is the tree, `/F` because a deadline is not a request.
    Bun.spawnSync(['taskkill', '/pid', String(pid), '/T', '/F'], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    return;
  }
  for (const child of [...descendants(pid), pid]) {
    try {
      process.kill(child, 'SIGKILL');
    } catch {
      // Already gone, which is the outcome being asked for.
    }
  }
}
