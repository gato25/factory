import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { quote, quoteOne } from '../../src/container/shell';
import { authenticatedRemote } from '../../src/container/start';

/**
 * The arguments this escapes are written by people — a ticket's title, a
 * reviewer's feedback, the documents a step must produce — and on the
 * Cloudflare host they are handed to a shell. So the interesting cases are
 * not "does it quote a space", they are "can a person who names a ticket run
 * a command".
 *
 * Each case below is checked by actually running the quoted line through
 * `sh` and comparing what the shell passed along with what went in. An
 * assertion about the quoted string would only prove I know what I wrote;
 * this proves the shell agrees.
 */

async function throughShell(argv: string[]): Promise<string[]> {
  // `printf '%s\0'` writes each argument exactly, with no separator a value
  // could contain, so an argument holding a newline is still one argument.
  const proc = Bun.spawn(['sh', '-c', `printf '%s\\0' ${quote(argv)}`], { stdout: 'pipe' });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.split('\0').slice(0, -1);
}

describe('quoteOne', () => {
  test('leaves an ordinary argument alone, so a log reads like a command', () => {
    expect(quoteOne('claude')).toBe('claude');
    expect(quoteOne('--output-format')).toBe('--output-format');
    expect(quoteOne('docs/spec.md')).toBe('docs/spec.md');
  });

  test('an empty argument still occupies a position', () => {
    expect(quoteOne('')).toBe("''");
  });

  test('a single quote is closed, escaped and reopened', () => {
    expect(quoteOne("it's")).toBe(`'it'\\''s'`);
  });
});

describe('what the shell actually receives', () => {
  test('an argument survives spaces and newlines intact', async () => {
    const prompt = 'Work on ticket #142: Add OAuth.\n\nProduce: docs/spec.md.';
    expect(await throughShell(['claude', '-p', prompt])).toEqual(['claude', '-p', prompt]);
  });

  test('every metacharacter arrives as text, not as syntax', async () => {
    const nasty = `$HOME \`id\` $(id) | & ; < > ( ) { } [ ] * ? ! # ~ "double" 'single' \\`;
    expect(await throughShell(['echo', nasty])).toEqual(['echo', nasty]);
  });

  test('a ticket title cannot run a command', async () => {
    // The shape somebody would actually try: close the quoting, chain a
    // command, comment out the rest.
    const attack = `x'; touch /tmp/factory-pwned; echo '`;
    expect(await throughShell(['claude', '-p', attack])).toEqual(['claude', '-p', attack]);
    // And nothing ran: the marker the attack would have left is absent.
    const check = Bun.spawn(['sh', '-c', 'test -e /tmp/factory-pwned && echo yes || echo no'], {
      stdout: 'pipe',
    });
    expect((await new Response(check.stdout).text()).trim()).toBe('no');
  });

  test('a required document cannot run a command either', async () => {
    // `output_files` is typed into the pipeline builder and reaches stat().
    const path = `/work/a'; id > /tmp/factory-pwned-2; '.md`;
    expect(await throughShell(['test', '-f', path])).toEqual(['test', '-f', path]);
    const check = Bun.spawn(['sh', '-c', 'test -e /tmp/factory-pwned-2 && echo yes || echo no'], {
      stdout: 'pipe',
    });
    expect((await new Response(check.stdout).text()).trim()).toBe('no');
  });

  test('a whole argv round-trips', async () => {
    const argv = [
      'claude',
      '-p',
      'Produce: docs/spec.md, docs/plan.md.',
      '--output-format',
      'json',
      '--model',
      'claude-opus-5',
      '--allowedTools',
      'Read,Write,Edit',
    ];
    expect(await throughShell(argv)).toEqual(argv);
  });
});

describe('quote', () => {
  test('joins with single spaces', () => {
    expect(quote(['claude', '-p', 'hello world'])).toBe(`claude -p 'hello world'`);
  });
});

/**
 * The command shapes the Docker host actually builds.
 *
 * `writeFile` and `stat` used to interpolate a path straight into `sh -c`, and
 * `output_files` is typed into the pipeline builder — so a required document
 * named `a'; touch /tmp/x; '.md` was a command, not a path. These cases build
 * the same strings `container/host.ts` builds and run them through a real
 * shell in a scratch directory, which is the only way to know the shell agrees.
 */
describe('the shapes container/host.ts builds', () => {
  const dir = `/tmp/factory-shell-${process.pid}`;

  beforeEach(async () => {
    await Bun.spawn(['mkdir', '-p', dir]).exited;
  });
  afterEach(async () => {
    await Bun.spawn(['rm', '-rf', dir]).exited;
  });

  async function sh(script: string): Promise<{ code: number; out: string }> {
    const proc = Bun.spawn(['sh', '-c', script], { cwd: dir, stdout: 'pipe', stderr: 'ignore' });
    const out = await new Response(proc.stdout).text();
    return { code: await proc.exited, out };
  }

  // The shape from dockerHost.writeFile.
  test('a document whose name is an injection attempt is written as a file', async () => {
    const nasty = `a'; touch pwned; echo '.md`;
    await sh(`printf 'hello' > ${quoteOne(nasty)}`);

    // The file exists under its literal name...
    expect((await sh(`test -f ${quoteOne(nasty)} && echo yes || echo no`)).out.trim()).toBe('yes');
    // ...and the command the name was trying to run did not run.
    expect((await sh('test -e pwned && echo yes || echo no')).out.trim()).toBe('no');
  });

  // The shape from dockerHost.stat: two interpolations of the same path.
  test('stat reports the size of a file whose name is an injection attempt', async () => {
    const nasty = `b'; touch pwned-2; echo '.md`;
    await sh(`printf '12345' > ${quoteOne(nasty)}`);

    const statted = await sh(`test -f ${quoteOne(nasty)} && wc -c < ${quoteOne(nasty)}`);
    expect(statted.code).toBe(0);
    expect(Number(statted.out.trim())).toBe(5);
    expect((await sh('test -e pwned-2 && echo yes || echo no')).out.trim()).toBe('no');
  });

  test('stat answers nothing for a path that does not exist', async () => {
    const result = await sh(`test -f ${quoteOne("absent'; echo surprise; '")} && wc -c < x`);
    expect(result.code).not.toBe(0);
    expect(result.out).not.toContain('surprise');
  });
});

/**
 * The one fragment that must stay shell-expandable.
 *
 * The git credential reaches git through `$GIT_TOKEN` expanded BY the shell,
 * because that is how it stays out of an argument list a process listing would
 * show. So `authenticatedRemote` cannot simply quote everything — it is a
 * quoted literal, an unquoted expansion and a quoted remainder, which is
 * exactly the kind of construction worth proving rather than reasoning about.
 */
describe('authenticatedRemote', () => {
  async function oneArgument(fragment: string, token: string): Promise<string[]> {
    const proc = Bun.spawn(['sh', '-c', `printf '%s\\0' ${fragment}`], {
      env: { ...process.env, GIT_TOKEN: token },
      stdout: 'pipe',
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out.split('\0').slice(0, -1);
  }

  test('splices the token into one argument', async () => {
    const fragment = authenticatedRemote('https://gitlab.com/acme/app.git');
    expect(await oneArgument(fragment, 'glpat-abc123')).toEqual([
      'https://oauth2:glpat-abc123@gitlab.com/acme/app.git',
    ]);
  });

  test('a token containing shell metacharacters is still one argument', async () => {
    const fragment = authenticatedRemote('https://gitlab.com/acme/app.git');
    const token = `x'; touch /tmp/factory-token-pwned; echo '`;
    expect(await oneArgument(fragment, token)).toEqual([
      `https://oauth2:${token}@gitlab.com/acme/app.git`,
    ]);
    const check = Bun.spawn(['sh', '-c', 'test -e /tmp/factory-token-pwned && echo y || echo n'], {
      stdout: 'pipe',
    });
    expect((await new Response(check.stdout).text()).trim()).toBe('n');
  });

  test('a clone URL containing shell syntax cannot run a command', async () => {
    const fragment = authenticatedRemote(
      `https://evil.example/a'; touch /tmp/factory-url-pwned; '`,
    );
    const args = await oneArgument(fragment, 'tok');
    expect(args).toHaveLength(1);
    expect(args[0]).toBe(`https://oauth2:tok@evil.example/a'; touch /tmp/factory-url-pwned; '`);
    const check = Bun.spawn(['sh', '-c', 'test -e /tmp/factory-url-pwned && echo y || echo n'], {
      stdout: 'pipe',
    });
    expect((await new Response(check.stdout).text()).trim()).toBe('n');
  });
});
