import { expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import {
  type KeyRing,
  keyRingFromEnv,
  mask,
  revealForRun,
  seal,
} from '../../src/lib/secrets/store';

const ring: KeyRing = { current: { version: 'v1', key: randomBytes(32) } };
const TOKEN = 'ghp_aBcDeFgH1234567890ijKlMnOpQrStUvWx';

test('a sealed credential round-trips on the run-supply path only', () => {
  const sealed = seal(TOKEN, ring);
  expect(sealed.ciphertext).not.toContain(TOKEN);
  expect(revealForRun(sealed, ring)).toBe(TOKEN);
});

test('what an interface can see cannot reconstruct the credential (FR-011)', () => {
  const sealed = seal(TOKEN, ring);
  // The hint is all any screen ever gets.
  expect(sealed.hint).toBe(`••••${TOKEN.slice(-4)}`);
  expect(sealed.hint.length).toBeLessThan(TOKEN.length);
  expect(TOKEN).not.toContain(sealed.hint);
  expect(mask(TOKEN)).not.toContain(TOKEN.slice(0, 8));
});

test('a very short value is fully masked rather than mostly shown', () => {
  expect(mask('abc')).toBe('••••');
});

test('a tampered ciphertext is refused, not silently decrypted', () => {
  const sealed = seal(TOKEN, ring);
  const raw = Buffer.from(sealed.ciphertext, 'base64');
  raw[raw.length - 1] ^= 0xff;
  const tampered = { ...sealed, ciphertext: raw.toString('base64') };
  expect(() => revealForRun(tampered, ring)).toThrow(/failed authentication/);
});

test('a credential sealed under a retired key is refused when that key is gone', () => {
  const sealed = seal(TOKEN, ring);
  const rotated: KeyRing = { current: { version: 'v2', key: randomBytes(32) } };
  expect(() => revealForRun(sealed, rotated)).toThrow(/no key available for version v1/);
});

test('rotation keeps older credentials readable while sealing new ones with the new key', () => {
  const sealed = seal(TOKEN, ring);
  const rotated: KeyRing = {
    current: { version: 'v2', key: randomBytes(32) },
    previous: [ring.current],
  };
  expect(revealForRun(sealed, rotated)).toBe(TOKEN);
  expect(seal(TOKEN, rotated).keyVersion).toBe('v2');
});

test('an empty credential is rejected', () => {
  expect(() => seal('', ring)).toThrow(/cannot be empty/);
});

test('the key must be present and exactly 32 bytes', () => {
  expect(() => keyRingFromEnv({} as NodeJS.ProcessEnv)).toThrow(/SECRET_ENCRYPTION_KEY is not set/);
  expect(() =>
    keyRingFromEnv({
      SECRET_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64'),
    } as NodeJS.ProcessEnv),
  ).toThrow(/must decode to 32 bytes, got 16/);
  const ok = keyRingFromEnv({
    SECRET_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  } as NodeJS.ProcessEnv);
  expect(ok.current.version).toBe('v1');
});

test('two seals of the same value differ, so ciphertext leaks no equality', () => {
  expect(seal(TOKEN, ring).ciphertext).not.toBe(seal(TOKEN, ring).ciphertext);
});
