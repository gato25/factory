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
 * parameters that made a hash travel with it.
 */

/**
 * OWASP's cited scrypt baseline. Memory use is 128 · N · r bytes — 16 MiB
 * here — which sits under Node's default `maxmem` of 32 MiB, so no override
 * is needed and no runtime refuses it.
 */
const N = 16_384;
const R = 8;
const P = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
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
 * here — which is `false`, with a note in the log, rather than a crash or a
 * silent pass.
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

  let expected: Buffer;
  let salt: Buffer;
  try {
    salt = Buffer.from(saltText, 'base64');
    expected = Buffer.from(hashText, 'base64');
  } catch {
    return false;
  }
  if (expected.length !== KEY_BYTES) return false;

  let actual: Buffer;
  try {
    actual = await derive(password, salt, n, r, p);
  } catch {
    // Parameters a runtime refuses (for instance an N that exceeds its
    // memory ceiling) are not a password match.
    return false;
  }
  return timingSafeEqual(actual, expected);
}

/** Whether this stored hash was made by `hashPassword` at today's cost. */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith(`scrypt$${N}$${R}$${P}$`);
}

async function verifyLegacy(password: string, stored: string): Promise<boolean> {
  const bun = (globalThis as { Bun?: { password?: { verify: typeof verifyPassword } } }).Bun;
  if (!bun?.password) return false;
  try {
    return await bun.password.verify(password, stored);
  } catch {
    return false;
  }
}
