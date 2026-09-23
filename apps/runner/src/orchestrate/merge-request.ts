import type { PipelineSnapshot } from '@factory/shared';
import { pushedWithoutMergeRequest } from '../container/push';
import { reachSignal } from '../container/reach';
import { log } from '../errors';

/**
 * Opening the merge request, at the end of a run (FR-065).
 *
 * The body is composed by the application, not here: it needs the ticket's
 * description and criteria, the specification and plan the agents wrote, the
 * screens' addresses and what the run cost, and only the application has
 * those (SC-014). This fetches that body — authenticated with the run's own
 * secret, as every call to the application is — and hands it to the provider
 * in the shape the provider expects.
 *
 * Opening, never merging: merging is a human act on the provider (FR-070).
 */

export interface MergeRequestContent {
  title: string;
  description: string;
  labels?: string[];
  source_branch: string;
  target_branch: string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The application's composed body for this run's merge request. */
export async function composeMergeRequest(
  snapshot: PipelineSnapshot,
  doFetch: Fetch = fetch,
): Promise<MergeRequestContent> {
  const url = snapshot.callback_url.replace(
    /\/api\/hooks\/[^/]+$/,
    `/api/runs/${snapshot.run_id}/merge-request`,
  );
  let response: Response;
  try {
    response = await doFetch(url, {
      headers: { authorization: `Bearer ${snapshot.resume_secret}` },
      signal: reachSignal(),
    });
  } catch (error) {
    throw pushedWithoutMergeRequest(
      `the application could not be reached for the merge request body: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!response.ok) {
    throw pushedWithoutMergeRequest(
      `the application answered ${response.status} for the merge request body`,
    );
  }
  const body = (await response.json()) as Partial<MergeRequestContent>;
  if (!body.title || !body.source_branch || !body.target_branch) {
    throw pushedWithoutMergeRequest('the application returned no usable merge request body');
  }
  return {
    title: body.title,
    description: body.description ?? '',
    labels: body.labels,
    source_branch: body.source_branch,
    target_branch: body.target_branch,
  };
}

/**
 * `https://gitlab.com/group/sub/project.git` → `group/sub/project`. The
 * snapshot carries the clone address and nothing else about the project, and
 * both providers key their API on this path.
 */
export function projectPath(cloneUrl: string): string {
  const url = new URL(cloneUrl);
  return url.pathname.replace(/^\/+/, '').replace(/\.git$/, '');
}

/**
 * How a provider is asked, per provider: where, with which header, in what
 * shape, and which field of the answer is the merge request's address.
 */
interface ProviderRequest {
  /** Where a merge request is created. */
  createUrl: string;
  /** Where the open merge requests for this branch are listed. */
  listUrl: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  urlField: string;
}

function providerRequest(
  snapshot: PipelineSnapshot,
  gitToken: string,
  content: MergeRequestContent,
): ProviderRequest {
  const path = projectPath(snapshot.repo.clone_url);
  if (snapshot.repo.provider === 'gitlab') {
    const project = `${new URL(snapshot.repo.clone_url).origin}/api/v4/projects/${encodeURIComponent(path)}`;
    const query = new URLSearchParams({
      source_branch: content.source_branch,
      target_branch: content.target_branch,
      state: 'opened',
    });
    return {
      createUrl: `${project}/merge_requests`,
      listUrl: `${project}/merge_requests?${query}`,
      headers: { 'PRIVATE-TOKEN': gitToken },
      body: {
        source_branch: content.source_branch,
        target_branch: content.target_branch,
        title: content.title,
        description: content.description,
        ...(content.labels?.length ? { labels: content.labels.join(',') } : {}),
      },
      urlField: 'web_url',
    };
  }
  // GitHub names a head as `owner:branch`; the owner is the first segment of
  // the repository path.
  const owner = path.split('/')[0] ?? '';
  const query = new URLSearchParams({
    head: `${owner}:${content.source_branch}`,
    base: content.target_branch,
    state: 'open',
  });
  return {
    createUrl: `https://api.github.com/repos/${path}/pulls`,
    listUrl: `https://api.github.com/repos/${path}/pulls?${query}`,
    headers: {
      authorization: `Bearer ${gitToken}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'code-factory',
    },
    body: {
      head: content.source_branch,
      base: content.target_branch,
      title: content.title,
      body: content.description,
    },
    urlField: 'html_url',
  };
}

/**
 * The address of a merge request already open for this run's branch, if the
 * provider has one, or null.
 *
 * Asked before a create is retried, never instead of one: a create whose
 * answer was lost — a timeout, a reset after the request was sent — may
 * well have opened the merge request, and opening it again would leave two.
 * A lookup that itself fails answers null, and the caller creates: a
 * duplicate is a nuisance a person can close; a run that never opens its
 * merge request is the failure FR-098 is about.
 */
export async function findOpenMergeRequest(
  snapshot: PipelineSnapshot,
  gitToken: string,
  content: MergeRequestContent,
  doFetch: Fetch = fetch,
): Promise<string | null> {
  const request = providerRequest(snapshot, gitToken, content);
  try {
    const response = await doFetch(request.listUrl, {
      headers: request.headers,
      signal: reachSignal(),
    });
    if (!response.ok) return null;
    const listed = (await response.json()) as unknown;
    if (!Array.isArray(listed)) return null;
    for (const entry of listed) {
      const url = (entry as Record<string, unknown>)[request.urlField];
      if (typeof url === 'string' && url) return url;
    }
    return null;
  } catch {
    return null;
  }
}

/** The pauses before each retry of the create, in order; one attempt more than there are pauses. */
export const OPEN_RETRY_WAITS_MS: readonly number[] = [2_000, 5_000, 10_000];

export interface OpenOptions {
  sleep?: (ms: number) => Promise<void>;
  waits?: readonly number[];
}

/** What one attempt to create came to. */
type Attempt =
  | { kind: 'opened'; url: string }
  | { kind: 'refused'; detail: string }
  | { kind: 'again'; detail: string };

/**
 * Opens the merge request on the run's provider and returns its address.
 *
 * GitLab takes `PRIVATE-TOKEN`; GitHub a bearer token. A refusal is
 * FR-098's case: the branch is pushed and the code is safe, and the failure
 * says so rather than reading as a lost run.
 *
 * A provider that cannot be reached, or answers 5xx or 429, is asked again
 * — a few times, with growing pauses — because this is the LAST step of a
 * run whose every expensive step has already succeeded, and a transient
 * fault here used to fail the whole run and leave a person to open the
 * merge request by hand. Before each retry the provider is asked whether it
 * already has one for the branch (`findOpenMergeRequest`), so a create whose
 * answer was lost is found rather than repeated. A 4xx that is not 429 is a
 * refusal, and asking again would not change it.
 */
export async function openMergeRequest(
  snapshot: PipelineSnapshot,
  gitToken: string,
  content: MergeRequestContent,
  doFetch: Fetch = fetch,
  options: OpenOptions = {},
): Promise<{ url: string }> {
  const request = providerRequest(snapshot, gitToken, content);
  const waits = options.waits ?? OPEN_RETRY_WAITS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const provider = snapshot.repo.provider;

  let lastDetail = '';
  for (let attempt = 0; ; attempt += 1) {
    const outcome = await tryCreate(request, provider, doFetch);
    if (outcome.kind === 'opened') return { url: outcome.url };
    if (outcome.kind === 'refused') throw pushedWithoutMergeRequest(outcome.detail);
    lastDetail = outcome.detail;
    if (attempt >= waits.length) break;

    const pause = waits[attempt] ?? 0;
    log.warn('the provider did not open the merge request; it will be asked again', {
      run_id: snapshot.run_id,
      provider,
      attempt: attempt + 1,
      detail: lastDetail,
      next_attempt_in_ms: pause,
    });
    await sleep(pause);
    // The failed attempt may have succeeded on the provider's side.
    const existing = await findOpenMergeRequest(snapshot, gitToken, content, doFetch);
    if (existing) {
      log.info('the merge request was already open; not opening a second one', {
        run_id: snapshot.run_id,
        provider,
        url: existing,
      });
      return { url: existing };
    }
  }
  throw pushedWithoutMergeRequest(`${lastDetail} (after ${waits.length + 1} attempts)`);
}

async function tryCreate(
  request: ProviderRequest,
  provider: string,
  doFetch: Fetch,
): Promise<Attempt> {
  let response: Response;
  try {
    response = await doFetch(request.createUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...request.headers },
      body: JSON.stringify(request.body),
      signal: reachSignal(),
    });
  } catch (error) {
    return {
      kind: 'again',
      detail: `${provider} could not be reached: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  const text = await response.text();
  if (!response.ok) {
    const detail = `${provider} answered ${response.status}: ${text.slice(0, 500)}`;
    const transient = response.status >= 500 || response.status === 429 || response.status === 408;
    return transient ? { kind: 'again', detail } : { kind: 'refused', detail };
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Handled below: an answer with no address in it.
  }
  const url = parsed[request.urlField];
  if (typeof url !== 'string' || !url) {
    return { kind: 'refused', detail: `${provider} answered without a merge request address` };
  }
  return { kind: 'opened', url };
}
