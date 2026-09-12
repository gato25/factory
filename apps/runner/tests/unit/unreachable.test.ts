import { describe, expect, test } from 'bun:test';
import { annotateUnreachable, unreachableAddress } from '../../src/container/unreachable';

/**
 * Telling an unreachable dependency from a failure of the work itself
 * (FR-013, T048).
 *
 * Every case here is output a real tool actually produces, because the value of
 * this is entirely in whether it recognises what tools say rather than what the
 * pattern's author imagined they say. The final group is the more important
 * half: what it must NOT claim.
 */

describe('the address a step could not reach', () => {
  const cases: [label: string, output: string, expected: string][] = [
    [
      'git over https',
      "fatal: unable to access 'https://gitlab.com/netgroup/shop.git/': Could not resolve host: gitlab.com",
      'gitlab.com',
    ],
    ['curl DNS', 'curl: (6) Could not resolve host: registry.npmjs.org', 'registry.npmjs.org'],
    [
      'node DNS',
      'Error: getaddrinfo ENOTFOUND api.anthropic.com\n    at GetAddrInfoReqWrap.onlookup',
      'api.anthropic.com',
    ],
    ['node transient DNS', 'getaddrinfo EAI_AGAIN proxy.internal', 'proxy.internal'],
    ['curl refused', 'curl: (7) Failed to connect to localhost port 8080 after 0 ms', 'localhost'],
    ['node refused', 'Error: connect ECONNREFUSED 127.0.0.1:5432', '127.0.0.1:5432'],
    [
      'npm fetch',
      'npm ERR! request to https://registry.npmjs.org/react failed, reason: socket hang up',
      'registry.npmjs.org',
    ],
    [
      'apt',
      "Err:1 http://deb.debian.org/debian bookworm InRelease\n  Temporary failure resolving 'deb.debian.org'",
      'deb.debian.org',
    ],
  ];

  test.each(cases)('%s', (_label, output, expected) => {
    expect(unreachableAddress(output)).toBe(expected);
  });

  test('a URL’s host is preferred over a bare hostname later in the message', () => {
    // git prints both. Reporting whichever matched first would be a coin flip
    // on which part of the same message won.
    const git =
      "fatal: unable to access 'https://gitlab.com/x/y.git': Could not resolve host: gitlab.example";
    expect(unreachableAddress(git)).toBe('gitlab.com');
  });

  test('trailing punctuation is not part of the address', () => {
    expect(unreachableAddress('Could not resolve host: registry.npmjs.org.')).toBe(
      'registry.npmjs.org',
    );
  });
});

describe('what it must not claim', () => {
  const ordinary = [
    'error: expected 2 arguments, got 1',
    "Test failed: expected 'a' to equal 'b'",
    'npm ERR! code ELIFECYCLE\nnpm ERR! errno 1',
    'error TS2339: Property x does not exist on type Y',
    'fatal: not a git repository',
    'Permission denied (publickey).',
    '',
  ];

  test.each(ordinary.map((output) => [output.slice(0, 40) || '(empty)', output] as const))(
    'an ordinary failure is not reported as unreachable: %s',
    (_label, output) => {
      expect(unreachableAddress(output)).toBeUndefined();
      // And the output is handed back byte-for-byte, so the ordinary failure
      // path is genuinely untouched.
      expect(annotateUnreachable(output)).toBe(output);
    },
  );
});

describe('how the note reaches a failure', () => {
  test('it is appended, never substituted', () => {
    const stderr = 'curl: (6) Could not resolve host: registry.npmjs.org';
    const annotated = annotateUnreachable(stderr);
    // The tooling's own message is what a developer wants first.
    expect(annotated.startsWith(stderr)).toBe(true);
    expect(annotated).toContain('this step could not reach registry.npmjs.org');
  });

  test('output on stdout is found too, and the note still goes to stderr', () => {
    // npm writes much of this to stdout; git writes it to stderr. Searching
    // only one stream would miss half of real failures.
    const annotated = annotateUnreachable(
      'npm ERR! see the log',
      'npm ERR! request to https://registry.npmjs.org/react failed, reason: timeout',
    );
    expect(annotated).toContain('npm ERR! see the log');
    expect(annotated).toContain('this step could not reach registry.npmjs.org');
  });

  test('the note is not added twice', () => {
    const once = annotateUnreachable('Could not resolve host: a.example');
    expect(annotateUnreachable(once)).toBe(once);
  });

  test('an empty stderr gets the note alone rather than a leading blank line', () => {
    expect(annotateUnreachable('', 'Could not resolve host: a.example')).toBe(
      'this step could not reach a.example',
    );
  });
});
