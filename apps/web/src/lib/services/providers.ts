import { type FailureReason, invalidInput } from '@factory/shared';

/**
 * Exactly two providers exist in this version (FR-014a). A third value is
 * what FR-014b must refuse, and the refusal must name the host so the person
 * can see why.
 */
export type Provider = 'gitlab' | 'github';

const HOSTS: Record<string, Provider> = {
  'gitlab.com': 'gitlab',
  'www.gitlab.com': 'gitlab',
  'github.com': 'github',
  'www.github.com': 'github',
};

export interface ParsedRepository {
  provider: Provider;
  owner: string;
  name: string;
  fullPath: string;
  cloneUrl: string;
}

/** T051 — refuse anything not hosted on GitLab.com or GitHub.com. */
export function parseRepositoryUrl(input: string): ParsedRepository {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw invalidInput(`"${input}" нь хаяг биш байна. Репозиторийн вэб хаягийг буулгана уу.`);
  }
  const provider = HOSTS[url.hostname.toLowerCase()];
  if (!provider) {
    throw invalidInput(
      `${url.hostname} is not supported. This version connects repositories hosted on ` +
        'gitlab.com or github.com only.',
    );
  }
  const segments = url.pathname
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean);
  if (segments.length < 2) {
    throw invalidInput(
      `"${input}" does not name a repository. Expected a path like owner/repository.`,
    );
  }
  const name = segments[segments.length - 1] as string;
  const owner = segments.slice(0, -1).join('/');
  return {
    provider,
    owner,
    name,
    fullPath: `${owner}/${name}`,
    cloneUrl: `https://${url.hostname}/${owner}/${name}.git`,
  };
}

/**
 * The three capabilities that must hold before a connection is saved
 * (FR-008): read the repository, create branches on it, open merge requests
 * against it. Each is reported separately so a failure can name the missing
 * permission rather than reporting a generic failure (FR-009).
 */
export interface AccessCheck {
  canRead: boolean;
  canCreateBranch: boolean;
  canOpenMergeRequest: boolean;
  defaultBranch?: string;
  /** Why a capability is missing, in the provider's own words. */
  detail?: string;
  /**
   * Set when the provider refused the request outright, instead of answering
   * with a set of permissions that fell short.
   *
   * The difference matters because it changes what there is to do about it.
   * A token that is real but under-scoped needs three permissions granting;
   * a token the provider will not accept at all needs replacing, and being
   * told to go and grant it permissions sends somebody to edit a token that
   * was never the one being checked. Reporting the second as the first is
   * what this field exists to stop — it replaces the list of missing
   * permissions rather than adding to it.
   */
  rejected?: string;
}

export interface ProviderClient {
  readonly provider: Provider;
  checkAccess(repo: ParsedRepository, token: string): Promise<AccessCheck>;
}

/**
 * The three capabilities, as opposed to the rest of `AccessCheck`.
 *
 * Named separately because `PERMISSION_NAMES` below is a name per capability,
 * and typing it over every key of `AccessCheck` meant every new field had to
 * be given an empty string in both providers to keep the compiler quiet.
 */
export type Capability = 'canRead' | 'canCreateBranch' | 'canOpenMergeRequest';

/** The permission each provider calls the capability, for the message in FR-009. */
export const PERMISSION_NAMES: Record<Provider, Record<Capability, string>> = {
  gitlab: {
    canRead: 'read_api (or read_repository)',
    canCreateBranch: 'write_repository',
    canOpenMergeRequest: 'api',
  },
  github: {
    canRead: 'Contents: Read',
    canCreateBranch: 'Contents: Read and write',
    canOpenMergeRequest: 'Pull requests: Read and write',
  },
};

export const REQUIRED_SCOPES: Record<Provider, string[]> = {
  gitlab: ['api', 'read_repository', 'write_repository'],
  github: ['Contents: Read and write', 'Pull requests: Read and write', 'Metadata: Read'],
};

/**
 * Where to go and make the token, with the scopes already chosen.
 *
 * Naming the scopes is necessary and not sufficient: somebody still has to
 * find the right settings page on a provider that has several, and tick boxes
 * that are worded differently from how we word them. Both providers accept the
 * choices as query parameters, so the link does that part.
 *
 * GitLab's page takes the scope names verbatim, so it is generated from
 * `REQUIRED_SCOPES` above rather than repeated — the two cannot drift.
 *
 * GitHub is the awkward one. `REQUIRED_SCOPES.github` describes a FINE-GRAINED
 * token, whose permissions cannot be pre-selected by URL at all; the
 * pre-fillable page is the classic-token one, where the single `repo` scope
 * covers the same ground. So the link goes there, and the text says which is
 * which rather than leaving somebody to discover the mismatch on the page.
 */
export function tokenPageUrl(provider: Provider, host?: string): string {
  const origin = (host ?? DEFAULT_HOSTS[provider]).replace(/\/+$/, '');
  if (provider === 'gitlab') {
    const scopes = REQUIRED_SCOPES.gitlab.join(',');
    return `${origin}/-/user_settings/personal_access_tokens?name=Code+Factory&scopes=${scopes}`;
  }
  return `${origin}/settings/tokens/new?description=Code+Factory&scopes=repo`;
}

/** What each provider's token page says about itself, in its own words. */
export const TOKEN_PAGE_NOTE: Record<Provider, string> = {
  gitlab: 'Нэр, эрхийг нь бөглөсөн хуудас нээнэ — хугацааг нь заагаад үүсгэнэ үү.',
  github:
    '`repo` эрхийг тэмдэглэсэн classic токен нээнэ, энэ нь дээрх гурван эрхийг бүгдийг хамарна. ' +
    'Fine-grained токен ч болно, гэхдээ GitHub түүний эрхийг холбоосоор урьдчилан сонгож чаддаггүй.',
};

const DEFAULT_HOSTS: Record<Provider, string> = {
  gitlab: 'https://gitlab.com',
  github: 'https://github.com',
};

/**
 * What a refusal means, said in terms of the thing to do next.
 *
 * These four are not interchangeable, and the status code is the only place
 * the difference is recorded:
 *
 * - **401** the credential was not accepted at all. Neither provider returns
 *   this for a valid token that merely lacks permissions — that is 403 or
 *   404 — so it means expired, revoked, truncated on the way in, or not a
 *   personal access token in the first place.
 * - **403** the credential is real and was refused anyway: on GitHub usually
 *   a fine-grained token whose organisation has not approved it, or single
 *   sign-on that has not been authorised for it.
 * - **404** either there is no such repository, or there is and this token
 *   cannot see it. GitHub deliberately does not distinguish the two — telling
 *   an unauthorised caller that a private repository exists is itself a leak
 *   — so the message must offer both.
 */
function refusal(provider: Provider, status: number, fullPath: string): string {
  const providerName = provider === 'github' ? 'GitHub' : 'GitLab';
  const tokenName = provider === 'github' ? 'personal access token' : 'project access token';
  switch (status) {
    case 401:
      return (
        `${providerName} did not accept this token (401). A token that is valid but ` +
        'lacks permissions is refused differently, so this one is expired, revoked, ' +
        `incomplete, or not a ${tokenName}. Issue a new one and paste it whole.`
      );
    case 403:
      return (
        `${providerName} accepted the token but refused it for ${fullPath} (403). ` +
        (provider === 'github'
          ? 'A fine-grained token needs the organisation to approve it, and single ' +
            'sign-on needs authorising for the token separately.'
          : 'The token may be expired or the project may be outside its scope.')
      );
    case 404:
      return (
        `${providerName} has no ${fullPath} that this token can see (404). Either the ` +
        'path is wrong, or the repository is private and the token does not cover it — ' +
        'the answer is the same for both, deliberately.'
      );
    default:
      return `${providerName} answered ${status} for ${fullPath}.`;
  }
}

// --- real clients ---

export const gitlabClient: ProviderClient = {
  provider: 'gitlab',
  async checkAccess(repo, token) {
    const id = encodeURIComponent(repo.fullPath);
    const response = await fetch(`https://gitlab.com/api/v4/projects/${id}`, {
      headers: { 'PRIVATE-TOKEN': token },
    });
    if (!response.ok) {
      return {
        canRead: false,
        canCreateBranch: false,
        canOpenMergeRequest: false,
        rejected: refusal('gitlab', response.status, repo.fullPath),
      };
    }
    const project = (await response.json()) as {
      default_branch?: string;
      permissions?: {
        project_access?: { access_level?: number } | null;
        group_access?: { access_level?: number } | null;
      };
    };
    // Developer is 30 — the level at which branches and merge requests are allowed.
    const level = Math.max(
      project.permissions?.project_access?.access_level ?? 0,
      project.permissions?.group_access?.access_level ?? 0,
    );
    return {
      canRead: true,
      canCreateBranch: level >= 30,
      canOpenMergeRequest: level >= 30,
      defaultBranch: project.default_branch,
      detail: level >= 30 ? undefined : `the token's access level on this project is ${level}`,
    };
  },
};

export const githubClient: ProviderClient = {
  provider: 'github',
  async checkAccess(repo, token) {
    const response = await fetch(`https://api.github.com/repos/${repo.fullPath}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) {
      return {
        canRead: false,
        canCreateBranch: false,
        canOpenMergeRequest: false,
        rejected: refusal('github', response.status, repo.fullPath),
      };
    }
    const body = (await response.json()) as {
      default_branch?: string;
      permissions?: { push?: boolean; pull?: boolean };
    };
    const push = body.permissions?.push === true;
    return {
      canRead: body.permissions?.pull !== false,
      canCreateBranch: push,
      canOpenMergeRequest: push,
      defaultBranch: body.default_branch,
      detail: push ? undefined : 'the token cannot push to this repository',
    };
  },
};

export function clientFor(provider: Provider): ProviderClient {
  return provider === 'gitlab' ? gitlabClient : githubClient;
}
