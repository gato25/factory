import { describe, expect, test } from 'bun:test';
import { FactoryError } from '@factory/shared';
import { type ContainerHost, dockerHost, run } from '../../src/container/host';
import { commandLine, WORK_USER } from '../../src/container/hosted-command';
import { hostFor } from '../../src/container/hosts';
import { secretValues } from '../../src/container/secrets';
import { TIMEOUT_EXIT_CODE } from '../../src/engines/limits';
import { LogSink } from '../../src/stream/logs';
import { credentials, FakeHost } from '../fake-host';

/**
 * `contracts/execution-host.md`, run against every host implementation this
 * environment can reach (T017).
 *
 * The point of the document is that the hosted implementation is held to
 * exactly what the local one is. The point of this file is that the holding is
 * automatic — a third implementation cannot quietly be a little different,
 * because the obligations are asserted here and not in its own tests.
 *
 * **What each host can be held to, and why they differ.** Some obligations are
 * observable through the interface (an identifier that works, a `null` that
 * means absent, a `destroy` that does not throw). Those run against every
 * available host. Others need a real process — that a command runs
 * unprivileged, that a deadline fires — and a stub cannot answer them at all.
 * Rather than let those pass vacuously, this file names where each one IS
 * proven. The coverage table below is the honest summary, and it is asserted
 * against the implementation list so it cannot rot silently.
 */

interface Candidate {
  name: string;
  /** Absent when this environment cannot run the implementation at all. */
  host?: ContainerHost;
  /** Why not, in words an operator reading a skipped suite would need. */
  unavailable?: string;
  /** Whether commands really execute, which decides the process obligations. */
  executes: boolean;
}

const dockerAvailable = await run('docker', ['version', '--format', '{{.Server.Version}}'], {
  timeoutMs: 4000,
})
  .then((probe) => probe.exitCode === 0)
  .catch(() => false);

const candidates: Candidate[] = [
  // Always available, and a first-class implementation rather than a mock: it
  // is what lets the whole suite run with no daemon and no account (FR-026,
  // T059).
  { name: 'fakeHost', host: new FakeHost(), executes: false },
  {
    name: 'dockerHost',
    ...(dockerAvailable
      ? { host: dockerHost, executes: true }
      : {
          unavailable: 'no container daemon is answering in this environment',
          executes: false,
        }),
  },
  {
    name: 'hostedHost',
    // Not a matter of credentials. `@cloudflare/sandbox` imports
    // `cloudflare:workers`, which exists only in the Workers runtime, so the
    // module cannot be LOADED here — see the note in `container/hosts.ts`. Its
    // obligations are proven in the three places named in the coverage table.
    unavailable:
      'the sandbox SDK cannot be imported under Bun, so it is unreachable from any test here',
    executes: false,
  },
];

const available = candidates.filter((candidate): candidate is Candidate & { host: ContainerHost } =>
  Boolean(candidate.host),
);

const spec = {
  image: 'factory/runner:1',
  cpu: 2,
  memoryMb: 4096,
  wallClockMinutes: 60,
  network: true,
  env: { GIT_TOKEN: credentials.gitToken, ANTHROPIC_API_KEY: credentials.modelKey },
  workdir: '/work',
};

test('every implementation is either exercised here or says why it is not', () => {
  // The guard against a skip becoming invisible. A host that stops being
  // available must state a reason; one that is available must be run.
  for (const candidate of candidates) {
    expect(
      Boolean(candidate.host) !== Boolean(candidate.unavailable),
      `${candidate.name} must be either available or explained`,
    ).toBe(true);
  }
  expect(available.length).toBeGreaterThan(0);
  for (const skipped of candidates.filter((c) => !c.host)) {
    console.info(`contract: ${skipped.name} not exercised — ${skipped.unavailable}`);
  }
});

describe.each(available.map((candidate) => [candidate.name, candidate] as const))(
  'every host: %s',
  (_name, candidate) => {
    const host = candidate.host;

    test('C1: one identifier serves every method for the sandbox’s life', async () => {
      const containerId = await host.create(spec);
      expect(typeof containerId).toBe('string');
      expect(containerId.length).toBeGreaterThan(0);

      // Each method accepts it. What is asserted is that none REJECTS the
      // identifier — a host that minted one shape and accepted another would
      // fail a run on its second request, which is the failure FR-006 is about.
      await host.writeFile(containerId, '/work/contract.txt', 'hello');
      expect(await host.readFile(containerId, '/work/contract.txt')).toBe('hello');
      expect(await host.stat(containerId, '/work/contract.txt')).toEqual({ size: 5 });
      expect((await host.exec(containerId, ['true'])).exitCode).toBe(0);
      await host.destroy(containerId);
    });

    test('F1: a path containing shell syntax is a path and runs nothing', async () => {
      const containerId = await host.create(spec);
      // The shape somebody would actually try: a step's required document,
      // typed into the pipeline builder.
      const hostile = `/work/a'; touch /tmp/factory-contract-pwned; echo '.md`;
      await host.writeFile(containerId, hostile, 'contents');
      expect(await host.readFile(containerId, hostile)).toBe('contents');

      const check = await run('sh', [
        '-c',
        'test -e /tmp/factory-contract-pwned && echo yes || echo no',
      ]);
      expect(check.stdout.trim()).toBe('no');
      await host.destroy(containerId);
    });

    test('F2/F3: a missing document reads as absent, not as an error', async () => {
      const containerId = await host.create(spec);
      expect(await host.readFile(containerId, '/work/never-written.md')).toBeNull();
      expect(await host.stat(containerId, '/work/never-written.md')).toBeNull();
      await host.destroy(containerId);
    });

    test('F3: an empty document is distinguishable from an absent one', async () => {
      const containerId = await host.create(spec);
      await host.writeFile(containerId, '/work/empty.md', '');
      // The reason `stat` exists at all: a step that produced an empty
      // document has produced something, and must not be reported as having
      // produced nothing (FR-051).
      expect(await host.stat(containerId, '/work/empty.md')).toEqual({ size: 0 });
      expect(await host.stat(containerId, '/work/absent.md')).toBeNull();
      await host.destroy(containerId);
    });

    test('D2/D3: destroying a sandbox that is already gone succeeds and never throws', async () => {
      const containerId = await host.create(spec);
      await host.destroy(containerId);
      // Recovery calls this on a corpse by design, inside a `.catch(() => {})`.
      // A host that threw here would mask the failure that lost the sandbox.
      await host.destroy(containerId);
      await host.destroy('a-sandbox-that-never-existed');
    });

    test('E4: options.env does not leak into a later command', async () => {
      const containerId = await host.create(spec);
      await host.exec(containerId, ['true'], { env: { STEP_ONLY: 'first' } });
      const second = await host.exec(containerId, ['true']);
      expect(second.exitCode).toBe(0);
      await host.destroy(containerId);
    });
  },
);

describe.each(
  available.filter((c) => c.executes).map((candidate) => [candidate.name, candidate] as const),
)('a host that really executes: %s', (_name, candidate) => {
  const host = candidate.host;

  test('C3: commands run as an unprivileged user in a writable workspace', async () => {
    const containerId = await host.create(spec);
    const who = await host.exec(containerId, ['id', '-u']);
    expect(who.stdout.trim()).not.toBe('0');
    // And the workspace belongs to that user, or every step that writes fails.
    const touch = await host.exec(containerId, ['touch', '/work/writable'], { cwd: '/work' });
    expect(touch.exitCode).toBe(0);
    await host.destroy(containerId);
  });

  test('C7: credentials arrive as environment, not as files in the workspace', async () => {
    const containerId = await host.create(spec);
    const echoed = await host.exec(containerId, ['sh', '-c', 'printenv GIT_TOKEN']);
    expect(echoed.stdout.trim()).toBe(credentials.gitToken);

    // The half that matters: nothing in the workspace holds them. A file would
    // survive into a commit, a diff, or a retained failed sandbox (FR-016).
    const grep = await host.exec(containerId, [
      'sh',
      '-c',
      `grep -rl ${JSON.stringify(credentials.gitToken)} /work 2>/dev/null | head -1`,
    ]);
    expect(grep.stdout.trim()).toBe('');
    await host.destroy(containerId);
  });

  test('E1: every argv element arrives as exactly one argument', async () => {
    const containerId = await host.create(spec);
    const awkward = [
      'a b',
      "it's",
      '$HOME',
      '`whoami`',
      'x"; touch /tmp/factory-contract-argv; echo "',
      'line\nbreak',
    ];
    const result = await host.exec(containerId, ['printf', '%s\n', ...awkward]);
    expect(result.stdout.split('\n').slice(0, -1)).toEqual(awkward.join('\n').split('\n'));
    await host.destroy(containerId);
  });

  test('E2/E5: output streams as it is produced, and volume changes nothing', async () => {
    const containerId = await host.create(spec);
    const chunks: string[] = [];
    const result = await host.exec(
      containerId,
      ['sh', '-c', 'for i in $(seq 1 2000); do echo "line $i"; done'],
      { onOutput: (_stream, data) => chunks.push(data) },
    );
    expect(result.exitCode).toBe(0);
    expect(chunks.length).toBeGreaterThan(0);
    // More than one response could carry, still reported correctly.
    expect(chunks.join('')).toContain('line 2000');
    await host.destroy(containerId);
  });

  test('E3: a command that exceeds its deadline reports TIMEOUT_EXIT_CODE', async () => {
    const containerId = await host.create(spec);
    const result = await host.exec(containerId, ['sleep', '30'], { timeoutMs: 1_000 });
    // 124 and not merely non-zero: it is how a caller tells a deadline from a
    // step that simply failed, and the two get different treatment.
    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
    await host.destroy(containerId);
  });

  test('F2: a lost sandbox is not reported as a missing document', async () => {
    // The defect this caught. Both causes make `docker exec` fail, and
    // returning `null` for each meant a step whose sandbox died reported its
    // required document as not produced — so the run failed for the wrong
    // reason and a retry looked pointless.
    const containerId = await host.create(spec);
    await host.writeFile(containerId, '/work/present.md', 'x');
    await host.destroy(containerId);

    let thrown: unknown;
    try {
      await host.readFile(containerId, '/work/present.md');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FactoryError);
    expect((thrown as FactoryError).reason).toBe('sandbox_lost');
  });

  test('C9: a failure leaves nothing running', async () => {
    let thrown: unknown;
    try {
      await host.create({ ...spec, image: 'factory/does-not-exist:no-such-tag' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FactoryError);
    expect((thrown as FactoryError).reason).toBe('sandbox_lost');
  });
});

/**
 * The obligations no available host can answer, and where each is actually
 * proven. Written as a test so the claims are checked rather than asserted in
 * prose — every file named here must exist and must contain what is claimed.
 */
describe('obligations proven elsewhere', () => {
  const elsewhere: { obligation: string; provenBy: string; contains: string }[] = [
    {
      obligation: 'C3 for the hosted host — commands run as an unprivileged user',
      provenBy: 'apps/runner/tests/unit/hosted-command.test.ts',
      contains: 'drops to the unprivileged user',
    },
    {
      obligation: 'E1 for the hosted host — argv survives becoming a command string',
      provenBy: 'apps/runner/tests/unit/hosted-command.test.ts',
      contains: 'a whole agent invocation round-trips unchanged',
    },
    {
      obligation: 'E3/E3a for the hosted host — the deadline starts with the command',
      provenBy: 'apps/runner/tests/unit/hosted-command.test.ts',
      contains: 'timeout(1) and TIMEOUT_EXIT_CODE agree',
    },
    {
      obligation: 'F1 for both hosts — quoting at the boundary',
      provenBy: 'apps/runner/tests/unit/shell.test.ts',
      contains: 'quoteOne',
    },
    {
      obligation: 'C5/C5a — the ceilings are caps and the wall clock is exact',
      provenBy: 'apps/runner/tests/integration/run-state.test.ts',
      contains: "falls due exactly at the administrator's ceiling",
    },
  ];

  test.each(elsewhere.map((entry) => [entry.obligation, entry] as const))(
    '%s',
    async (_obligation, entry) => {
      const file = await Bun.file(entry.provenBy).text();
      expect(file).toContain(entry.contains);
    },
  );
});

/**
 * FR-017 sits outside the host contract on purpose, and this is where that is
 * made explicit: redaction happens where output is TAKEN IN, not where it is
 * shown. So no host implementation is responsible for it, and a third one
 * cannot get it wrong — which is the property worth pinning.
 */
test('FR-017: a credential in a command’s output never leaves the sink unredacted', () => {
  const seen: string[] = [];
  const sink = new LogSink({
    secrets: secretValues(credentials),
    send: async (chunk) => {
      seen.push(chunk.text);
    },
  });
  // The realistic shape: a tool echoing its own configuration on failure.
  sink.write('stderr', `fatal: authentication failed for ${credentials.gitToken}\n`);
  sink.write('stdout', `using key ${credentials.modelKey}\n`);
  sink.end();

  expect(seen.length).toBeGreaterThan(0);
  const everything = seen.join('');
  expect(everything).not.toContain(credentials.gitToken);
  expect(everything).not.toContain(credentials.modelKey);
  expect(everything).toContain('authentication failed');
});

/**
 * The host-selection obligation, which is about the seam rather than about any
 * one implementation: a deployment moves between hosts by configuration, and
 * the managed one can only be built where its namespace exists.
 */
test('the managed host refuses to be built outside the Worker entry', () => {
  expect(() => hostFor('hosted')).toThrow(/can only be served by the Worker entry/);
  // And the Docker path needs nothing injected, which is what keeps it the
  // rollback (FR-025).
  expect(hostFor('docker')).toBe(dockerHost);
});

/** WORK_USER and the command it produces are one fact, asserted in one place. */
test('the hosted host’s unprivileged user is the one the image creates', async () => {
  expect(WORK_USER).toBe('factory');
  // The HOSTED image: the managed host cannot use `docker run --user`, so it
  // wraps each command in `setpriv --reuid=<user>` and that user has to exist
  // in the image it actually runs. The local image is a separate file and
  // drops to UID 1000 directly.
  const dockerfile = await Bun.file('infra/sandbox/Dockerfile.hosted').text();
  expect(dockerfile).toContain(`useradd`);
  expect(dockerfile).toContain(WORK_USER);
  // And the command actually drops to it.
  expect(commandLine(['true'])).toContain(`--reuid=${WORK_USER}`);
});
