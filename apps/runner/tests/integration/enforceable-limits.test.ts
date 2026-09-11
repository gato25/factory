import { describe, expect, test } from 'bun:test';
import {
  type ExecutionHost,
  enforcementOf,
  HOST_LABEL,
  type SandboxLimitName,
  takesEffect,
  unavailableLimits,
} from '@factory/shared';
import { chooseSize } from '../../src/container/sizes';

/**
 * That the sandbox settings say which limits the configured execution host
 * actually enforces (T037, FR-011a, FR-012).
 *
 * The failure being prevented is specific and quiet. A workspace has a switch
 * reading "let a sandbox reach the network while code is being written". On the
 * managed host that switch cannot be honoured at all — T006 measured that the
 * provider's allow and deny lists govern only traffic routed through its own
 * proxy, not sockets a process opens for itself, and an agent step runs
 * arbitrary code. A switch that saves, displays as "off", and does nothing is
 * worse than no switch: an administrator turns it off, believes the sandbox is
 * sealed, and is wrong in the direction that matters.
 *
 * So the claims made here must match what the code does. That is what the last
 * group asserts: the enforcement table is not a separate opinion about the
 * hosts, it agrees with them.
 */

const HOSTS: ExecutionHost[] = ['docker', 'hosted'];
const LIMITS: SandboxLimitName[] = [
  'image',
  'cpu',
  'memoryMb',
  'wallClockMinutes',
  'networkDuringImplement',
  'retainFailedSandboxesHours',
];

describe('every limit has an answer on every host', () => {
  test.each(HOSTS)('%s', (host) => {
    // A limit with no entry would render as enforced by default, which is the
    // wrong way to be wrong: silence should never read as a promise.
    for (const name of LIMITS) {
      const answer = enforcementOf(host, name);
      expect(['exact', 'rounded_down', 'unavailable']).toContain(answer.enforcement);
      // Anything not applied exactly must explain itself, because a bare
      // "rounded" or "unavailable" leaves an administrator with no idea what
      // to do instead.
      if (answer.enforcement !== 'exact') {
        expect(answer.note.length, `${host}/${name} needs a note`).toBeGreaterThan(20);
      } else {
        expect(answer.note).toBe('');
      }
    }
  });
});

describe('the locally administered host is the baseline', () => {
  test('it enforces every limit exactly', () => {
    // What this product shipped with. A daemon the team administers takes
    // every figure literally, `--network none` included — so any divergence
    // here would be a regression in the path that is also the rollback.
    for (const name of LIMITS) {
      expect(enforcementOf('docker', name).enforcement, name).toBe('exact');
    }
    expect(unavailableLimits('docker')).toEqual([]);
  });
});

describe('the managed host says what it cannot do', () => {
  test('the network restriction reports itself unavailable, not accepted (FR-011a)', () => {
    const answer = enforcementOf('hosted', 'networkDuringImplement');
    expect(answer.enforcement).toBe('unavailable');
    expect(takesEffect('hosted', 'networkDuringImplement')).toBe(false);
    // And the reason is the host's inability, stated plainly — not a vague
    // "may not apply".
    expect(answer.note).toContain('cannot filter');
    expect(answer.note).toContain('for the whole of its life');
  });

  test('the image field reports itself unavailable, because the image is built at deploy', () => {
    // Easy to miss, and it would present as a run silently using a different
    // image from the one the settings screen shows.
    expect(enforcementOf('hosted', 'image').enforcement).toBe('unavailable');
    expect(enforcementOf('hosted', 'image').note).toContain('deploy time');
  });

  test('processing power and memory are met from below, and say so (FR-009)', () => {
    // Not "unavailable": the ceiling genuinely holds. It is met by choosing a
    // size within it, which can give a workspace less than it asked for — and
    // that is the thing to disclose.
    for (const name of ['cpu', 'memoryMb'] as const) {
      expect(enforcementOf('hosted', name).enforcement).toBe('rounded_down');
      expect(takesEffect('hosted', name)).toBe(true);
    }
    expect(enforcementOf('hosted', 'cpu').note).toContain('3 GiB');
  });

  test('the wall clock is exact on both hosts (FR-009a)', () => {
    // The one ceiling that must never be rounded, on either host: it is
    // enforced by an alarm at an absolute time, not by an allocation.
    for (const host of HOSTS) {
      expect(enforcementOf(host, 'wallClockMinutes').enforcement).toBe('exact');
    }
  });

  test('each host has a phrase for naming itself as the reason', () => {
    for (const host of HOSTS) {
      expect(HOST_LABEL[host].length).toBeGreaterThan(10);
      // Reads inside a sentence such as "Unavailable on …", so it must not be
      // a bare identifier.
      expect(HOST_LABEL[host]).not.toBe(host);
    }
  });
});

describe('the table agrees with what the code actually does', () => {
  test('"rounded_down" for memory is true: a ceiling is met from below', () => {
    // The claim, checked against the routing rather than trusted. If
    // `chooseSize` ever resolved upwards, this table would be describing
    // behaviour the code no longer has.
    const chosen = chooseSize({ cpu: 4, memoryMb: 4096 });
    expect(chosen.memoryMiB).toBeLessThanOrEqual(4096);
    expect(enforcementOf('hosted', 'memoryMb').enforcement).toBe('rounded_down');
  });

  test('"unavailable" for the network restriction is true: nothing reads it', async () => {
    // The managed host takes `spec.network` and deliberately does nothing with
    // it. That absence is the implementation of FR-011a, and it is asserted
    // here so that someone later adding an allowlist has to change this test
    // and read why.
    const hosted = await Bun.file('apps/runner/src/container/hosted.ts').text();
    for (const api of ['setAllowedHosts', 'allowedHosts', 'deniedHosts', 'setOutboundByHost']) {
      expect(hosted, `hosted.ts must not use ${api} — see FR-011a and T006`).not.toContain(api);
    }
  });

  test('the settings screen disables what it reports as unavailable', async () => {
    // The table is only useful if the form obeys it. Asserted against the
    // screen because a correct table beside an editable control is exactly
    // the lie FR-011a is about.
    const page = await Bun.file('apps/web/src/routes/(app)/settings/+page.svelte').text();
    expect(page).toContain("disabled={!limit('networkDuringImplement').enforced}");
    // And the stored value survives a save, because a disabled control is not
    // submitted — without this, every save would quietly turn it off.
    expect(page).toContain('type="hidden" name="sandboxNetworkDuringImplement"');
  });
});
