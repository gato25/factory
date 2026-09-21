/**
 * What a step LOOKS like — its glyph and its colour — keyed on the step's
 * `type`.
 *
 * Keyed on `type` and never on the agent, because an agent is whatever a
 * workspace made it. "Security review" and "Docs writer" are as valid as the
 * five shipped defaults, and a map keyed on agent names would be wrong for
 * them the day somebody adds one.
 *
 * That has a visible cost, and it is worth naming rather than discovering.
 * `design.pen` draws its reference panels one colour per AGENT — the spec
 * agent blue, design pink, plan purple, dev green — and four of those five
 * are the same `type`, `agent`. So the tone here is coarser than the
 * artboard: the design step keeps its pink, and every other agent takes the
 * accent. The alternative is the name map the tracker already rejected.
 *
 * Shared by the tracker and the live log so the same step does not carry two
 * different glyphs on one screen.
 */

import type { StepView } from './services/run-view';

const GLYPH: Record<string, string> = {
  agent: '\u{1F9FE}',
  design: '\u{1F3A8}',
  shell: '⚡',
  checkpoint: '✋',
  notify: '\u{1F514}',
};

/** A step with a type nobody here knows still gets a face. */
export function glyphFor(type: string): string {
  return GLYPH[type] ?? '\u{1F916}';
}

/**
 * The same five kinds as a drawn icon, for the tracker's step nodes. The
 * live log's badge keeps the emoji, because that is what its artboard draws;
 * a 22px node on a rail wants a line, not a picture.
 *
 * Names are the design's own, as `Icon.svelte` keys them, and match the
 * icons the pipeline builder already gives each kind.
 *
 * This is coarser than `design.pen` draws artboard 06, and knowingly so.
 * There the five default steps each carry their own mark — a document, a
 * palette, a map, a checklist, a code bracket. Four of those are the same
 * `type` here, `agent`, and the agent's own icon is not in the run snapshot
 * to read. So a running or upcoming agent step shows `bot`. It costs little
 * in practice: every FINISHED step shows a check instead of its own mark, so
 * at most one or two nodes on the row are ever affected.
 */
const ICON: Record<string, string> = {
  agent: 'bot',
  design: 'palette',
  shell: 'terminal',
  checkpoint: 'hand',
  notify: 'bell',
};

export function iconFor(type: string): string {
  return ICON[type] ?? 'bot';
}

/**
 * The tone the live log wears for a step.
 *
 * `run` is green, not the blue accent, because that is what the artboard
 * draws on the panel this implements: screen 06 shows the development step,
 * and its badge, its dots and its opening line are all `success`. Green for
 * a command is also what a terminal has always done, and the log is a
 * terminal.
 *
 * Only two tones, where `design.pen` has four. Its reference board colours
 * each of the five SHIPPED agents differently — spec blue, design pink,
 * plan purple, dev green — and four of those are the same step `type`,
 * `agent`. Telling them apart needs a colour on the agent record, and there
 * is none: the `agents` table has an `icon` but no colour, and the run
 * snapshot carries neither. Until it does, a name map would be the thing
 * this file exists to avoid — wrong the day a workspace adds "Security
 * review". So the design step keeps its pink and every other step is green.
 */
export function toneFor(type: string): 'design' | 'run' {
  return type === 'design' ? 'design' : 'run';
}

/** "2m 10s", "45s" — the way every artboard writes an elapsed time. */
export function duration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  return minutes > 0 ? `${minutes}m ${String(whole % 60).padStart(2, '0')}s` : `${whole}s`;
}

/**
 * "2m 10s · $0.14", the Live Output panel's meta line.
 *
 * Empty when the step has neither, which is what the artboard draws for a
 * step that has not run: the meta is not there at all, rather than there
 * saying nothing.
 */
export function spent(step: Pick<StepView, 'durationS' | 'costUsd'>): string {
  const parts: string[] = [];
  if (step.durationS) parts.push(duration(step.durationS));
  if (step.costUsd && Number(step.costUsd) > 0) parts.push(`$${Number(step.costUsd).toFixed(2)}`);
  return parts.join(' · ');
}
