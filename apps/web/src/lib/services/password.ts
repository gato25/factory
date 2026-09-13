import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing that works wherever this application runs.
 *
 * This used to be `Bun.password`, which is a fine API and the wrong
 * dependency. The web application is built with `@sveltejs/adapter-node`, so
 * its production build runs on Node — and on Windows even `vite dev` runs on
 * Node, because the launcher's shebang says so and Bun does not swap it there.
 * In both places `Bun` is not defined, and creating the first account on a
 * fresh install failed with exactly those words. That was the one screen a
 * new deployment cannot get past.
 *
 * `scrypt` is in `node:crypto`, which both runtimes provide, and it is a
 * memory-hard password function in its own right — not a downgrade from
 * argon2 for a workspace whose password table has one row in it.
 *
 * The stored form is self-describing:
 *
 *   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
 *
 * so the cost can be raised later without breaking a hash written today: the
 * parameters that made a hash travel with it. `needsRehash` is what notices an
 * older cost and lets sign-in upgrade it.
 */

/**
 * OWASP's 16 MiB row for scrypt: N=2^14, r=8, p=5.
 *
 * OWASP's primary figure is N=2^17 with p=1, and it lists this as an
 * equivalent-work alternative for lower memory. It is chosen here for a
 * reason that was measured rather than assumed: 2^17 needs 128 MiB, which
 * both Node and Bun refuse SYNCHRONOUSLY under their default `maxmem` of
 * 32 MiB, and the override is one more runtime-specific setting for a module
 * whose whole purpose is to have none. This row runs on both with no
 * configuration, at roughly a quarter of a second per hash.
 *
 * An earlier version used p=1 here and called it the OWASP baseline. It was
 * not — it was the 2009 interactive-login figure, a fifth of OWASP's minimum
 * work — and an adversarial review caught the mislabel. Existing hashes at
 * the old cost are upgraded by `needsRehash` on the next successful sign-in.
 */
const N = 16_384;
const R = 8;
const P = 5;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

/**
 * The most a STORED hash may ask verification to do.
 *
 * Without this, a stored value chooses its own cost, and `p` is bounded only
 * by memory — so `p=16382` at today's N is accepted and pins a thread for
 * something like fifteen minutes before answering `false`. Four of those and
 * every file, DNS and crypto operation in the process stalls. It needs an
 * attacker who can write the column, at which point they could simply write a
 * hash they know, so this is defence in depth rather than an authentication
 * hole — but a verifier that can be made to run for a quarter of an hour by
 * its own input is wrong on its own terms.
 *
 * The ceiling is above today's cost so that raising it later still verifies
 * here, and far below anything a hostile row could exploit.
 */
const MAX_N = 1 << 20;
const MAX_R = 8;
const MAX_P = 8;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // scrypt reports refused parameters by THROWING here, synchronously,
    // rather than through the callback. Inside an executor that becomes a
    // rejection, which is what lets `verifyPassword` answer `false`.
    scrypt(password, salt, KEY_BYTES, { N: n, r, p }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

/**
 * Whether `password` is the one `stored` was made from.
 *
 * Never throws for a malformed or foreign hash — it answers `false`. A throw
 * here would turn "wrong password" into a 500 on the sign-in screen, and the
 * sign-in screen deliberately gives one answer for every kind of miss.
 *
 * A hash beginning `$argon2` was written by `Bun.password` before this
 * module existed. Where the `Bun` global is present it is verified the way it
 * was made; where it is not, the honest answer is that it cannot be checked
 * here — `false`, never a crash or a silent pass. `isUnverifiableLegacy` lets
 * the sign-in flow say why in the log, since this module deliberately imports
 * nothing but `node:crypto` and so has no logger of its own.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('$argon2')) return verifyLegacy(password, stored);

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nText, rText, pText, saltText, hashText] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const n = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (![n, r, p].every((value) => Number.isInteger(value) && value > 0)) return false;
  // Bounded before anything is computed. `n <= MAX_N` comes first so the
  // power-of-two check below stays inside 32-bit arithmetic.
  if (n > MAX_N || (n & (n - 1)) !== 0 || r > MAX_R || p > MAX_P) return false;

  // `Buffer.from(text, 'base64')` does not throw on bad input; it skips what
  // it cannot read. So the length check below is the real guard.
  const salt = Buffer.from(saltText, 'base64');
  const expected = Buffer.from(hashText, 'base64');
  if (expected.length !== KEY_BYTES) return false;

  let actual: Buffer;
  try {
    actual = await derive(password, salt, n, r, p);
  } catch {
    // Parameters a runtime refuses are not a password match.
    return false;
  }
  // Equal lengths are guaranteed: `expected` was checked, and `actual` is
  // always KEY_BYTES because the key length is a constant here, never read
  // from the stored string.
  return timingSafeEqual(actual, expected);
}

/** Whether this stored hash was made by `hashPassword` at today's cost. */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith(`scrypt$${N}$${R}$${P}$`);
}

/**
 * Whether `stored` is a hash this runtime has no way to check.
 *
 * True for a `Bun.password` hash where the `Bun` global is absent: a
 * workspace whose accounts were created while the application ran on Bun,
 * now running on Node. The sign-in screen says only "do not match", on
 * purpose; the caller uses this to put the actual reason in the log.
 */
export function isUnverifiableLegacy(stored: string): boolean {
  return stored.startsWith('$argon2') && !legacyVerifier();
}

/** The runtime's own argon2 verifier, where there is one. */
function legacyVerifier(): ((password: string, stored: string) => Promise<boolean>) | null {
  const bun = (globalThis as { Bun?: { password?: { verify: typeof verifyPassword } } }).Bun;
  return bun?.password ? bun.password.verify.bind(bun.password) : null;
}

async function verifyLegacy(password: string, stored: string): Promise<boolean> {
  const verify = legacyVerifier();
  if (!verify) return false;
  try {
    return await verify(password, stored);
  } catch {
    return false;
  }
}
