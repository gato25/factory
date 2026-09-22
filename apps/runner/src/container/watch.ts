import type { Logger } from '@factory/shared';
import { log as runnerLog } from '../errors';

/**
 * Whether the container host is answering, asked again and again rather than
 * once.
 *
 * The daemon was probed at startup and then assumed. A daemon that stopped an
 * hour later was discovered by the next step, as `the sandbox is gone` — a
 * sentence about the run, for a fault in the machine — and by nothing else:
 * no line in the log said when Docker went away or when it came back, so an
 * operator reading a failed run had to find that out for themselves.
 *
 * This asks on a timer and says so ONCE at each change: when the host stops
 * answering, with what that means for this deployment, and when it answers
 * again, with how long it was gone. Between changes it is silent. The current
 * answer is kept for anything that needs it — the loop, deciding whether a
 * lost sandbox is the host's fault; the reaper, deciding whether there is a
 * daemon to ask.
 */

export interface HostProbe {
  reachable: boolean;
  detail: string;
}

export interface HostStatus extends HostProbe {
  /** When this answer was obtained. */
  checkedAt: string;
  /** When the host entered this state: the first probe that answered this way. */
  since: string;
}

export interface HostWatchOptions {
  probe: () => Promise<HostProbe>;
  /** How often to ask, once started. */
  intervalMs: number;
  /** What a host that is not answering means for this deployment, said in the log line. */
  consequence: string;
  /** Injected by tests. */
  log?: Pick<Logger, 'info' | 'error'>;
  now?: () => number;
}

export interface HostWatch {
  /** The last answer, or nothing before the first probe. */
  current(): HostStatus | undefined;
  /** Asks now, records the answer, and logs a change. Concurrent calls share one probe. */
  check(): Promise<HostStatus>;
  start(): void;
  stop(): void;
}

export function watchContainerHost(options: HostWatchOptions): HostWatch {
  const log = options.log ?? runnerLog;
  const now = options.now ?? Date.now;
  let status: HostStatus | undefined;
  let inFlight: Promise<HostStatus> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const check = (): Promise<HostStatus> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const at = new Date(now()).toISOString();
      const probe = await options.probe().catch(
        (error): HostProbe => ({
          reachable: false,
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
      const previous = status;
      const changed = previous === undefined || previous.reachable !== probe.reachable;
      const next: HostStatus = {
        ...probe,
        checkedAt: at,
        since: changed || previous === undefined ? at : previous.since,
      };
      if (changed) {
        if (!probe.reachable) {
          log.error('the container host is not answering', {
            detail: probe.detail,
            consequence: options.consequence,
            ...(previous ? { answered_since: previous.since } : {}),
          });
        } else if (previous) {
          log.info('the container host is answering again', {
            detail: probe.detail,
            unreachable_for_ms: Math.max(0, now() - Date.parse(previous.since)),
          });
        }
      }
      status = next;
      return next;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    current: () => status,
    check,
    start() {
      if (timer) return;
      timer = setInterval(() => void check(), options.intervalMs);
      // A watch must not be what keeps the process alive.
      (timer as unknown as { unref?: () => void }).unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
