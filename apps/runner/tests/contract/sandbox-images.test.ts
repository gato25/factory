import { describe, expect, test } from 'bun:test';
import { dockerHost } from '../../src/container/host';

/**
 * That the sandbox image matches how the host drives it.
 *
 * Getting this wrong produces a container that builds perfectly and then
 * fails every run: the host keeps a container alive by running
 * `sleep <seconds>` as the COMMAND, so an image with an entrypoint turns that
 * into arguments to the entrypoint instead. `ENTRYPOINT ["/bin/bash","-lc"]`
 * made `sleep 5400` into bash running `sleep` with no operand, and the
 * container exited before the first step. That mistake was actually made in
 * this repository. This reads the Dockerfile rather than trusting the
 * comments in it.
 */

const local = await Bun.file('infra/sandbox/Dockerfile').text();

/** Lines that actually instruct Docker, with comments and blanks removed. */
const directives = (dockerfile: string) =>
  dockerfile
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

describe('the sandbox image, driven by `docker run … sleep <seconds>`', () => {
  test('declares no ENTRYPOINT and no CMD', () => {
    // The whole bug, in one assertion.
    for (const directive of ['ENTRYPOINT', 'CMD']) {
      expect(
        directives(local).some((line) => line.toUpperCase().startsWith(directive)),
        `the image must not set ${directive} — it would swallow the sleep that keeps the container alive`,
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
    // come back. Directives only — the file DESCRIBES the old `|| true` in a
    // comment, and that explanation is worth keeping.
    expect(
      directives(local).join('\n'),
      'a swallowed failure is how this broke before',
    ).not.toContain('|| true');
    expect(local).toContain('@anthropic-ai/claude-code@');
    expect(local).toContain('claude --version');
  });
});
