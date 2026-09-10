import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { FactoryError } from '@factory/shared';

/**
 * Credentials are encrypted at rest with a key held only by the application
 * (FR-011, Principle V). Two deliberate properties of this module:
 *
 *  - `mask` is the only accessor any interface may use. It cannot return the
 *    plaintext, so "never readable back in full" is a property of the API
 *    rather than a rule reviewers must remember.
 *  - `revealForRun` is the single plaintext path. It is named so that a call
 *    site outside run preparation is obvious in review, and it is never
 *    reachable from a remote function.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface SealedCredential {
  /** base64: iv | authTag | ciphertext */
  ciphertext: string;
  keyVersion: string;
  /** Last four characters, for the interface. Never more. */
  hint: string;
}

export interface KeyRing {
  /** The key new credentials are sealed with. */
  current: { version: string; key: Buffer };
  /** Older keys, so rotation does not invalidate stored credentials. */
  previous?: { version: string; key: Buffer }[];
}

export function keyRingFromEnv(env: NodeJS.ProcessEnv = process.env): KeyRing {
  const raw = env.SECRET_ENCRYPTION_KEY;
  if (!raw) {
    throw new FactoryError('credential_missing', 'SECRET_ENCRYPTION_KEY is not set');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new FactoryError(
      'invalid_input',
      `SECRET_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`,
    );
  }
  return { current: { version: env.SECRET_ENCRYPTION_KEY_VERSION ?? 'v1', key } };
}

export function seal(plaintext: string, ring: KeyRing): SealedCredential {
  if (plaintext.length === 0) {
    throw new FactoryError('invalid_input', 'a credential cannot be empty');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, ring.current.key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([iv, tag, body]).toString('base64'),
    keyVersion: ring.current.version,
    hint: mask(plaintext),
  };
}

/**
 * The ONLY path back to plaintext, and only for supplying a run. The Runner
 * receives the value and passes it to the container as environment; it is
 * never written into the workspace (FR-083).
 */
export function revealForRun(sealed: SealedCredential, ring: KeyRing): string {
  const keys = [ring.current, ...(ring.previous ?? [])].filter(
    (k) => k.version === sealed.keyVersion,
  );
  const entry = keys[0];
  if (!entry) {
    throw new FactoryError(
      'credential_invalid',
      `no key available for version ${sealed.keyVersion}`,
    );
  }
  const raw = Buffer.from(sealed.ciphertext, 'base64');
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + 16);
  const body = raw.subarray(IV_BYTES + 16);
  const decipher = createDecipheriv(ALGORITHM, entry.key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    throw new FactoryError('credential_invalid', 'stored credential failed authentication');
  }
}

/** What every interface shows. Cannot reconstruct the credential (FR-011). */
export function mask(plaintext: string): string {
  const tail = plaintext.slice(-4);
  return plaintext.length <= 4 ? '••••' : `••••${tail}`;
}

/** Constant-time comparison, for verifying a presented token. */
export function matches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
