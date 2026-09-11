import { describe, expect, test } from 'bun:test';
import { FactoryError } from '@factory/shared';
import {
  chooseSize,
  OFFERED_SIZES,
  type SandboxSize,
  sandboxId,
  sizeOf,
  sizesAreOrdered,
} from '../../src/container/sizes';

/**
 * How a workspace's ceilings decide which sandbox a run gets (T035, FR-005,
 * FR-009, FR-009a, D4).
 *
 * The single most important property here is the DIRECTION. Processing power
 * and memory are upper bounds on what a run may consume, so the choice resolves
 * downwards. An earlier draft of D4 resolved upwards — the smallest size
 * meeting or exceeding the figures — and that inverts the setting completely:
 * an administrator capping memory at 4096 MiB would have been handed 8 GiB. The
 * first test in this file is the one that would have caught it.
 */

describe('the offered sizes themselves', () => {
  test('every size is larger than the one before it in both dimensions', () => {
    // What makes "the largest that fits" a single unambiguous answer. A list
    // where one size had more vCPU and another more memory would make the
    // choice arbitrary rather than visibly wrong.
    expect(sizesAreOrdered()).toBe(true);
  });

  test('every size honours the provider’s 3 GiB-per-vCPU floor', () => {
    // Measured on the spike, where a deploy at 2 vCPU / 4096 MiB was refused:
    // "memory Must have at least 3 GiB memory for each of the first 4 vCPUs."
    // A size declared here that breaks it fails at DEPLOY, which is late.
    for (const size of OFFERED_SIZES) {
      expect(size.memoryMiB, `${size.name} needs ${size.vcpu * 3072} MiB`).toBeGreaterThanOrEqual(
        size.vcpu * 3072,
      );
    }
  });

  test('no size exceeds the provider’s cap of 4 vCPU and 12 GiB', () => {
    for (const size of OFFERED_SIZES) {
      expect(size.vcpu).toBeLessThanOrEqual(4);
      expect(size.memoryMiB).toBeLessThanOrEqual(12_288);
    }
  });

  test('the declared names are the container bindings wrangler declares', async () => {
    // A size named in code with no binding in configuration presents at run
    // time, on a real ticket, as a sandbox that cannot be reached. Cheap to
    // check here; expensive to discover there.
    const config = await Bun.file('apps/runner/wrangler.jsonc').text();
    for (const size of OFFERED_SIZES) {
      expect(config, `wrangler.jsonc declares no binding named ${size.name}`).toContain(
        `"name": "${size.name}"`,
      );
    }
  });
});

describe('choosing a size within a workspace’s ceilings', () => {
  test('a ceiling is never rounded UP to the next size (FR-009)', () => {
    // The inversion this exists to prevent, stated as the numbers an
    // administrator would actually type.
    const chosen = chooseSize({ cpu: 2, memoryMb: 4096 });
    expect(chosen.vcpu).toBeLessThanOrEqual(2);
    expect(chosen.memoryMiB).toBeLessThanOrEqual(4096);
  });

  test('the largest size WITHIN the ceilings is chosen, not merely one that fits', () => {
    // Erring downwards must not mean erring all the way down: a workspace
    // permitting 4 vCPU and 12 GiB should get 4 vCPU and 12 GiB.
    expect(chooseSize({ cpu: 4, memoryMb: 12_288 })).toEqual({
      name: 'sandbox_4x12',
      vcpu: 4,
      memoryMiB: 12_288,
    });
    expect(chooseSize({ cpu: 2, memoryMb: 6144 }).name).toBe('sandbox_2x6');
  });

  test('both dimensions bind, not whichever is checked first', () => {
    // Plenty of memory, one vCPU permitted: the vCPU ceiling must still hold.
    expect(chooseSize({ cpu: 1, memoryMb: 12_288 }).vcpu).toBe(1);
    // Plenty of vCPU, little memory: the memory ceiling must still hold.
    const tightMemory = chooseSize({ cpu: 4, memoryMb: 4096 });
    expect(tightMemory.memoryMiB).toBeLessThanOrEqual(4096);
    expect(tightMemory.name).toBe('sandbox_1x4');
  });

  test('the shipped workspace default lands on 1 vCPU, which is the recorded defect', () => {
    // Not an aspiration — a statement of what the defaults currently produce.
    // 2 vCPU / 4096 MiB cannot exist on this provider, because two vCPUs
    // demand 6 GiB. So a default workspace gets half the processing power it
    // asked for. FR-009 is behaving as designed; the DEFAULT is what is wrong,
    // and raising it to 6144 MiB is a product decision recorded in D4.
    //
    // This test exists so that fixing the default is a visible change here
    // rather than a silent one in production.
    const defaults = chooseSize({ cpu: 2, memoryMb: 4096 });
    expect(defaults.name).toBe('sandbox_1x4');
    expect(defaults.vcpu).toBe(1);
  });

  test('a ceiling above every offered size is not an error', () => {
    // The workspace asked for more than the deployment offers. That is a
    // capacity question, not a misconfiguration, and the answer is the largest
    // size there is.
    const generous = chooseSize({ cpu: 64, memoryMb: 262_144 });
    expect(generous).toEqual(OFFERED_SIZES.at(-1) as SandboxSize);
  });

  test('a ceiling below the smallest offered size fails at start, naming it (FR-005)', () => {
    let thrown: unknown;
    try {
      chooseSize({ cpu: 1, memoryMb: 512 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FactoryError);
    const message = (thrown as FactoryError).message;
    // The ceiling that ruled it out AND the smallest size available, because
    // an administrator reading this needs to know what to change it to.
    expect(message).toContain('512 MiB');
    expect(message).toContain('3072 MiB');

    // And nothing is substituted. Quietly using the smallest size would hand
    // a run six times the memory the administrator permitted, which is the one
    // thing the ceiling exists to prevent.
    expect(() => chooseSize({ cpu: 0, memoryMb: 12_288 })).toThrow(FactoryError);
  });
});

describe('a sandbox identifier carries its own size', () => {
  const size = OFFERED_SIZES[2] as SandboxSize;

  test('the size round-trips through the identifier', () => {
    // Which namespace a sandbox lives in has to travel in the identifier,
    // because `exec`, `readFile`, `stat` and `destroy` are given nothing else
    // — and widening the interface is what `contracts/execution-host.md`
    // forbids.
    const id = sandboxId(size, '7f3c9a1e-0000-4000-8000-000000000000');
    expect(sizeOf(id)).toEqual(size);
  });

  test('an identifier from before sizes existed reads as no size, not as an error', () => {
    // A run in flight through a deployment upgrade is doing nothing wrong, and
    // failing it on the shape of its own identifier would be an upgrade that
    // breaks every run underway.
    expect(sizeOf('7f3c9a1e-0000-4000-8000-000000000000')).toBeUndefined();
    expect(sizeOf('')).toBeUndefined();
  });

  test('an identifier naming a size this deployment no longer offers reads as no size', () => {
    // Withdrawing a size is a legitimate deploy. What must not happen is that
    // the identifier resolves to some OTHER size's namespace and reaches the
    // wrong sandbox.
    expect(sizeOf('sandbox_99x99.7f3c9a1e')).toBeUndefined();
  });

  test('the identifier is still opaque: nothing parses it but the host', async () => {
    // C1 makes the identifier opaque to callers, and this keeps it that way.
    // Something outside the host reading a size out of it would make the
    // encoding a contract, and the encoding is deliberately not one.
    const runs = await Bun.file('apps/runner/src/runs.ts').text();
    const router = await Bun.file('apps/runner/src/router.ts').text();
    for (const source of [runs, router]) {
      expect(source).not.toContain('sizeOf');
    }
  });
});
