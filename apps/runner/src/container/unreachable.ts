/**
 * Whether a step failed because something was unreachable, and if so, what
 * (002 FR-013, T048).
 *
 * The failure this makes legible: a step runs `npm install`, the registry is
 * down or the hostname is mistyped, and the step's output is a hundred lines of
 * tooling noise with the actual cause buried in one of them. An operator then
 * cannot tell an unreachable dependency from a failure of the work itself, and
 * those get different responses — one is retried, the other is a bug in the
 * ticket.
 *
 * **What this is, honestly.** Text matching against the shapes real tools
 * produce. It adds a line to a failure's output; it never changes an outcome,
 * never turns a failure into a success or the reverse, and a shape it does not
 * recognise simply goes unannotated. That is the right trade for a heuristic:
 * being wrong costs a misleading sentence, not a wrong result.
 *
 * It is host-independent on purpose — nothing here knows about any provider.
 * The Docker host applies it to a failed command's stderr, so a step that
 * could not reach something says so in its own output.
 */

/**
 * The shapes that mean "could not reach", each capturing the address.
 *
 * Ordered most specific first, so a message carrying both a URL and a bare
 * hostname reports the URL's host rather than whichever appeared first.
 */
const PATTERNS: readonly RegExp[] = [
  // git: fatal: unable to access 'https://gitlab.com/x/y.git': Could not resolve host: gitlab.com
  /unable to access '[a-z]+:\/\/([^/'\s]+)[^']*':/i,
  // curl: (6) Could not resolve host: registry.npmjs.org
  /could not resolve host:\s*([^\s,]+)/i,
  // node/undici: getaddrinfo ENOTFOUND registry.npmjs.org — also EAI_AGAIN
  /getaddrinfo (?:ENOTFOUND|EAI_AGAIN)\s+([^\s,]+)/i,
  // curl: (7) Failed to connect to example.com port 443
  /failed to connect to\s+([^\s:]+)/i,
  // node: connect ECONNREFUSED 10.0.0.1:443 / ETIMEDOUT 10.0.0.1:443
  /connect (?:ECONNREFUSED|ETIMEDOUT)\s+([^\s,]+)/i,
  // npm: request to https://registry.npmjs.org/pkg failed, reason: ...
  /request to\s+[a-z]+:\/\/([^/\s]+)\S*\s+failed/i,
  // apt/pip: Temporary failure resolving 'deb.debian.org'
  /failure resolving '([^']+)'/i,
  // openssl/tls: SSL connection to registry.example.com failed
  /connection to\s+([^\s:]+)\s+failed/i,
];

/**
 * The address a failed command could not reach, or nothing.
 *
 * Returns `undefined` for output with no recognisable reachability failure,
 * which includes the overwhelmingly common case of a step that failed for its
 * own reasons.
 */
export function unreachableAddress(output: string): string | undefined {
  for (const pattern of PATTERNS) {
    const match = pattern.exec(output);
    const address = match?.[1]?.trim();
    // A capture of something that cannot be an address is worse than no
    // capture: it would name the wrong thing confidently.
    if (address && /[a-z0-9]/i.test(address) && !address.includes(' ')) {
      return address.replace(/[.,;:'"]+$/, '');
    }
  }
  return undefined;
}

/**
 * A failed command's error output, with one line naming what it could not
 * reach when that is what happened.
 *
 * Appended rather than substituted: the tooling's own message is what a
 * developer will want, and replacing it would trade one kind of unhelpfulness
 * for another. Returns the input unchanged when nothing was recognised, so the
 * ordinary failure path is untouched.
 */
export function annotateUnreachable(stderr: string, stdout = ''): string {
  // Tools split themselves between the two streams — git writes the useful
  // part to stderr, npm often to stdout — so both are searched and the note
  // goes where errors are read.
  const address = unreachableAddress(stderr) ?? unreachableAddress(stdout);
  if (!address) return stderr;
  const note = `this step could not reach ${address}`;
  if (stderr.includes(note)) return stderr;
  return stderr.length > 0 ? `${stderr.replace(/\s*$/, '')}\n${note}` : note;
}
