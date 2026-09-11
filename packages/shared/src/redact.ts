/**
 * Credentials are redacted where output is INGESTED, never where it is
 * displayed (Constitution Principle V, FR-084). A later change to a viewer
 * therefore cannot un-redact history that has already been stored.
 */

export type Redactor = (text: string) => string;

export const REDACTION_PLACEHOLDER = '[redacted]';

/**
 * Secrets shorter than this are not redacted by value: a short string appears
 * in ordinary output constantly, and redacting it would destroy the log
 * without protecting anything. Short credentials must be caught by shape.
 */
const MIN_SECRET_LENGTH = 8;

/**
 * Defence in depth. Even if a credential was never handed to us — an agent
 * printed one it found, or a step echoed an environment variable we do not
 * know about — these shapes are recognisably credentials.
 */
const CREDENTIAL_SHAPES: [RegExp, string][] = [
  [/\bghp_[A-Za-z0-9]{16,}/g, REDACTION_PLACEHOLDER], // GitHub personal access token
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTION_PLACEHOLDER], // GitHub fine-grained token
  [/\bgho_[A-Za-z0-9]{16,}/g, REDACTION_PLACEHOLDER], // GitHub OAuth token
  [/\bglpat-[A-Za-z0-9_-]{16,}/g, REDACTION_PLACEHOLDER], // GitLab personal access token
  [/\bglrt-[A-Za-z0-9_-]{16,}/g, REDACTION_PLACEHOLDER], // GitLab runner token
  [/\bsk-ant-[A-Za-z0-9_-]{16,}/g, REDACTION_PLACEHOLDER], // Anthropic API key
  // Keep the header and URL shape intact so the log stays readable; remove
  // only the value.
  [/(authorization:\s*(?:bearer|basic|token)\s+)\S+/gi, `$1${REDACTION_PLACEHOLDER}`],
  [/(https?:\/\/)[^\s/:@]+:[^\s/@]+@/g, `$1${REDACTION_PLACEHOLDER}@`],
];

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a redactor for one run. `secrets` are the values actually supplied to
 * that run; anything else is caught by shape.
 */
export function createRedactor(secrets: Iterable<string> = []): Redactor {
  const byValue = [...new Set([...secrets].filter((s) => s.length >= MIN_SECRET_LENGTH))]
    // Longest first, so an overlapping secret cannot leave a fragment behind.
    .sort((a, b) => b.length - a.length)
    .map((s) => new RegExp(escapeForRegExp(s), 'g'));

  return (text: string): string => {
    let out = text;
    for (const pattern of byValue) {
      out = out.replace(pattern, REDACTION_PLACEHOLDER);
    }
    for (const [shape, replacement] of CREDENTIAL_SHAPES) {
      out = out.replace(shape, replacement);
    }
    return out;
  };
}

/** True when nothing credential-shaped survives. Used by the T225 audit. */
export function isClean(text: string, secrets: Iterable<string> = []): boolean {
  return createRedactor(secrets)(text) === text;
}
