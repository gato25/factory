# Baseline before the bento redesign (T001)

Recorded on 2026-09-28 on branch `004-bento-redesign`, before any application code of this feature
changed (only the demo seed, the Inter Cyrillic-extended font rule and `design.pen` had). It is what
SC-005 compares against: a test failing here is not a regression of this feature.

## Lint — `bun run lint`

Fails with 202 errors, 222 warnings, 3 infos, all pre-existing:

- about 167 `format` findings: line endings — the working copy is CRLF (`core.autocrlf=true`), the
  formatter wants LF;
- 34 `assist/source/organizeImports`;
- 1 `lint/a11y/useValidLang`;
- warnings: 209 `noNonNullAssertion` (mostly in the browser specs), unused imports and variables.

## Typecheck — `bun run check`

Passes: 0 errors, 1 warning (`settings/+page.svelte` unused CSS selector `.f small`).

## Unit and integration tests — `bun run test`

`bun run test` as one process **hangs**: `apps/web/tests/integration/members.test.ts` leaves a
transaction open on `factory_test` (`pg_stat_activity`: active, `ClientRead`, 30+ minutes), every
later fixture's `TRUNCATE` waits on its lock, and each later test times out in its hook. So the suite
was run file by file with a 180-second limit per file (the scratchpad `per-file-tests.sh`).

**112 files: 1123 pass, 22 fail, 5 files time out.**

**Why five files hang.** Traced on `members.test.ts`: `setRole` itself settles in about 6 ms, and the
same call awaited through `await expect(setRole(...)).rejects.toThrow(...)` never settles. Under Bun
1.3.14, `expect(promise).rejects` hangs when the promise is waiting on a database socket (a timer, or
a promise already rejected, is fine). The five files that time out are the ones that use `.rejects`
on a database-backed call; while one hangs it holds its pool connection, which is how a single run of
the whole suite stalls every later fixture. Awaiting `promise.then(() => null, (error) => error)` and
asserting on the result works. Fixing those files is outside this feature; the new tests written for
it use the working form.

| File | Pass | Fail | Result | Failing tests |
|---|---|---|---|---|
| `apps/web/tests/unit/password.test.ts` | 25 | 1 | ok | under Node, where Bun is not defined > hashing, verifying and refusing a legacy hash all work |
| `apps/web/tests/integration/approval.test.ts` | 3 | 3 | ok | a non-approver cannot decide a gate reserved for the ticket author; an administrator is not an approver by virtue of being an administrator; a named approver list admits only the people on it |
| `apps/web/tests/integration/authz.test.ts` | 9 | 3 | ok | a member may not, and is told why; nobody signed out may change workspace settings; a named list admits only those named |
| `apps/web/tests/integration/defaults.test.ts` | 4 | 1 | ok | its prompt makes it responsible for the repository tests |
| `apps/web/tests/integration/first-account.test.ts` | 8 | 1 | ok | after the first account exists > self-registration is refused, naming what to do instead |
| `apps/web/tests/integration/members.test.ts` | 0 | 0 | TIMEOUT | the last administrator cannot be demoted, so the workspace stays reachable; once somebody else is an administrator, the first one may step down; the last administrator cannot remove themselves, which is the same lock;… |
| `apps/web/tests/integration/ownership.test.ts` | 10 | 1 | ok | someone signed out is told to sign in, not that it belongs to someone |
| `apps/web/tests/integration/password-migration.test.ts` | 0 | 0 | TIMEOUT | a wrong password against a Bun-era hash is refused and nothing is rewritten; a hash at an older scrypt cost is upgraded the same way |
| `apps/web/tests/integration/requirement-files.test.ts` | 0 | 0 | TIMEOUT | a refused upload leaves earlier documents untouched; files are listed by name, so a re-run sees them in the same order; removing one is scoped to its ticket; removing one that is already gone is not an error; the mani… |
| `apps/web/tests/integration/retry.test.ts` | 9 | 3 | ok | both attempts are listed, newest first, each with its own reason; a run still in flight cannot be retried, and is told why; a third attempt keeps both earlier ones |
| `apps/web/tests/integration/skill-history.test.ts` | 0 | 0 | TIMEOUT | a refused save leaves no version behind; a save whose version cannot be recorded changes nothing; deleting a skill takes its history with it; history is readable by someone who may not change the skill; (unnamed) |
| `apps/web/tests/integration/snapshot.test.ts` | 0 | 0 | TIMEOUT | resolution refuses a pipeline whose agent has been deleted; the workspace ceiling applies when nothing lower is set; a pipeline's lower ceiling binds, and the message names it (FR-079); a pipeline CANNOT raise consump… |
| `apps/web/tests/integration/start-draft.test.ts` | 3 | 1 | ok | a draft whose pipeline is gone says which thing is missing |
| `apps/runner/tests/contract/runner-image.test.ts` | 10 | 1 | ok | the runner image > is the docker execution host, in production, and nothing else |
| `apps/runner/tests/integration/cancel-and-terminal.test.ts` | 5 | 1 | ok | finishing, across a restart > a merge request already opened is not opened again |
| `apps/runner/tests/unit/lock.test.ts` | 10 | 1 | ok | the state directory > one that cannot be written to is named, so the failure is about disk and not about a run |
| `apps/runner/tests/unit/shell.test.ts` | 12 | 3 | ok | the shapes container/host.ts builds > a document whose name is an injection attempt is written as a file; the shapes container/host.ts builds > stat reports the size of a file whose name is an injection attempt; the s… |
| `scripts/design/tests/screens.test.ts` | 4 | 2 | ok | every phrase a screen takes is still in its artboard; every phrase a screen takes is still in the screen |

Every other file passes in full.

## Browser tests — `bun run e2e`

Run with port 5173 freed (the payment-flow dev server that held it was stopped, at the user's
request) and the root `.env` exported, so `SESSION_SECRET` reaches the specs — without it 39 of the
42 tests skip themselves. Chromium from `PLAYWRIGHT_CHROMIUM_PATH` (build 1234; Playwright 1.63 asks
for 1243, which is not installed).

**42 tests: 1 passed, 38 failed, 3 skipped (9.9 min).**

| Spec | Passed | Failed |
|---|---|---|
| `agents.spec.ts` | 0 | 6 |
| `approve.spec.ts` | 0 | 7 |
| `design-stage.spec.ts` | 0 | 3 |
| `governance.spec.ts` | 0 | 8 |
| `pipeline-builder.spec.ts` | 0 | 4 |
| `recover.spec.ts` | 0 | 5 |
| `ticket-to-mr.spec.ts` | 1 | 3 |
| `watch-run.spec.ts` | 0 | 2 |

Nearly every failure is a spec waiting for an ENGLISH word — `'Cancel run'`, `'New'`,
`/Continue with GitLab/`, `'Queued'` — on an interface that has spoken Mongolian since commit
`1522e87` ("Say the interface in the language the design is drawn in"). The specs were not moved to
the catalogue with it, so at this baseline the suite says nothing about behaviour either way.

Consequence for this feature: a screen's definition of done includes its behaviour specs passing, so
each existing spec is moved to the catalogue's words (`import { m } from '../../src/lib/i18n'`, as
`frame.spec.ts` does) in the task that verifies its screen. Where the redesign removes an element a
spec asserted, the assertion moves to its successor (research D12).

## After

_Filled in at T094 (final visual review) and T091–T092 (verify, e2e)._
