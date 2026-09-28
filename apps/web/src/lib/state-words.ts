/**
 * A ticket's state in words, beside the colour that also says it (FR-006):
 * the dashboard's row and the board's card, which say the same thing at two
 * lengths — the row has room for a sentence ("Таны батлалт хүлээж байна"),
 * the card for its name ("Төлөвлөгөө батлуулах").
 *
 * Browser-safe: the running time is worked out here from the step's start,
 * so it ticks without asking the server again.
 */

import { runningPhrase, stepName } from './default-names';
import { m as current, type Messages } from './i18n';
import type { TicketState } from './services/ticket-state';

export type StateTone = 'run' | 'pen' | 'wait' | 'fail' | 'queue' | 'done';

export interface StateWords {
  tone: StateTone;
  text: string;
  /** Happening right now, so its dot glows. */
  live: boolean;
}

/** "!88" on GitLab, "#88" on GitHub — the provider's own way of naming one. */
export function requestReference(url: string): string {
  const number = url.match(/(\d+)\/?$/)?.[1];
  if (!number) return '';
  return url.includes('/pull/') ? `#${number}` : `!${number}`;
}

export function stateWords(
  state: TicketState,
  form: 'row' | 'card',
  now: number = Date.now(),
  m: Messages = current,
): StateWords {
  const words = m.dashboard.status;
  switch (state.kind) {
    case 'running': {
      if (!state.step) return { tone: 'run', text: words.openingMergeRequest, live: true };
      const minutes = state.since
        ? Math.max(0, Math.floor((now - new Date(state.since).getTime()) / 60_000))
        : null;
      const elapsed = minutes === null ? null : m.dashboard.elapsed(minutes);
      const phrase =
        form === 'row'
          ? runningPhrase(state.step.name, state.step.type, m)
          : stepName(state.step.name, m);
      return {
        tone: state.step.type === 'design' ? 'pen' : 'run',
        text: words.running(phrase, elapsed),
        live: true,
      };
    }
    case 'waiting':
      return {
        tone: 'wait',
        text:
          form === 'card' && state.step
            ? m.ticketCard.approve(stepName(state.step.name, m))
            : words.waiting,
        live: true,
      };
    case 'failed':
      if (form === 'card') {
        return { tone: 'fail', text: state.failureReason ?? words.failedNoReason, live: false };
      }
      return {
        tone: 'fail',
        text: state.failureReason ? words.failed(state.failureReason) : words.failedNoReason,
        live: false,
      };
    case 'queued':
      return {
        tone: 'queue',
        text: state.queuePosition === null ? words.queuedNext : words.queuedAt(state.queuePosition),
        live: false,
      };
    case 'done': {
      const reference = state.mergeRequestUrl ? requestReference(state.mergeRequestUrl) : '';
      if (form === 'card') {
        return {
          tone: 'done',
          text: reference ? m.ticketCard.mergeRequestOpened(reference) : m.ticketCard.done,
          live: false,
        };
      }
      return {
        tone: 'done',
        text: reference ? words.mergeRequestOpened(reference) : words.done,
        live: false,
      };
    }
    case 'cancelled':
      return { tone: 'queue', text: m.ticketCard.cancelled, live: false };
    case 'draft':
      return { tone: 'queue', text: m.ticketCard.readyToStart, live: false };
  }
}
