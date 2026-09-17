import type { PipelineSnapshot } from '@factory/shared';
import { pushedWithoutMergeRequest } from '../container/push';

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
 * Opens the merge request on the run's provider and returns its address.
 *
 * GitLab takes `PRIVATE-TOKEN`; GitHub a bearer token. A refusal is
 * FR-098's case: the branch is pushed and the code is safe, and the failure
 * says so rather than reading as a lost run.
 */
export async function openMergeRequest(
  snapshot: PipelineSnapshot,
  gitToken: string,
  content: MergeRequestContent,
  doFetch: Fetch = fetch,
): Promise<{ url: string }> {
  const path = projectPath(snapshot.repo.clone_url);
  const request =
    snapshot.repo.provider === 'gitlab'
      ? {
          url: `${new URL(snapshot.repo.clone_url).origin}/api/v4/projects/${encodeURIComponent(path)}/merge_requests`,
          headers: { 'PRIVATE-TOKEN': gitToken } as Record<string, string>,
          body: {
            source_branch: content.source_branch,
            target_branch: content.target_branch,
            title: content.title,
            description: content.description,
            ...(content.labels?.length ? { labels: content.labels.join(',') } : {}),
          },
          urlField: 'web_url',
        }
      : {
          url: `https://api.github.com/repos/${path}/pulls`,
          headers: {
            authorization: `Bearer ${gitToken}`,
            accept: 'application/vnd.github+json',
            'user-agent': 'code-factory',
          } as Record<string, string>,
          body: {
            head: content.source_branch,
            base: content.target_branch,
            title: content.title,
            body: content.description,
          },
          urlField: 'html_url',
        };

  let response: Response;
  try {
    response = await doFetch(request.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...request.headers },
      body: JSON.stringify(request.body),
    });
  } catch (error) {
    throw pushedWithoutMergeRequest(
      `${snapshot.repo.provider} could not be reached: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const text = await response.text();
  if (!response.ok) {
    throw pushedWithoutMergeRequest(
      `${snapshot.repo.provider} answered ${response.status}: ${text.slice(0, 500)}`,
    );
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Handled below: an answer with no address in it.
  }
  const url = parsed[request.urlField];
  if (typeof url !== 'string' || !url) {
    throw pushedWithoutMergeRequest(
      `${snapshot.repo.provider} answered without a merge request address`,
    );
  }
  return { url };
}
