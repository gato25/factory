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

Recorded on 2026-09-28 in the cloud container this feature was finished in (Linux, LF working copy,
Bun 1.3.11), after T001–T094. Where a result differs from the baseline above, the reason is given.

### Lint — `bun run lint` (T091)

29 errors, 333 warnings, 3 infos (baseline: 202, 222, 3). Every error is one of the baseline's own
kinds — 24 `assist/source/organizeImports` and 5 `format` — and none is in a file this feature
touched; each file the feature changed was formatted and its imports ordered. The
warnings are the baseline's `noNonNullAssertion`, now also in the specs this feature wrote in the
same style as their neighbours.

### Typecheck and audits (T092)

`bun run check`: 0 errors, 0 warnings (the baseline's unused `.f small` selector went with the settings
rebuild). `bun run audit:offline` and `bun run audit:browser`: pass.

### Unit and integration tests (T092)

Run file by file with a 180-second limit, each from the repository root as `bun run test` runs
them: **122 files, 1220 pass, 18 fail, 0 time out.** Nothing that passed at the baseline fails.

(An earlier count here — 1198 pass, 27 fail — ran each file from its own app's directory. Tests that
open files by a root-relative path, such as `password.test.ts` and several runner contract tests,
cannot find them from there; those failures were the harness's, not the code's, and are gone.)

- `scripts/design/tests/screens.test.ts` now passes in full (baseline: 2 failing) — every screen
  artboard 00–14 is covered, and removing one fixed phrase fails it naming the screen and phrase
  (T084: "09 Agents: Хараахан ашиглаагүй").
- **16 of the 18 failures assert English words** in messages the catalogue moved to Mongolian —
  `approval` (3), `authz` (3), `members` (3), `retry` (3), `ownership`, `start-draft`,
  `first-account` (self-registration) and `defaults` (1 each). The behaviour each one checks holds —
  a non-approver is refused, only in Mongolian. `defaults` also asserts a phrase the shipped
  Implement prompt no longer contains, and `retry` shows one message is only half translated
  (`run.ts`: "attempt 1 of #142 is still running." then Mongolian). These are the same tests the
  baseline listed; `members.test.ts` now finishes instead of timing out.
- **2 describe the platform**: `execution-host` expects the process host not to run as root, and this
  container runs everything as root; `open-design` expects `C:/Windows/System32/x.pen` to be refused
  as an absolute path, which on Linux it is not — it is confined to the workspace and not found
  instead, so nothing escapes either way.
- `first-account.test.ts` asserted an English word in the too-short-password message; it now reads
  the catalogue, and passes.

### Browser tests — `bun run e2e` (T093)

**84 tests: 79 passed, 2 failed, 3 skipped (5.0 min)** in one run (baseline: 42 tests, 1 passed, 38
failed). The two failures, and what they were:

- `dashboard.spec.ts` "3: … equal the audit (SC-004)": the spec read the audit through
  `execFileSync`, which throws when the audit exits non-zero — and it does whenever the rate is under
  its 70% criterion, which the shared database (the specs' own rows included) now was. The spec reads
  the audit's output whatever its exit code; it passes.
- `recover.spec.ts` "editing and retrying is one action": the retry takes about 33 seconds, and ran
  past its 60-second wait while the same machine was running the integration suite and screen
  captures. Run again on its own, all five recover tests pass.

### Visual review, per screen (T095)

Captured at 1440px on the demo data and compared with each artboard's tree (`scripts/design/report.ts`)
for tiles, order, copy and colour meaning. The copy is also held by the fidelity check; each
deliberate omission is in `scripts/design/screens.ts` with its reason. At 1024px no screen overflows
and no text is under 12px (the board's five columns wrap into rows); in English (`DEFAULT_LOCALE =
'en'`) every screen renders with no missing word — what stays Mongolian is the demo data.

| Screen | Matches | Deliberate divergences |
|---|---|---|
| 00 Login | yes | the two floating widgets (a figure, a named ticket) are not drawn before sign-in |
| Frame | yes | — |
| 01 Dashboard | yes | the "nothing can run yet" notice is red, not golden: it needs attention (FR-005) |
| 02 Repositories | yes | — |
| 03 Connect Repository | yes | — |
| 04 Tickets Board | yes | the backlog column is neutral; tints are the design's deepest in each hue (ΔE ≥ 10) |
| 05 Create Ticket | yes | the file field's "Choose Files" is the browser's own control, in the browser's language; the no-verification caution is red |
| 06 Ticket Run | yes | the task document is named by what it is for, not its task count |
| 07 Approval Checkpoint | yes | the timeline names a decision, not who made it |
| 08 Pipeline Builder | yes | a checkpoint is titled by kind, not purpose; a condition in the form's words; a custom agent's step takes the deep accent, not blue |
| 08 Pipelines list | no artboard | built from the kit's tiles and chips |
| 09 Agents | yes | a custom agent's orb and badge take the deep accent, not blue: blue is the design service's alone (FR-005) |
| 10 Agent Editor | yes | no "Sandbox-д турших" (nothing behind it); Edit and Write are separate switches; prompt variables and skill chips are neutral, not blue |
| 11 Skills | yes | skill orbs are neutral, not blue, except the one open, in the accent |
| 12 Settings | yes | sections ordered by the one form they share (limits before keys); no Docker host, sandbox status, removal toggle, workspace design model or export — none is a setting the application has; the limits and notifications orbs are neutral |
| 14 Design Review | yes | the design step's own time and cost are beside the screens, not in the head |

### Human checks (T096) — waiting on people

Neither can be stood in for by a test; both need the presentation room, its projector with the
lights on, and people seeing the screens for the first time.

- **SC-001**: show the dashboard to 5 people who have not seen it; pass if at least 4 say within 5
  seconds which tickets need them. _Result: not yet run._
- **SC-003**: 3 viewers at 6 metres in the lit room read every ticket title and state on the
  dashboard, the board and a running ticket. _Result: not yet run._

