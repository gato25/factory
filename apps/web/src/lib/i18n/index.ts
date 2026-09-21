/**
 * The interface's words, in one place per language.
 *
 * The screens were built from `design.pen`, and `design.pen` is in Mongolian
 * (see `scripts/design/screens.ts`, which holds the two together). The screens
 * were not: every label was an English literal in its own component, so the
 * design said one thing and the application said another and nothing failed.
 * This is the layer that makes them the same thing, and makes a missing word a
 * type error rather than a discovery.
 *
 * Three properties are the point of doing it this way rather than with a
 * library:
 *
 *   - `mn` defines the shape and `en` is typed against it, so a word added to
 *     one language and forgotten in the other does not compile.
 *   - Nothing here reads the environment or the request. The module is pure, so
 *     `bun test` and `scripts/design/screens.ts` import it as ordinary code —
 *     which is what lets the drift check compare the artboard against the
 *     catalogue instead of grepping sixty-three components.
 *   - A phrase that takes a value is a function, not a template with holes in
 *     it, so its arguments are checked too.
 *
 * The language is a property of the deployment, not of a person: one workspace,
 * one team, one language. Per-user choice would need a column, a switcher and a
 * locale carried down every render — none of which anybody has asked for. It
 * would go on top of this; it would not replace it.
 */

import { en } from './en';
import { mn } from './mn';

/** The shape every language must supply, defined by Mongolian. */
export type Messages = typeof mn;

export type Locale = 'mn' | 'en';

export const CATALOGUES: Record<Locale, Messages> = { mn, en };

export const LOCALES = Object.keys(CATALOGUES) as Locale[];

/**
 * What the interface speaks. Mongolian, because the team is Mongolian and the
 * design is drawn that way.
 */
export const DEFAULT_LOCALE: Locale = 'mn';

export const isLocale = (value: string): value is Locale => value in CATALOGUES;

/** For tests and for the drift check, which need a language by name. */
export const catalogueFor = (locale: Locale): Messages => CATALOGUES[locale];

/**
 * The words the screens use. Imported directly, because it does not vary by
 * request — see the note above on why the language belongs to the deployment.
 */
export const m: Messages = CATALOGUES[DEFAULT_LOCALE];
