/**
 * Stopping a service means stopping what it started.
 *
 * `bun run dev:web` is a wrapper around vite, not vite; `bun run dev:runner` is
 * a wrapper around the execution service, not the service. Signalling a wrapper
 * does not signal what it started, so `proc.kill()` on one of these returns
 * promptly, reports success, and leaves a server running and still holding its
 * port.
 *
 * That is measured rather than assumed. The first version of `scripts/dev.ts`
 * called `proc.kill()`: after it, `http://127.0.0.1:8080/health` still answered.
 * The visible consequence is not the orphan itself — it is the NEXT
 * `bun run dev`, which fails to bind a port with nothing on screen to say why,
 * one terminal after the Ctrl-C that appeared to work.
 *
 * Kept apart from `dev.ts` so a test can reach it: `dev.ts` starts containers
 * the moment it is imported, which makes it untestable by construction.
 */

/**
 * Every process started underneath `pid`, deepest first.
 *
 * Deepest first matters: killing a parent first reparents its children to init,
 * and they stop being findable through the tree that is being walked.
 */
export function descendants(pid: number): number[] {
  const found = Bun.spawnSync(['pgrep', '-P', String(pid)]);
  return new TextDecoder()
    .decode(found.stdout)
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((child) => Number.isInteger(child) && child > 0)
    .flatMap((child) => [...descendants(child), child]);
}

/** Stops a process and everything it started. */
export function stopTree(proc: { pid: number; kill: (code?: number) => void }): void {
  if (process.platform === 'win32') {
    // The same idea, spelled the way Windows spells it — `/T` is the tree.
    // Not exercised by the test below, which skips on Windows, so this branch
    // is the one place here still taken on trust.
    Bun.spawnSync(['taskkill', '/pid', String(proc.pid), '/T', '/F'], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    return;
  }
  for (const pid of descendants(proc.pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone, which is the outcome being asked for.
    }
  }
  proc.kill();
}
