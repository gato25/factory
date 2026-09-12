# Security review: the credential path

**Task**: T234 · **Date**: 2026-09-10
**Scope**: encryption at rest, environment injection, redaction at ingest, and the Runner's
privilege boundary (Constitution Principle V; FR-009, FR-011, FR-083, FR-083a, FR-083b, FR-084).

## The path, end to end

A credential's whole life, traced through the code rather than the design documents:

1. **Entered.** An administrator types it into Settings, or a repository token into
   `/repositories`. Both go to a `form`, which is a POST to the server; the value never enters a
   `query` result and never round-trips to a browser.
2. **Sealed.** `seal()` in `apps/web/src/lib/secrets/store.ts` — AES-256-GCM, a fresh 12-byte IV
   per credential, the auth tag concatenated ahead of the body, all base64. Stored in
   `credentials.ciphertext` with `credentials.key_version`.
3. **Referenced.** The pipeline snapshot carries `repo.credential_ref` — an id, never a value
   (`packages/shared/src/snapshot.ts`). This is what the orchestration service receives.
4. **Exchanged.** The Runner POSTs `/api/runs/:id/credentials`, authenticated with the run's own
   secret. `resolveRunCredentials` calls `revealForRun` — the only path back to plaintext in the
   codebase — and returns the values to the Runner and nowhere else.
5. **Injected.** `buildEnvironment` puts them in the container's environment:
   `ANTHROPIC_API_KEY`, `GIT_TOKEN`, and `PEN_CLI_KEY` only where the pipeline has a design step.
6. **Redacted.** `LogSink` is constructed with `secretValues(credentials)` and redacts at the
   point output is **ingested**, before anything is stored or streamed.

## What holds up

**The plaintext path has exactly one door, and it is named.** `revealForRun` is the only function
that decrypts, and its only caller is `run-credentials.ts`, whose only caller is the credential
exchange route. `mask()` is what every interface gets and it cannot reconstruct a value. This is a
property of the module's shape, not a rule a reviewer has to remember — which is the right way to
build it.

**A credential is never on a command line.** `apps/runner/src/container/host.ts` passes `--env KEY`
— the *name* only — and supplies the value through the spawned process's own environment. Had it
passed `--env KEY=value`, every secret would be visible in `ps` output on the container host and in
Docker's own logging. This is a deliberate, easily-lost detail and it is correct in both the
`create` and `exec` paths.

**The design credential is withheld unless it is needed.** `pipelineNeedsDesign` gates
`PEN_CLI_KEY`, so a pipeline with no design step never receives it (FR-083a). A pipeline that does
need it and has none fails at container start with a message naming where to configure it, rather
than at the design step with a provider error (FR-083b).

**Redaction is at ingest and cannot be undone later.** `LogSink.write` buffers to whole lines so a
credential cannot be split across two chunks and escape a value match, and `clean()` exposes the
same redactor for text that is retained but not streamed — a step's failure detail, which is where
a leak was found and fixed in Phase 9. What is stored is already redacted, so a future change to a
viewer cannot un-redact history.

**Shape-based redaction as a second line.** `CREDENTIAL_SHAPES` catches GitHub, GitLab and
Anthropic token formats, `authorization:` headers and credentials embedded in URLs, even for values
this system was never given — an agent printing a token it found in the repository is covered.
Verified live: a planted `glpat-…` in a log chunk was caught by the T225 audit, which reported the
shape and withheld the value.

**Nothing logs a credential or a snapshot.** Every `log.*` call in both deployables was checked; no
call passes a snapshot, a credentials object, or any field named for a token or key. Only container
ids and run ids.

**Callback authentication is constant-time.** `authenticateCallback` compares with
`timingSafeEqual`, length-checked first, and a rejected call cannot distinguish a wrong secret from
a run that does not exist.

## Findings

### 1. The Runner connection test could not fail on a credential — fixed

`testRunner` probed `GET /health`, which the Runner serves **unauthenticated** by design, and did
not send the token at all. A wrong `RUNNER_AUTH_TOKEN` therefore produced
`reachable — Reachable, and it accepted our credential.` It had not.

This is the worst kind of security-adjacent bug: a check that always passes, presented to an
operator as evidence. FR-005a exists precisely to distinguish this case, and the distinguishing
logic in `probe()` was correct — it was never reached, because nothing ever returned 401.

**Fixed** by adding `GET /ready` to the Runner behind `authenticate()`, and pointing the probe at it
with the credential attached. The route also reports whether the Runner can reach its container
host, which is a different fault from a wrong address or a wrong token and was previously invisible
until the first run failed.

Verified against a running Runner: no token → 401, wrong token → 401, correct token → 200 with
`{"status":"degraded","container_host":"unreachable"}`. Through the settings service: wrong token →
`unauthorised — It answered but refused our credential. Replace the credential.`
`apps/web/tests/integration/connections.test.ts` asserts that the probe sends the credential and
that it targets `/ready`, so this cannot regress silently.

### 2. Key rotation would have destroyed every stored credential — fixed

`KeyRing.previous` existed, `revealForRun` searched it, and `keyRingFromEnv` never populated it.
Rotating `SECRET_ENCRYPTION_KEY` would have made every credential already sealed undecryptable at
once — every repository stops working, every run fails at the exchange, and the only remedy is
re-entering every token by hand. A documented capability that would have caused an outage.

**Fixed** with `SECRET_ENCRYPTION_KEYS_PREVIOUS` (`version:base64,version:base64`). Two guards:
an entry repeating the current version is refused, because two keys claiming one version makes it
an accident which one decrypts a credential; and a malformed or wrong-length entry fails at
startup rather than at the first run. Covered in `apps/web/tests/integration/secrets.test.ts`,
including the failure the operator would see if they dropped the old key — `no key available for
version v1`, which names what they lost.

### 3. Two constant-time comparisons — fixed

`matches()` was exported from the secrets module and unused; `authenticateCallback` reimplemented
the comparison inline. Two implementations of one primitive is two chances for a future edit to
reach for `===`. Consolidated on `matches()`.

### 4. The orchestration service holds tokens that can be exchanged for credentials — residual

FR-083's letter is met: the snapshot carries references, and n8n never holds a credential value or
persists one. But the snapshot also carries `resume_secret`, and the workflow's node for the Runner
carries `RUNNER_AUTH_TOKEN`. Anyone who can read an n8n execution can therefore call
`/api/runs/:id/credentials` and be handed the git token, the model key and, where the pipeline has a
design step, the design key.

This is not fixable inside the application: n8n needs the run secret to post callbacks and resume
gates, and needs the Runner's token to drive the Runner. Narrowing the exchange to "the Runner only"
cannot be done with a shared secret both parties hold.

**Mitigation is deployment-level**, and belongs in an operator's hands:

- `/api/runs/:id/credentials` should be reachable only from the Runner's address. The application
  is public (a person signs in to it); this one route is not, and a reverse proxy or network policy
  restricting it costs nothing.
- n8n's execution data retention should be short, and its own access controls tight. An n8n
  execution list is, in effect, a list of bearer tokens.
- Neither the Runner nor n8n should be reachable from the public internet (contracts/runner.md
  already says this of the Runner).

Recorded in [operations.md](../operations.md) under **Network boundaries**. Treated as residual
rather than a defect, because the alternative — a separate single-use exchange token issued to the
Runner — would have to travel through n8n to reach it, which is the same exposure with more moving
parts.

### 5. Screens embedded in a merge request require a Factory session — residual

`/api/artifacts/:id/image` requires a signed-in user, which is right for a customer's unreleased
design. But a merge request body embeds those addresses, and providers fetch images server-side
through an image proxy with no cookies. So on GitHub the screens will not render, and on GitLab they
render only for a reviewer who happens to have a live Factory session in the same browser.

The safe fix is not simply to open the route: that would make every unreleased design fetchable by
anyone who learns a URL. It needs a signed, expiring, per-artifact address — a real design decision
with its own tradeoffs, and one worth taking deliberately rather than as a footnote to a review.
Recorded here and in [merge-request-legibility.md](./merge-request-legibility.md) so it is not
discovered by a reviewer wondering why the images are broken.

## Residual risks accepted, and why

**A credential is readable inside its own sandbox.** Environment injection means any process in the
container can read `GIT_TOKEN`, and the agent running there executes model-authored code. This is
inherent: an agent that must push to a repository must hold something that lets it. What limits the
damage is the scope of what is held — one repository's token, one run's sandbox, destroyed at the
end — and the sandbox's network being off by default while code is written, so a token cannot easily
be sent anywhere.

**`docker inspect` shows the environment.** Anyone with rights on the container host can read every
credential of every running sandbox. This is why the Runner is the *only* component with those
rights (Principle V, research.md D5) and why it is never reachable from the public internet. The
boundary is real but it is a boundary, not an encryption.

**The encryption key is in the environment.** Anyone who can read the application's environment can
decrypt every credential. Moving it to a key management service would be a genuine improvement and
is out of scope for the MVP; `keyRingFromEnv` is the single seam where that change would land, and
`KeyRing` already has the shape for multiple keys.

**A `credentials` row is never deleted when a repository is disconnected.** Worth checking against
data-retention expectations; the ciphertext is inert without the key, so this is a hygiene question
rather than an exposure.

## Verdict

The credential path is soundly built, and the three defects found were all of the same kind:
correct logic with nothing calling it, or a check positioned where it could not fail. None was a
weakness in the cryptography or in the shape of the boundary; all three were about whether the
protection was actually reached — which is exactly what a review of this sort is for and is not
visible from reading the design.

The two residual items are both deployment-level and both now documented for an operator rather
than left to be discovered.
