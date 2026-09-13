import { describe, expect, test } from 'bun:test';
import {
  ACCEPTED_EXTENSIONS,
  byteLength,
  checkAddition,
  checkFile,
  describeBytes,
  extensionOf,
  looksLikeText,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  safeFileName,
} from '../src/requirement-files';

/**
 * What may be attached to a ticket, and what the name becomes.
 *
 * These rules are enforced in three places — the form, the service that
 * stores a file, and the execution service that writes it into a sandbox — so
 * they live in one module and are pinned here. The two that matter most are
 * the name (it becomes a path inside a sandbox) and the text check (a file
 * that is not text is unreadable to an agent, and finding that out three steps
 * into a run costs a whole run).
 */

const text = (content = 'hello') => content;

describe('the name a file gets inside a sandbox', () => {
  test('an ordinary name survives unchanged', () => {
    expect(safeFileName('requirements.md')).toBe('requirements.md');
    expect(safeFileName('billing-rules_v2.csv')).toBe('billing-rules_v2.csv');
  });

  test('a directory is stripped, whichever separator was used', () => {
    // The browser sends what the person picked. A name carrying a path would
    // write outside the requirements directory, which is the whole reason
    // this function exists rather than using the name as given.
    expect(safeFileName('/etc/passwd.txt')).toBe('passwd.txt');
    expect(safeFileName('C:\\Users\\me\\brief.md')).toBe('brief.md');
    expect(safeFileName('../../secrets.txt')).toBe('secrets.txt');
  });

  test('a name that is only traversal cannot escape', () => {
    // `..` and `.` survive none of the stripping, so the fallback name is
    // what is left. A file called `requirement` inside the directory is a
    // harmless outcome; a file called `..` is not.
    expect(safeFileName('..')).toBe('requirement');
    expect(safeFileName('.')).toBe('requirement');
    expect(safeFileName('...')).toBe('requirement');
  });

  test('a leading dot is removed, so nothing lands as a hidden file', () => {
    expect(safeFileName('.env.txt')).toBe('env.txt');
  });

  test('characters a shell would read are replaced, not escaped', () => {
    // Escaping puts the burden on every caller getting the quoting right.
    // Removing puts it here, once.
    expect(safeFileName('rm -rf $(pwd);.md')).toBe('rm-rf-pwd.md');
    expect(safeFileName('a b"c\'d.txt')).toBe('a-b-c-d.txt');
  });

  test('a very long name is shortened but keeps its extension', () => {
    const long = `${'requirement'.repeat(40)}.md`;
    const safe = safeFileName(long);
    expect(safe.endsWith('.md')).toBe(true);
    expect(safe.length).toBeLessThanOrEqual(83);
  });

  test('non-ASCII is transliterated rather than dropped to nothing', () => {
    // A name in an alphabet none of this can transliterate still has to
    // produce something openable, so it falls back rather than becoming
    // `.md` — a file with no name at all.
    expect(safeFileName('спецификация.md')).toBe('requirement.md');
    expect(safeFileName('café-brief.md')).toBe('cafe-brief.md');
  });

  test('a name that reduces to nothing gets one rather than being refused', () => {
    expect(safeFileName('.md')).toBe('requirement.md');
    expect(checkFile({ name: '.md', content: 'hello' })).toBeNull();
  });

  test('a blank name is refused', () => {
    expect(checkFile({ name: '   ', content: 'hello' })?.reason).toBe('type');
  });
});

describe('what may be attached', () => {
  test.each(ACCEPTED_EXTENSIONS)('%s is accepted', (extension) => {
    expect(checkFile({ name: `brief${extension}`, content: text() })).toBeNull();
  });

  test('a PDF is refused, and the message says what IS accepted', () => {
    const problem = checkFile({ name: 'brief.pdf', content: text() });
    expect(problem?.reason).toBe('type');
    // Refusing without saying what to do instead makes somebody guess.
    expect(problem?.message).toContain('.md');
  });

  test('a file with no extension is refused', () => {
    expect(checkFile({ name: 'README', content: text() })?.reason).toBe('type');
  });

  test('the extension decides, not the browser’s idea of the type', () => {
    // Windows reports .md as application/octet-stream, macOS as text/markdown
    // and some browsers as the empty string. Trusting that would refuse the
    // same file on one machine and accept it on another.
    expect(checkFile({ name: 'brief.MD', content: text() })).toBeNull();
  });

  test('an empty file is refused rather than stored', () => {
    expect(checkFile({ name: 'brief.md', content: '' })?.reason).toBe('empty');
  });

  test('a file over the per-file limit is refused, naming both sizes', () => {
    const problem = checkFile({ name: 'huge.txt', content: 'x'.repeat(MAX_FILE_BYTES + 1) });
    expect(problem?.reason).toBe('too_large');
    expect(problem?.message).toContain(describeBytes(MAX_FILE_BYTES));
  });

  test('a binary renamed to .txt is refused', () => {
    // The case this exists for: somebody exports a PDF, renames it, and the
    // agent is handed mojibake. Refusing at upload costs seconds; finding out
    // at the implement step costs the run.
    const pdf = `%PDF-1.4\u0000\u0000\u0000binary`;
    const problem = checkFile({ name: 'brief.txt', content: pdf });
    expect(problem?.reason).toBe('binary');
  });

  test('text with accents, emoji and CRLF endings is still text', () => {
    expect(looksLikeText('Der Straße — 40 % ✅\r\nnext line\r\n')).toBe(true);
  });

  test('size is measured in bytes, not characters', () => {
    // A limit measured in characters would let a document of multi-byte text
    // be several times the size the limit claims.
    expect(byteLength('é')).toBe(2);
    expect(byteLength('✅')).toBe(3);
    expect(byteLength('abc')).toBe(3);
  });
});

describe('what a whole ticket may carry', () => {
  const existing = (count: number, bytes: number) =>
    Array.from({ length: count }, (_, index) => ({ name: `f${index}.md`, bytes }));

  test('adding within both limits is allowed', () => {
    expect(checkAddition(existing(2, 1000), [{ name: 'new.md', content: 'hello' }])).toBeNull();
  });

  test('the file COUNT is checked against the total after the upload', () => {
    const problem = checkAddition(existing(MAX_FILES, 10), [{ name: 'one-more.md', content: 'x' }]);
    expect(problem?.reason).toBe('too_many');
  });

  test('the total SIZE is checked against the total after the upload', () => {
    // Checking only the incoming file would let a ticket cross the limit one
    // acceptable upload at a time, which is how it would actually happen.
    const nearly = [{ name: 'big.md', bytes: MAX_TOTAL_BYTES - 10 }];
    const problem = checkAddition(nearly, [{ name: 'small.md', content: 'x'.repeat(100) }]);
    expect(problem?.reason).toBe('total_too_large');
  });

  test('re-uploading the same name replaces rather than adds', () => {
    // Correcting a typo in a file that nearly fills the ticket must not be
    // refused for making the ticket twice as large as it will end up being.
    const nearly = [{ name: 'big.md', bytes: MAX_TOTAL_BYTES - 10 }];
    expect(checkAddition(nearly, [{ name: 'big.md', content: 'x'.repeat(100) }])).toBeNull();
  });

  test('replacement matches on the SAFE name, not the uploaded one', () => {
    // What is stored is the safe name, so `/tmp/big.md` replaces `big.md`.
    // Matching on the raw name would store a second copy under the same
    // stored name and violate the unique index instead of replacing.
    const stored = [{ name: 'big.md', bytes: MAX_TOTAL_BYTES - 10 }];
    expect(checkAddition(stored, [{ name: '/tmp/big.md', content: 'x'.repeat(100) }])).toBeNull();
  });

  test('an empty ticket taking its first file is allowed', () => {
    expect(checkAddition([], [{ name: 'brief.md', content: 'hello' }])).toBeNull();
  });
});

describe('sizes as a person reads them', () => {
  test.each([
    [0, '0 bytes'],
    [512, '512 bytes'],
    [2048, '2 KB'],
    [1024 * 1024 * 3, '3.0 MB'],
  ])('%i reads as %s', (bytes, expected) => {
    expect(describeBytes(bytes)).toBe(expected);
  });
});

describe('extensions', () => {
  test('the last dot decides, and case does not matter', () => {
    expect(extensionOf('a.b.MD')).toBe('.md');
    expect(extensionOf('noextension')).toBe('');
    expect(extensionOf('.gitignore')).toBe('.gitignore');
  });
});
