import { describe, expect, test } from 'bun:test';
import { quote, quoteOne } from '../../src/container/shell';

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
