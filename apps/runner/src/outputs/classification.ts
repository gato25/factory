/**
 * The specification step ends its document with a machine-readable decision
 * block, and this parses it (contracts/step-engines.md, FR-099).
 *
 * An unparseable block returns nothing rather than a guess. The app then
 * treats the ticket as not changing the interface, continues the run, and
 * records the missing decision as a warning on the run (FR-102) — the point
 * being that "we could not tell" is a visible state, not a silent `false`.
 */

export interface Classification {
  has_ui: boolean;
  rationale: string;
}

/** The fence the prompt asks for, at the end of the document. */
const BLOCK = /```factory\s*\n([\s\S]*?)```/g;

export function parseClassification(document: string | null | undefined): Classification | null {
  if (!document) return null;

  // The last block wins: a document may quote the format while explaining it,
  // and the prompt puts the real one at the end.
  let body: string | null = null;
  for (const match of document.matchAll(BLOCK)) body = match[1] ?? null;
  if (!body) return null;

  const hasUi = field(body, 'has_ui');
  const rationale = field(body, 'rationale');
  if (hasUi === null) return null;

  const decided = readBoolean(hasUi);
  if (decided === null) return null;

  // A decision with no reason is not a usable decision: FR-099 requires the
  // reason, and FR-100 shows it wherever the decision changes what runs.
  if (!rationale) return null;

  return { has_ui: decided, rationale: oneSentence(rationale) };
}

function field(body: string, name: string): string | null {
  const match = body.match(new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, 'im'));
  return match?.[1]?.trim() ?? null;
}

function readBoolean(value: string): boolean | null {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[`"'.,]/g, '');
  if (['true', 'yes'].includes(cleaned)) return true;
  if (['false', 'no'].includes(cleaned)) return false;
  return null;
}

/**
 * One sentence, as FR-099 requires. A model that wrote three is trimmed
 * rather than rejected: the decision is the part that changes what runs.
 */
function oneSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const end = cleaned.search(/[.!?](\s|$)/);
  const sentence = end === -1 ? cleaned : cleaned.slice(0, end + 1);
  return sentence.length > 300 ? `${sentence.slice(0, 299)}…` : sentence;
}
