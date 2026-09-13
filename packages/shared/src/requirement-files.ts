/**
 * Requirement documents attached to a ticket.
 *
 * A ticket's title, description and acceptance criteria are what somebody can
 * be bothered to retype. The requirements themselves usually already exist — a
 * written brief, a list of rules, an export of the rows a report has to
 * produce — and retyping them into a textarea is both work and a chance to get
 * them wrong. So they are attached, stored whole, and put in front of every
 * agent step as files.
 *
 * TEXT ONLY, deliberately. A PDF or a .docx would need either a converter in
 * the sandbox image or extraction here, and neither is free; text, Markdown
 * and CSV are read by an agent exactly as they are stored. Anything else is
 * refused at upload with a message naming what is accepted, rather than
 * accepted and then found to be unreadable three steps into a run.
 *
 * Lives in `shared` because three components must agree about the same rules
 * and cannot be allowed to drift: the upload form, the service that stores
 * them, and the execution service that writes them into a sandbox.
 */

/**
 * The most one file may be.
 *
 * Generous for prose — a 200-page specification is well under this — and
 * chosen against what the content has to survive rather than against what a
 * browser can send: every file is read into memory here and again in the
 * execution service, and written into a sandbox as a single string.
 */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * The most one ticket may carry across every file.
 *
 * Separate from the per-file limit because the cost that matters is the total
 * an agent is asked to read. Ten files inside the per-file limit would be
 * 20 MB of context, which no step can use and every step would pay for.
 */
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

/** How many files one ticket may carry, whatever their size. */
export const MAX_FILES = 20;

/**
 * What may be attached, as extension to media type.
 *
 * Matched on the EXTENSION rather than the browser's `type`, because the type
 * a browser reports for the same .md file varies by operating system and is
 * frequently empty. The extension is what the person typed, and it is also
 * what the agent will see in the sandbox.
 */
export const ACCEPTED_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
};

/** For the form's `accept` attribute, and for saying what is allowed. */
export const ACCEPTED_EXTENSIONS = Object.keys(ACCEPTED_TYPES);

export interface RequirementFileProblem {
  /** Which rule this broke, for a test to assert on rather than the wording. */
  reason: 'type' | 'name' | 'empty' | 'too_large' | 'binary' | 'too_many' | 'total_too_large';
  message: string;
}

/** The extension, lowercased, or an empty string. */
export function extensionOf(name: string): string {
  const at = name.lastIndexOf('.');
  return at === -1 ? '' : name.slice(at).toLowerCase();
}

/**
 * A name safe to write into a sandbox, derived from the one uploaded.
 *
 * The uploaded name reaches a filesystem path in the sandbox, so it is the
 * one piece of a requirement file that is not merely content. Everything that
 * could make it mean something to a shell or to a path is removed rather than
 * escaped: directory separators, leading dots, and anything outside a small
 * set. A name that survives nothing becomes `requirement`, so an upload can
 * never fail for having an unpronounceable name.
 */
export function safeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  const found = extensionOf(base);
  // `..` has a last dot but no extension. Treating it as one produced
  // `requirement.` — a name ending in a dot, which is exactly the kind of
  // thing this function exists to stop producing.
  const extension = /^\.[a-z0-9]+$/.test(found) ? found : '';
  const stem = tidy(extension ? base.slice(0, -extension.length) : base);
  return `${stem || 'requirement'}${extension}`;
}

/** Reduces a name to the characters a path may safely carry. */
function tidy(text: string): string {
  return (
    text
      .normalize('NFKD')
      // NFKD splits `é` into `e` and a combining accent. Replacing the accent
      // like any other stray character turned `café-brief` into
      // `cafe--brief`; dropping it keeps the transliteration readable.
      .replace(/\p{M}+/gu, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .slice(0, 80)
      // After the cut, not before: truncating can leave a trailing separator.
      .replace(/^[-.]+|[-.]+$/g, '')
  );
}

/**
 * Whether this looks like text rather than something renamed to `.txt`.
 *
 * A NUL byte is the cheap, reliable signal: no text encoding this accepts
 * produces one, and every binary format this might be handed produces several
 * in the first few hundred bytes. The point is not to be a format detector —
 * it is to catch the PDF somebody renamed, before an agent is handed a
 * screenful of mojibake and asked to build from it.
 */
export function looksLikeText(content: string): boolean {
  return !content.includes('\u0000');
}

export interface IncomingFile {
  name: string;
  /** The decoded text. Size is measured from this, not from the upload. */
  content: string;
}

/** The size a stored file occupies, which is the size of its text in UTF-8. */
export function byteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

/** A size a person reads, not a number of bytes. */
export function describeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Everything wrong with one file, or nothing.
 *
 * Returns the first problem rather than all of them: they are ordered so that
 * the first is the one worth acting on, and a person fixing a rejected upload
 * is fixing one file at a time.
 */
export function checkFile(file: IncomingFile): RequirementFileProblem | null {
  const extension = extensionOf(file.name);
  if (!ACCEPTED_TYPES[extension]) {
    return {
      reason: 'type',
      message:
        `${file.name || 'that file'} is not a kind that can be read as text. ` +
        `Attach one of: ${ACCEPTED_EXTENSIONS.join(', ')}.`,
    };
  }
  if (!file.name.trim()) {
    return { reason: 'name', message: 'That file has no usable name.' };
  }
  const size = byteLength(file.content);
  if (size === 0) {
    return { reason: 'empty', message: `${file.name} is empty, so there is nothing to read.` };
  }
  if (size > MAX_FILE_BYTES) {
    return {
      reason: 'too_large',
      message: `${file.name} is ${describeBytes(size)}, and the limit for one file is ${describeBytes(MAX_FILE_BYTES)}.`,
    };
  }
  if (!looksLikeText(file.content)) {
    return {
      reason: 'binary',
      message: `${file.name} is not readable as text, even though its name says it is.`,
    };
  }
  return null;
}

/**
 * Whether a ticket can take these files on top of what it already holds.
 *
 * Both limits are checked against the total AFTER the upload, because that is
 * the state being asked for. Checking the incoming files alone would let a
 * ticket cross either limit one acceptable upload at a time.
 */
export function checkAddition(
  existing: { name: string; bytes: number }[],
  incoming: IncomingFile[],
): RequirementFileProblem | null {
  // A re-upload of the same name REPLACES rather than adds, so it must not be
  // counted twice — otherwise correcting a typo in a large file could be
  // refused for exceeding a limit the corrected ticket would be inside.
  const replaced = new Set(incoming.map((file) => safeFileName(file.name)));
  const kept = existing.filter((file) => !replaced.has(file.name));

  const count = kept.length + incoming.length;
  if (count > MAX_FILES) {
    return {
      reason: 'too_many',
      message: `A ticket can carry ${MAX_FILES} files, and this would make ${count}.`,
    };
  }
  const total =
    kept.reduce((sum, file) => sum + file.bytes, 0) +
    incoming.reduce((sum, file) => sum + byteLength(file.content), 0);
  if (total > MAX_TOTAL_BYTES) {
    return {
      reason: 'total_too_large',
      message:
        `That would bring this ticket to ${describeBytes(total)} of requirements, ` +
        `and the limit is ${describeBytes(MAX_TOTAL_BYTES)}.`,
    };
  }
  return null;
}

/** Where requirement files are written inside a sandbox, relative to the workdir. */
export const REQUIREMENTS_DIR = '.factory/requirements';
