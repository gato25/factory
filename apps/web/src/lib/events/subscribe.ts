import { browser } from '$app/environment';
import type { RunEvent } from '$lib/services/notify';

/**
 * Subscribes to a run's stream and refreshes the queries a change affects
 * (FR-074). A `query` cannot push, so the push arrives here and the refresh
 * is what the interface reacts to.
 *
 * Staleness budget: five seconds (SC-004). Reconnection is therefore fast and
 * capped well inside it.
 */

export interface SubscribeOptions {
  /** A run id, or the literal 'dashboard'. */
  target: string;
  /** Called for every event, so a caller can refresh what it holds. */
  onEvent: (event: RunEvent) => void;
  onStateChange?: (state: 'connecting' | 'live' | 'retrying') => void;
}

const RETRY_MS = [500, 1_000, 2_000, 4_000] as const;

export function subscribeToRun(options: SubscribeOptions): () => void {
  if (!browser) return () => {};

  let source: EventSource | null = null;
  let attempt = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (stopped) return;
    options.onStateChange?.(attempt === 0 ? 'connecting' : 'retrying');
    source = new EventSource(`/api/events/${encodeURIComponent(options.target)}`);

    source.addEventListener('ready', () => {
      attempt = 0;
      options.onStateChange?.('live');
    });

    source.onmessage = (message) => {
      try {
        options.onEvent(JSON.parse(message.data) as RunEvent);
      } catch {
        // A malformed payload must not tear the stream down.
      }
    };

    source.onerror = () => {
      source?.close();
      source = null;
      if (stopped) return;
      const delay = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] as number;
      attempt += 1;
      options.onStateChange?.('retrying');
      timer = setTimeout(open, delay);
    };
  };

  open();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    source?.close();
  };
}
