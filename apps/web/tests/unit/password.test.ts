import { describe, expect, test } from 'bun:test';
import { hashPassword, needsRehash, verifyPassword } from '../../src/lib/services/password';

/**
 * Password hashing that does not depend on which runtime is underneath.
 *
 * The defect this replaces: `Bun.password` on an application whose production
 * build runs on Node, and whose dev server runs on Node on Windows. Creating
 * the first account failed with "Bun is not defined" — on the one screen a
 * fresh deployment cannot get past. Nothing here may touch a `Bun.*` global,
 * and the last test enforces that by reading the source.
 */

describe('a hash round-trips', () => {
  test('the right password verifies, the wrong one does not', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(await verifyPassword('correct horse battery stable', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  test('the same password hashes differently every time', async () => {
    // A fresh salt each time, so two people with the same password do not
    // have the same stored value — and neither can be read off the other.
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });

  test('the stored form names its own parameters', async () => {
    // So the cost can be raised later without breaking what was written today.
    const stored = await hashPassword('x');
    const parts = stored.split('$');
    expect(parts[0]).toBe('scrypt');
    expect(parts).toHaveLength(6);
    expect(Number(parts[1])).toBeGreaterThan(0);
    expect(needsRehash(stored)).toBe(false);
  });

  test('the plaintext never appears in what is stored', async () => {
    const stored = await hashPassword('hunter2-hunter2');
    expect(stored).not.toContain('hunter2');
  });

  test('non-ASCII passwords work', async () => {
    const stored = await hashPassword('пароль-🔑-Straße');
    expect(await verifyPassword('пароль-🔑-Straße', stored)).toBe(true);
    expect(await verifyPassword('пароль-🔑-Strasse', stored)).toBe(false);
  });
});

describe('a bad stored value answers false, never throws', () => {
  // A throw on the sign-in path turns "wrong password" into a 500, and the
  // sign-in screen gives one answer for every kind of miss on purpose.
  test.each([
    ['empty', ''],
    ['not a hash', 'password123'],
    ['wrong prefix', 'bcrypt$1$2$3$AAAA$BBBB'],
    ['too few parts', 'scrypt$16384$8$1$AAAA'],
    ['non-numeric cost', 'scrypt$lots$8$1$AAAA$BBBB'],
    ['zero cost', 'scrypt$0$8$1$AAAA$BBBB'],
    ['wrong key length', `scrypt$16384$8$1$${Buffer.from('salt').toString('base64')}$AAAA`],
    ['not base64 at all', 'scrypt$16384$8$1$!!!!$????'],
  ])('%s', async (_label, stored) => {
    expect(await verifyPassword('anything', stored)).toBe(false);
  });

  test('a cost a runtime refuses is a miss, not a crash', async () => {
    // N large enough to exceed Node's default memory ceiling for scrypt.
    const salt = Buffer.alloc(16).toString('base64');
    const hash = Buffer.alloc(64).toString('base64');
    expect(await verifyPassword('x', `scrypt$${2 ** 24}$8$1$${salt}$${hash}`)).toBe(false);
  });
});

describe('a hash written by Bun.password before this existed', () => {
  test('verifies where Bun is present, and is flagged for re-hashing', async () => {
    // This test runs under Bun, so the legacy path is reachable here. Under
    // Node it cannot be, and `verifyPassword` answers false rather than
    // throwing — the sign-in path then reports a mismatch, which is the
    // honest answer for a hash this runtime cannot check.
    const legacy = await Bun.password.hash('old-way');
    expect(legacy.startsWith('$argon2')).toBe(true);
    expect(await verifyPassword('old-way', legacy)).toBe(true);
    expect(await verifyPassword('new-way', legacy)).toBe(false);
    expect(needsRehash(legacy)).toBe(true);
  });
});

/**
 * The runtime that actually broke.
 *
 * Every other test here runs under Bun, where `Bun.password` exists — so
 * every other test would have passed against the code that failed in
 * production. This one spawns Node, the runtime the production build and the
 * Windows dev server use, and asks it the same questions. Assigning
 * `globalThis.Bun = undefined` under Bun does not work (the global is not
 * writable), which is why the absence has to be real rather than simulated.
 */
describe('under Node, where Bun is not defined', () => {
  const nodeIsHere = Bun.spawnSync(['node', '--version']).exitCode === 0;

  test.skipIf(!nodeIsHere)('hashing, verifying and refusing a legacy hash all work', async () => {
    const script = `
      import { hashPassword, verifyPassword } from '${process.cwd()}/apps/web/src/lib/services/password.ts';
      const out = { bunDefined: typeof Bun !== 'undefined' };
      const stored = await hashPassword('correct horse battery staple');
      out.right = await verifyPassword('correct horse battery staple', stored);
      out.wrong = await verifyPassword('wrong', stored);
      out.legacy = await verifyPassword('x', '$argon2id$v=19$m=65536,t=2,p=1$c2FsdA$aGFzaA');
      console.log(JSON.stringify(out));
    `;
    const proc = Bun.spawn(
      ['node', '--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', script],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    expect(await proc.exited, stderr).toBe(0);

    const result = JSON.parse(stdout.trim().split('\n').at(-1) as string);
    // The precondition: this really is the runtime without the global.
    expect(result.bunDefined).toBe(false);
    expect(result.right).toBe(true);
    expect(result.wrong).toBe(false);
    // A legacy hash cannot be checked here, and says so as a miss — not a throw.
    expect(result.legacy).toBe(false);
  });
});

describe('the module itself', () => {
  /**
   * Comments do not count. Both files explain the history in prose that
   * names `Bun.password`, and a guard that read the prose failed against
   * correct code — the first version of this test did exactly that.
   */
  const codeOnly = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  test('never touches a Bun global outside the legacy branch', async () => {
    // The whole point. `Bun.password` in this file is what broke the first
    // account on every Node runtime, and a regression would pass every other
    // test here because they run under Bun.
    const source = codeOnly(await Bun.file('apps/web/src/lib/services/password.ts').text());
    // The `globalThis` lookup inside `verifyLegacy` reads the property
    // through an optional chain on a local — never a bare `Bun.` access that
    // throws where the global is absent.
    expect(source).not.toMatch(/\bBun\.\w+/);
  });

  test('auth.ts no longer calls Bun.password at all', async () => {
    const source = codeOnly(await Bun.file('apps/web/src/lib/services/auth.ts').text());
    expect(source).not.toContain('Bun.password');
    expect(source).not.toMatch(/\bBun\.\w+/);
  });
});
