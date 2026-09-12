import { describe, expect, test } from 'bun:test';
import { dockerHost } from '../../src/container/host';
import { WORK_USER } from '../../src/container/hosted-command';

/**
 * That each execution host's sandbox image matches how that host drives it.
 *
 * There are two images because the two hosts have contradictory requirements,
 * and getting either wrong produces a container that builds and deploys
 * perfectly and then fails every run:
 *
 * - The managed host reaches a sandbox only through a control server that IS
 *   the base image's entrypoint. Replace it and nothing can drive the sandbox —
 *   which presented as a two-minute hang, not an error.
 * - The local host keeps a container alive by running `sleep <seconds>` as the
 *   COMMAND. Give that image an entrypoint and the command becomes arguments
 *   to it instead: `ENTRYPOINT ["/bin/bash","-lc"]` turns `sleep 5400` into
 *   bash running `sleep` with no operand, so the container exits immediately.
 *
 * Both mistakes were actually made in this repository. These read the
 * Dockerfiles rather than trusting the comments in them.
 */

const local = await Bun.file('infra/sandbox/Dockerfile').text();
const hosted = await Bun.file('infra/sandbox/Dockerfile.hosted').text();

/** Lines that actually instruct Docker, with comments and blanks removed. */
const directives = (dockerfile: string) =>
  dockerfile
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

describe('the local image, driven by `docker run … sleep <seconds>`', () => {
  test('declares no ENTRYPOINT and no CMD', () => {
    // The whole bug, in one assertion.
    for (const directive of ['ENTRYPOINT', 'CMD']) {
      expect(
        directives(local).some((line) => line.toUpperCase().startsWith(directive)),
        `the local image must not set ${directive} — it would swallow the sleep that keeps the container alive`,
      ).toBe(false);
    }
  });

  test('the host really does pass sleep as the command', async () => {
    // Asserted against the host rather than assumed, so that changing one and
    // not the other fails here instead of in production.
    const source = await Bun.file('apps/runner/src/container/host.ts').text();
    expect(source).toContain("'sleep'");
    expect(source).toContain('--user');
    expect(source).toContain('1000:1000');
    expect(typeof dockerHost.create).toBe('function');
  });

  test('runs as the uid the host asks for, and owns its workspace', () => {
    expect(local).toContain('USER 1000:1000');
    expect(local).toContain('chown 1000:1000 /work');
  });

  test('installs both agent engines and verifies them', () => {
    // `|| true` is what hid the Claude CLI never being installed. It must not
    // come back, in either image.
    for (const [name, dockerfile] of [
      ['local', local],
      ['hosted', hosted],
    ] as const) {
      // Directives only — both files DESCRIBE the old `|| true` in a comment,
      // and that explanation is worth keeping. What must not come back is the
      // instruction.
      expect(
        directives(dockerfile).join('\n'),
        `${name}: a swallowed failure is how this broke before`,
      ).not.toContain('|| true');
      expect(dockerfile).toContain('@anthropic-ai/claude-code@');
      expect(dockerfile).toContain('claude --version');
    }
  });
});

describe('the hosted image, driven through a control server', () => {
  test('keeps the base image’s entrypoint by declaring none of its own', () => {
    for (const directive of ['ENTRYPOINT', 'CMD']) {
      expect(
        directives(hosted).some((line) => line.toUpperCase().startsWith(directive)),
        `the hosted image must not set ${directive} — the control server is the base image's`,
      ).toBe(false);
    }
  });

  test('creates the unprivileged user the managed host drops to', () => {
    // The managed host cannot use `docker run --user`, so it wraps each
    // command in `setpriv --reuid=<user>`. That user has to exist.
    expect(hosted).toContain('useradd');
    expect(hosted).toContain(WORK_USER);
  });

  test('wrangler builds the hosted image, not the local one', async () => {
    const config = await Bun.file('apps/runner/wrangler.jsonc').text();
    expect(config).toContain('infra/sandbox/Dockerfile.hosted');
  });
});
