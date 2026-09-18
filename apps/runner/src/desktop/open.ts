import { stat } from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { FactoryError } from '@factory/shared';
import type { ContainerHost } from '../container/host';
import { log } from '../errors';

/**
 * Opening a run's design in the desktop application on this machine.
 *
 * A `.pen` file is not something a browser can draw, and pen.dev publishes no
 * link a browser could follow: its share-by-link is made by a person inside
 * their own application, and the CLI has no command that produces one. What
 * the machine does have is the file association — `.pen` opens the desktop
 * app — so the shortest path from "I can see the screens" to "I can edit the
 * design" is for this service to hand the file to the machine's own handler.
 *
 * **This is a development convenience and is written to be honest about it.**
 * It only means anything when the runner is on the same machine as the
 * browser, which is exactly the local setup and never a deployment. Asked of a
 * runner that executes in containers, or that is not on your desktop, it
 * refuses and says why rather than silently opening a window nobody is in
 * front of.
 *
 * What it will not do is open anything it was asked to. The application is
 * the internet-facing service, so the path it sends is untrusted: it must be
 * a design source, inside the workspace of the run it names, and the resolved
 * path is checked against that workspace after resolution rather than before,
 * because `..` is only visible once it has been applied.
 */

/** Only this. The whole feature is "open the design", not "open a file". */
const OPENABLE = /\.pen$/i;

export interface OpenDeps {
  host: ContainerHost & { root?: string };
  /** The run's sandbox, which for the process host names its directory. */
  containerIdFor: (runId: string) => Promise<string | undefined>;
  /** Injected by a test, which must not open a window. */
  launch?: (argv: string[]) => void;
  platform?: NodeJS.Platform;
}

/**
 * The command that hands a file to whatever the machine opens it with.
 *
 * The association, not a path to the application: the machine already knows
 * which program owns a `.pen`, and asking it is both shorter and correct when
 * the person has a different version installed than we would have guessed.
 */
export function openerFor(platform: NodeJS.Platform, path: string): string[] {
  if (platform === 'win32') {
    /**
     * `explorer.exe`, and not `cmd /c start`.
     *
     * `start` takes a window title before the file, and the idiom is an empty
     * one: `start "" "<path>"`. Passed as separate arguments, the empty string
     * does not survive the argument list Bun builds for Windows, so `start`
     * read the PATH as its title, opened nothing, and exited 0 — a button
     * that reported success 39 times without ever starting the application.
     * Passed as one string for `cmd` to parse, it is "Access is denied".
     *
     * `explorer.exe` takes the path and hands it to whatever the machine
     * associates with it, which is the thing being asked for. It exits 1 even
     * when it worked, which is why nothing here reads its exit code.
     */
    return ['explorer.exe', path];
  }
  return platform === 'darwin' ? ['open', path] : ['xdg-open', path];
}

export async function openDesignFile(
  deps: OpenDeps,
  runId: string,
  path: string,
): Promise<{ opened: true; path: string }> {
  const platform = deps.platform ?? process.platform;

  // A container's filesystem is not this machine's, so there is nothing here
  // to open. Said plainly, because the alternative is a button that does
  // nothing for a reason nobody can see.
  const root = deps.host.root;
  if (!root) {
    throw new FactoryError(
      'invalid_input',
      'This runner executes in containers, so a design file is not on this machine to be ' +
        'opened. Download it from the ticket instead.',
    );
  }

  if (!OPENABLE.test(path)) {
    throw new FactoryError('invalid_input', 'only a .pen design source can be opened this way');
  }
  if (isAbsolute(path) || path.includes('\0')) {
    throw new FactoryError('invalid_input', 'a design is named by its path within the run');
  }

  const containerId = await deps.containerIdFor(runId);
  if (!containerId) {
    throw new FactoryError('not_found', 'that run has no workspace on this machine');
  }

  const workspace = resolve(join(root, containerId));
  const target = resolve(join(workspace, normalize(path)));
  // After resolution, not before: `docs/../../../etc/passwd` looks harmless
  // until it has been applied.
  if (target !== workspace && !target.startsWith(workspace + sep)) {
    throw new FactoryError('invalid_input', 'that path is outside the run’s workspace');
  }

  const found = await stat(target).catch(() => null);
  if (!found?.isFile()) {
    throw new FactoryError(
      'not_found',
      'that design is no longer on this machine. A workspace is removed when its run ends; ' +
        'the file is still on the run’s branch.',
    );
  }

  const argv = openerFor(platform, target);
  log.info('opening a design in the desktop application', { run_id: runId, path });
  (deps.launch ?? spawnDetached)(argv);
  return { opened: true, path };
}

/**
 * Started and let go of. The handler outlives this request by design — we are
 * opening a window for somebody, not running a command whose output we want.
 */
function spawnDetached(argv: string[]): void {
  Bun.spawn(argv, { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }).unref();
}
