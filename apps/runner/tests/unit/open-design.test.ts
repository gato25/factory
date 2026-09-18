import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FactoryError } from '@factory/shared';
import { openDesignFile, openerFor } from '../../src/desktop/open';
import { FakeHost } from '../fake-host';

/**
 * Handing a run's design to the desktop application.
 *
 * A `.pen` is the one artifact the browser cannot draw and pen.dev publishes
 * no link to, so the way into the editor is the machine's own file
 * association. That makes this a convenience that exists only while the
 * execution service and the browser are the same machine — and it makes the
 * path it is given untrusted, because the thing sending it is the service
 * that faces the internet.
 */

async function workspace(files: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'factory-open-'));
  const id = 'ws-abc123';
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, id, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }
  await mkdir(join(root, id), { recursive: true });
  return { root, id, clean: () => rm(root, { recursive: true, force: true }) };
}

function deps(root: string | undefined, id: string | undefined, opened: string[][]) {
  return {
    host: Object.assign(new FakeHost(), root ? { root } : {}) as FakeHost & { root?: string },
    containerIdFor: async () => id,
    launch: (argv: string[]) => opened.push(argv),
    platform: 'win32' as NodeJS.Platform,
  };
}

describe('opening the design', () => {
  test('the file is handed to whatever this machine opens a .pen with', async () => {
    const ws = await workspace({ 'docs/design/ui.pen': 'a design' });
    const opened: string[][] = [];
    try {
      const result = await openDesignFile(
        deps(ws.root, ws.id, opened),
        'run-1',
        'docs/design/ui.pen',
      );
      expect(result.opened).toBe(true);
      // The association, not a path to an application we guessed at.
      expect(opened).toHaveLength(1);
      expect(opened[0]?.at(-1)).toBe(join(ws.root, ws.id, 'docs/design/ui.pen'));
    } finally {
      await ws.clean();
    }
  });

  test('the opener is the one the platform uses', () => {
    expect(openerFor('darwin', '/x/ui.pen')).toEqual(['open', '/x/ui.pen']);
    expect(openerFor('linux', '/x/ui.pen')).toEqual(['xdg-open', '/x/ui.pen']);
  });

  test('Windows opens through explorer, never through `start`', () => {
    // `start` wants an empty window title before the path, and that empty
    // argument does not survive the argument list Bun builds on Windows: the
    // path became the title, nothing opened, and the command exited 0 — a
    // button that reported success 39 times and started nothing. Explorer
    // takes the path and hands it to whatever opens that extension.
    const argv = openerFor('win32', 'C:\\x\\ui.pen');
    expect(argv).toEqual(['explorer.exe', 'C:\\x\\ui.pen']);
    expect(argv).not.toContain('start');
    expect(argv).not.toContain('');
  });
});

describe('what it refuses', () => {
  const failing = async (run: () => Promise<unknown>) => {
    try {
      await run();
      return null;
    } catch (error) {
      return error as FactoryError;
    }
  };

  test('a path that climbs out of the workspace', async () => {
    // The application sends this path and the application faces the internet.
    // `..` is only visible once it has been applied, so the check is made on
    // the resolved path rather than the given one.
    const ws = await workspace({ 'docs/design/ui.pen': 'a design' });
    const opened: string[][] = [];
    try {
      const error = await failing(() =>
        openDesignFile(deps(ws.root, ws.id, opened), 'run-1', '../../../../secrets.pen'),
      );
      expect(error?.reason).toBe('invalid_input');
      expect(opened).toHaveLength(0);
    } finally {
      await ws.clean();
    }
  });

  test('an absolute path', async () => {
    const ws = await workspace();
    const opened: string[][] = [];
    try {
      const error = await failing(() =>
        openDesignFile(deps(ws.root, ws.id, opened), 'run-1', 'C:/Windows/System32/x.pen'),
      );
      expect(error?.reason).toBe('invalid_input');
      expect(opened).toHaveLength(0);
    } finally {
      await ws.clean();
    }
  });

  test('anything that is not a design source', async () => {
    // The feature is "open the design", not "open a file". Without this it
    // would hand any extension to whatever the machine runs it with.
    const ws = await workspace({ 'run.bat': 'echo hello' });
    const opened: string[][] = [];
    try {
      for (const path of ['run.bat', 'docs/spec.md', 'ui.pen.exe']) {
        const error = await failing(() =>
          openDesignFile(deps(ws.root, ws.id, opened), 'run-1', path),
        );
        expect(error?.reason).toBe('invalid_input');
      }
      expect(opened).toHaveLength(0);
    } finally {
      await ws.clean();
    }
  });

  test('a host whose workspaces are not on this machine', async () => {
    // A container's filesystem is not this one, so there is nothing here to
    // open, and the refusal says what to do instead.
    const opened: string[][] = [];
    const error = await failing(() =>
      openDesignFile(deps(undefined, 'ws-abc123', opened), 'run-1', 'docs/design/ui.pen'),
    );
    expect(error?.reason).toBe('invalid_input');
    expect(error?.message).toContain('контейнер');
    expect(opened).toHaveLength(0);
  });

  test('a run with no workspace', async () => {
    const ws = await workspace();
    const opened: string[][] = [];
    try {
      const error = await failing(() =>
        openDesignFile(deps(ws.root, undefined, opened), 'run-1', 'docs/design/ui.pen'),
      );
      expect(error?.reason).toBe('not_found');
    } finally {
      await ws.clean();
    }
  });

  test('a design whose workspace has since been removed', async () => {
    // A workspace goes when its run ends. The file is still on the branch,
    // and the refusal says so rather than leaving somebody wondering.
    const ws = await workspace();
    const opened: string[][] = [];
    try {
      const error = await failing(() =>
        openDesignFile(deps(ws.root, ws.id, opened), 'run-1', 'docs/design/ui.pen'),
      );
      expect(error?.reason).toBe('not_found');
      expect(error?.message).toContain('салбар');
      expect(opened).toHaveLength(0);
    } finally {
      await ws.clean();
    }
  });
});
