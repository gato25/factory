/**
 * Which sandbox limits an execution host can actually enforce
 * (002 FR-011a, FR-012).
 *
 * This exists because of one specific way software lies to the people who
 * configure it. A workspace has a switch reading "let a sandbox reach the
 * network while code is being written", and on the managed host that switch
 * cannot be honoured at all — the provider's allow and deny lists govern only
 * traffic routed through its own proxy, not sockets a process opens for itself,
 * and an agent step runs arbitrary code, which opens its own. T006 measured it.
 *
 * A switch that is accepted, saved, displayed as "off", and does nothing is
 * worse than no switch: an administrator turns it off, believes the sandbox is
 * sealed, and is wrong in exactly the direction that matters. So FR-011a
 * requires it to be shown as UNAVAILABLE, naming the host as the reason, rather
 * than quietly ignored.
 *
 * Lives in `shared` because two components need the same answer and must not
 * disagree about it: the execution service, which decides what to do, and the
 * settings screen, which decides what to show.
 */

/** Every host a deployment can be configured for (002 FR-025). */
export type ExecutionHost = 'docker' | 'hosted';

/** A sandbox limit an administrator can set. */
export type SandboxLimitName =
  | 'image'
  | 'cpu'
  | 'memoryMb'
  | 'wallClockMinutes'
  | 'networkDuringImplement'
  | 'retainFailedSandboxesHours';

export type Enforcement =
  /** The host applies this figure as given. */
  | 'exact'
  /**
   * The host applies it, but to its own granularity — so the effective figure
   * may be lower than the one set, never higher.
   */
  | 'rounded_down'
  /** The host cannot apply this at all, and saying otherwise would mislead. */
  | 'unavailable';

export interface LimitEnforcement {
  enforcement: Enforcement;
  /**
   * What an administrator needs to read before relying on the setting. Empty
   * for a limit the host applies exactly, because there is nothing to warn
   * about and a note on every field would train people to ignore all of them.
   */
  note: string;
}

const EXACT: LimitEnforcement = { enforcement: 'exact', note: '' };

/**
 * What each host does with each limit.
 *
 * The Docker column is what this product shipped with and is the baseline: a
 * daemon the team administers takes every figure literally, including
 * `--network none`. The hosted column is the honest account of a managed
 * service, and every entry that is not `exact` is a measured finding rather
 * than a caution.
 */
const ENFORCEMENT: Record<ExecutionHost, Record<SandboxLimitName, LimitEnforcement>> = {
  docker: {
    image: EXACT,
    cpu: EXACT,
    memoryMb: EXACT,
    wallClockMinutes: EXACT,
    networkDuringImplement: EXACT,
    retainFailedSandboxesHours: EXACT,
  },
  hosted: {
    image: {
      enforcement: 'unavailable',
      note:
        'the managed host builds its sandbox image at deploy time, so this field has no effect ' +
        'there — the image comes from infra/sandbox/Dockerfile',
    },
    cpu: {
      enforcement: 'rounded_down',
      note:
        'the managed host offers a fixed set of sandbox sizes, so a run gets the largest size ' +
        'within this ceiling rather than this figure exactly. It also requires at least 3 GiB of ' +
        'memory per processor, so a low memory ceiling limits processors too',
    },
    memoryMb: {
      enforcement: 'rounded_down',
      note:
        'a run gets the largest offered sandbox size within this ceiling. A ceiling below the ' +
        'smallest size offered fails the run at start rather than exceeding it',
    },
    wallClockMinutes: EXACT,
    networkDuringImplement: {
      enforcement: 'unavailable',
      note:
        'the managed host cannot filter a sandbox’s outbound traffic by host, so this cannot be ' +
        'enforced there: a sandbox has network reach for the whole of its life. Showing it as ' +
        'available would mean an administrator turning it off and believing something that is ' +
        'not true',
    },
    retainFailedSandboxesHours: EXACT,
  },
};

/** What the configured host does with one limit. */
export function enforcementOf(host: ExecutionHost, limit: SandboxLimitName): LimitEnforcement {
  return ENFORCEMENT[host][limit];
}

/** Every limit the configured host cannot enforce at all. */
export function unavailableLimits(host: ExecutionHost): SandboxLimitName[] {
  const limits = ENFORCEMENT[host];
  return (Object.keys(limits) as SandboxLimitName[]).filter(
    (limit) => limits[limit].enforcement === 'unavailable',
  );
}

/**
 * Whether a value set for this limit will take effect.
 *
 * The question a form should ask before it accepts a figure. `rounded_down`
 * counts as taking effect: the ceiling holds, it is simply met from below.
 */
export function takesEffect(host: ExecutionHost, limit: SandboxLimitName): boolean {
  return ENFORCEMENT[host][limit].enforcement !== 'unavailable';
}

/** How a host describes itself in a sentence about its own limitations. */
export const HOST_LABEL: Record<ExecutionHost, string> = {
  docker: 'the container host you administer',
  hosted: 'the managed sandbox service',
};
