import * as v from 'valibot';
import { m } from '$lib/i18n';

/**
 * Everything a browser sends in a form is a string. A schema that declares
 * `v.number()` or `v.boolean()` therefore rejects its own form's input — and a
 * rejected form simply does not run, so the button silently does nothing.
 * These accept what a form actually sends, while still accepting the real
 * value when the same schema is called programmatically.
 */

/** A hidden input, a select or a query argument carrying a whole number. */
export function formInteger(message = m.form.wholeNumber) {
  return v.pipe(
    v.union([v.number(), v.pipe(v.string(), v.regex(/^-?\d+$/, message))], message),
    v.transform(Number),
    v.integer(message),
  );
}

/** The same, refusing anything below zero — an index or a version. */
export function formIndex(message = m.form.wholeNumberOrMore) {
  return v.pipe(formInteger(message), v.minValue(0, message));
}

/**
 * A checkbox sends its `value` when ticked and nothing at all when not, so
 * absence means false rather than missing.
 */
export function formBoolean() {
  return v.pipe(
    v.optional(v.union([v.boolean(), v.string()]), false),
    v.transform((value) =>
      typeof value === 'boolean'
        ? value
        : ['true', 'on', '1', 'yes'].includes(value.trim().toLowerCase()),
    ),
  );
}
