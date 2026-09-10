/**
 * Shared shape for the cross-cutting audits (quickstart.md, "Cross-cutting
 * checks"). Each audit is a success criterion no single story proves, so each
 * runs against a real database rather than a fixture, prints what it found,
 * and exits non-zero when the criterion is not met — that exit code is the
 * point: these are meant to be run by a scheduler, not read by a person.
 */

export interface Finding {
  /** Where the problem is, precisely enough to go and look. */
  where: string;
  detail: string;
}

export interface Audit {
  criterion: string;
  /** What was examined, so an empty result differs from no data. */
  examined: string;
  findings: Finding[];
  /** Set when the audit could not reach a verdict at all. */
  inconclusive?: string;
  /** Anything true and worth saying that is not a failure. */
  notes?: string[];
}

const BOLD = '\u001b[1m';
const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const OFF = '\u001b[0m';

/** Prints the audit and returns the process exit code. */
export function report(audit: Audit): number {
  console.log(`${BOLD}${audit.criterion}${OFF}`);
  console.log(`  examined: ${audit.examined}`);
  for (const note of audit.notes ?? []) console.log(`  note: ${note}`);

  if (audit.inconclusive) {
    // Not a pass. An audit with nothing to examine has proved nothing, and
    // printing it green would be the most misleading thing it could do.
    console.log(`  ${YELLOW}INCONCLUSIVE${OFF} — ${audit.inconclusive}`);
    return 2;
  }

  if (audit.findings.length === 0) {
    console.log(`  ${GREEN}PASS${OFF}`);
    return 0;
  }

  console.log(`  ${RED}FAIL${OFF} — ${audit.findings.length} finding(s):`);
  for (const finding of audit.findings) {
    console.log(`    ${finding.where}`);
    console.log(`      ${finding.detail}`);
  }
  return 1;
}

/**
 * `--since 7d`, `--since 24h`, `--since 90m`. A period, because every one of
 * these criteria is about a period of operation rather than a moment.
 *
 * `iso` is what gets bound into a query: this Bun and postgres.js pairing
 * cannot serialise a `Date` parameter — it tries to take its byte length and
 * throws — so a comparison against a timestamp column has to go in as text.
 */
export function since(argv: string[], fallback = '7d'): { from: Date; iso: string; label: string } {
  const index = argv.indexOf('--since');
  const raw = (index === -1 ? fallback : argv[index + 1]) ?? fallback;
  const match = raw.match(/^(\d+)([mhd])$/);
  if (!match) {
    throw new Error(`--since expects a period like 7d, 24h or 90m, not ${JSON.stringify(raw)}`);
  }
  const size = Number(match[1]);
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 'm' | 'h' | 'd'];
  const from = new Date(Date.now() - size * unit);
  return { from, iso: from.toISOString(), label: raw };
}
