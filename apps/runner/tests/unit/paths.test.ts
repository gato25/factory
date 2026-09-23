import { describe, expect, test } from 'bun:test';
import { directoryName, withinWorkspace } from '../../src/container/paths';

/**
 * Paths people name stay inside the workspace, whichever host resolves them.
 */

describe('a workspace-relative path', () => {
  test('ordinary paths pass, normalised', () => {
    expect(withinWorkspace('docs/spec.md')).toBe('docs/spec.md');
    expect(withinWorkspace('./docs//plan.md')).toBe('docs/plan.md');
    expect(withinWorkspace('a/b/../c.md')).toBe('a/c.md');
    expect(withinWorkspace('docs\\spec.md')).toBe('docs/spec.md');
  });

  test('one that leaves the workspace is refused, not corrected', () => {
    for (const bad of ['../x', 'docs/../../x', '../../../.ssh/authorized_keys', 'a/../../b']) {
      expect(() => withinWorkspace(bad)).toThrow(/leaves the workspace/);
    }
  });

  test('an absolute path, a drive path, the workspace itself and nothing are refused', () => {
    expect(() => withinWorkspace('/etc/passwd')).toThrow(/relative to the workspace/);
    expect(() => withinWorkspace('C:\\Users\\x')).toThrow(/relative to the workspace/);
    expect(() => withinWorkspace('.')).toThrow(/names the workspace itself/);
    expect(() => withinWorkspace('')).toThrow(/empty/);
    expect(() => withinWorkspace('a\0b')).toThrow(/empty or not a path/);
  });

  test('the refusal is a 400, so a caller is told rather than served a 500', () => {
    try {
      withinWorkspace('../x', 'edited document');
      throw new Error('did not throw');
    } catch (error) {
      expect((error as { status: number }).status).toBe(400);
      expect((error as Error).message).toContain('edited document');
    }
  });
});

describe('a name that becomes a directory', () => {
  test('plain names pass', () => {
    expect(directoryName('house-style')).toBe('house-style');
    expect(directoryName(' sandbox_v2 ')).toBe('sandbox_v2');
  });

  test('anything with a separator, a leading dot, or only dots is refused', () => {
    for (const bad of ['../../.claude/skills/ops', 'a/b', 'a\\b', '.hidden', '..', '', 'x y']) {
      expect(() => directoryName(bad, 'skill name')).toThrow(/single directory name/);
    }
  });
});
