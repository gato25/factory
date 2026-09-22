import { describe, expect, test } from 'bun:test';

/**
 * That the runner image and its compose service keep the arrangement the
 * operations guide promises: docker-out-of-docker, non-root, the same
 * workspace path inside and out, and no development credential.
 *
 * Read from the files rather than trusted from the comments in them, as
 * `sandbox-images.test.ts` does for the sandbox image.
 */

const dockerfile = await Bun.file('infra/runner/Dockerfile').text();
const compose = await Bun.file('infra/runner/compose.yml').text();
const bunVersion = (await Bun.file('.bun-version').text()).trim();

/**
 * Lines that actually instruct Docker, with comments and blanks removed and
 * a directive continued over several lines read as one.
 */
const directives = dockerfile
  .replace(/\\\n\s*/g, ' ')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'));

describe('the runner image', () => {
  test('runs the bun everyone else runs', () => {
    expect(directives.some((d) => d.startsWith(`FROM oven/bun:${bunVersion}`))).toBe(true);
  });

  test('carries the Docker CLI, pinned, and no daemon', () => {
    expect(directives.some((d) => /^COPY --from=docker:\d+\.\d+\.\d+-cli /.test(d))).toBe(true);
    expect(dockerfile).not.toMatch(/docker:dind|dockerd/);
  });

  test('runs as the sandbox’s uid, so a bind-mounted workspace is writable in a step', () => {
    // `bun` is uid 1000 in the base image, which is the uid `isolate.ts` runs
    // a step's container as. The USER directive must precede the CMD.
    const user = directives.indexOf('USER bun');
    const cmd = directives.findIndex((d) => d.startsWith('CMD'));
    expect(user).toBeGreaterThan(-1);
    expect(cmd).toBeGreaterThan(user);
  });

  test('is the docker execution host, in production, and nothing else', () => {
    const env = directives.filter((d) => d.startsWith('ENV')).join(' ');
    expect(env).toContain('EXECUTION_HOST=docker');
    expect(env).toContain('NODE_ENV=production');
    // No development credential can be baked in: `config.ts` refuses the
    // fallback under NODE_ENV=production, and nothing here sets a token.
    expect(dockerfile).not.toContain('RUNNER_AUTH_TOKEN=');
    expect(dockerfile).not.toContain('dev-only-token');
  });

  test('answers a health check from inside', () => {
    expect(directives.some((d) => d.startsWith('HEALTHCHECK'))).toBe(true);
    expect(dockerfile).toContain('/health');
  });

  test('installs only what the runner is', () => {
    // The web application's source never enters the image; only its manifest,
    // which the frozen lockfile wants to see.
    expect(dockerfile).toContain('COPY apps/web/package.json apps/web/package.json');
    expect(dockerfile).not.toMatch(/COPY apps\/web (?!package)/);
    expect(dockerfile).toContain('bun install --production --frozen-lockfile');
  });
});

describe('the compose service', () => {
  test('is docker-out-of-docker: the host’s socket, no privilege', () => {
    expect(compose).toContain('/var/run/docker.sock:/var/run/docker.sock');
    expect(compose).not.toMatch(/^\s*privileged:/m);
    expect(compose).toContain('group_add');
  });

  test('mounts the runs directory at the same path inside and out', () => {
    // The daemon resolves a bind-mount source on the host, so the path the
    // runner names must be the path the host has.
    const match = compose.match(
      /- '(\$\{FACTORY_RUNS_DIR:-[^}]+\}):(\$\{FACTORY_RUNS_DIR:-[^}]+\})'/,
    );
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(match?.[2]);
    expect(compose).toMatch(/FACTORY_WORK_DIR: '\$\{FACTORY_RUNS_DIR:-\/srv\/factory\/runs\}'/);
  });

  test('keeps the run positions on a volume, and the runner on the host’s network', () => {
    expect(compose).toContain('factory-runner-state:/srv/factory/state');
    expect(compose).toContain('FACTORY_STATE_DIR: /srv/factory/state');
    expect(compose).toContain('network_mode: host');
  });

  test('restarts the runner, bounds it, and rotates its logs', () => {
    expect(compose).toContain('restart: unless-stopped');
    expect(compose).toMatch(/mem_limit: \d+[gm]/);
    expect(compose).toMatch(/pids_limit: \d+/);
    expect(compose).toContain("max-size: '50m'");
  });

  test('refuses to start without a credential of the operator’s own', () => {
    expect(compose).toMatch(/RUNNER_AUTH_TOKEN: '\$\{RUNNER_AUTH_TOKEN:\?/);
  });
});
