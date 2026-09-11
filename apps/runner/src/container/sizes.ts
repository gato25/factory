import { FactoryError } from '@factory/shared';

/**
 * Which sandbox size a run gets, and why it is a choice rather than a setting
 * (002 FR-005, FR-009, D4).
 *
 * Processing power and memory are not settable per sandbox on the managed host.
 * They come from deploy-time container configuration, so a deployment declares
 * a small fixed set of sizes and a run is ROUTED to one. This file is that
 * routing, and it lives apart from `hosted.ts` so it can be tested — that file
 * imports the SDK and is unreachable from any test here.
 *
 * **The direction the choice resolves in is the whole point.** A workspace's
 * figures are upper bounds on what a run may consume (001 FR-085, 002 FR-009),
 * so the answer is the LARGEST offered size that still fits within them. An
 * earlier draft resolved upwards — the smallest size meeting or exceeding the
 * figures — which inverts the setting: an administrator capping memory at
 * 4096 MiB would have been handed 8 GiB. Erring downwards can give a workspace
 * less than it asked for, which is visible in what the run records, and is the
 * safe direction to be wrong in.
 */

export interface SandboxSize {
  /** The wrangler container binding, and the prefix on a sandbox identifier. */
  name: string;
  vcpu: number;
  memoryMiB: number;
}

/**
 * The sizes a deployment offers, smallest first.
 *
 * These MUST match the container bindings in `wrangler.jsonc` exactly — a size
 * named here with no binding declared there fails at run time, on a real
 * ticket, with an error about an undefined namespace.
 *
 * **Why these four and not the obvious ones.** The provider requires at least
 * 3 GiB of memory for each of the first four vCPUs, measured on the spike after
 * a deploy was refused outright:
 *
 *   VALIDATE_INPUT — memory Must have at least 3 GiB memory for each of the
 *   first 4 vCPUs. With 2 vCPU(s), you need at least 6 GiB of memory.
 *
 * So vCPU and memory are not independent, and the shipped workspace default of
 * **2 vCPU / 4096 MiB cannot exist here at all**: two vCPUs demand 6 GiB, which
 * exceeds that memory ceiling. A default workspace therefore routes to
 * 1 vCPU / 4096 MiB — half the processing power it asked for. FR-009 is
 * behaving exactly as designed; the DEFAULT is what is wrong, and raising it to
 * 6144 MiB so that 2 vCPU stays reachable is a product decision recorded in
 * research.md D4 rather than made here.
 *
 * Every size is strictly larger than the one before it in BOTH dimensions,
 * which is what makes "largest that fits" unambiguous. `sizesAreOrdered`
 * asserts it, because a list that broke the ordering would make the choice
 * quietly arbitrary rather than wrong in a visible way.
 */
export const OFFERED_SIZES: readonly SandboxSize[] = [
  // The smallest the provider permits: 1 vCPU at its 3 GiB floor.
  { name: 'sandbox_1x3', vcpu: 1, memoryMiB: 3072 },
  // Where a default workspace lands today, and measured working on the spike.
  { name: 'sandbox_1x4', vcpu: 1, memoryMiB: 4096 },
  // The smallest size at which 2 vCPU is legal at all.
  { name: 'sandbox_2x6', vcpu: 2, memoryMiB: 6144 },
  // The provider's cap: 4 vCPU, 12 GiB. Also measured on the spike.
  { name: 'sandbox_4x12', vcpu: 4, memoryMiB: 12288 },
] as const;

/** Kept honest by a test rather than by a comment. */
export function sizesAreOrdered(sizes: readonly SandboxSize[] = OFFERED_SIZES): boolean {
  return sizes.every((size, index) => {
    if (index === 0) return true;
    const previous = sizes[index - 1] as SandboxSize;
    return size.vcpu >= previous.vcpu && size.memoryMiB > previous.memoryMiB;
  });
}

export interface SizeCeilings {
  /** Upper bound on processing power, never a minimum. */
  cpu: number;
  /** Upper bound on memory in MiB, never a minimum. */
  memoryMb: number;
}

/**
 * The largest offered size that fits within a workspace's ceilings.
 *
 * Throws rather than substituting something when nothing fits, and names the
 * ceiling that ruled everything out (FR-005). The alternative — quietly using
 * the smallest size — would hand a run more memory than an administrator
 * permitted, which is the one thing the ceiling exists to prevent.
 *
 * A ceiling far ABOVE every offered size is not an error: the largest size is
 * the answer, and the workspace simply asked for more than the deployment
 * offers. That is a capacity question, not a misconfiguration.
 */
export function chooseSize(
  ceilings: SizeCeilings,
  sizes: readonly SandboxSize[] = OFFERED_SIZES,
): SandboxSize {
  // Largest-first, so the first that fits is the answer.
  const fitting = [...sizes]
    .sort((a, b) => b.vcpu - a.vcpu || b.memoryMiB - a.memoryMiB)
    .find((size) => size.vcpu <= ceilings.cpu && size.memoryMiB <= ceilings.memoryMb);

  if (!fitting) {
    const smallest = [...sizes].sort(
      (a, b) => a.vcpu - b.vcpu || a.memoryMiB - b.memoryMiB,
    )[0] as SandboxSize;
    throw new FactoryError(
      'sandbox_lost',
      `this workspace's sandbox ceilings (${ceilings.cpu} vCPU, ${ceilings.memoryMb} MiB) are ` +
        `below the smallest sandbox this deployment offers (${smallest.vcpu} vCPU, ` +
        `${smallest.memoryMiB} MiB), so no sandbox can be created within them`,
    );
  }
  return fitting;
}

/** Separator between a size and a sandbox's own identifier. */
const SEPARATOR = '.';

/**
 * A sandbox identifier that carries its own size.
 *
 * The size decides which Durable Object namespace the sandbox lives in, and
 * `exec`, `readFile`, `stat` and `destroy` receive nothing but the identifier —
 * so the identifier has to say. The alternative was widening `ContainerHost`
 * with a size parameter on every method, which `contracts/execution-host.md`
 * forbids: the interface's shape is what lets the existing suite keep passing
 * and lets a deployment switch hosts. C1 already makes the identifier opaque to
 * callers, so there is nothing here for anyone else to depend on.
 */
export function sandboxId(size: SandboxSize, unique: string): string {
  return `${size.name}${SEPARATOR}${unique}`;
}

/**
 * The size an identifier was minted for, or nothing if it carries no size.
 *
 * Returns `undefined` rather than throwing for an identifier from before sizes
 * existed, so a run in flight through a deployment upgrade still reaches its
 * sandbox instead of failing on a record that is doing nothing wrong.
 */
export function sizeOf(
  containerId: string,
  sizes: readonly SandboxSize[] = OFFERED_SIZES,
): SandboxSize | undefined {
  const separator = containerId.indexOf(SEPARATOR);
  if (separator <= 0) return undefined;
  const name = containerId.slice(0, separator);
  return sizes.find((size) => size.name === name);
}
