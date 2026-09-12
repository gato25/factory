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
    throw invalidInput(`"${input}" is not a URL. Paste the repository's web address.`);
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
}

export interface ProviderClient {
  readonly provider: Provider;
  checkAccess(repo: ParsedRepository, token: string): Promise<AccessCheck>;
}

/** The permission each provider calls the capability, for the message in FR-009. */
export const PERMISSION_NAMES: Record<Provider, Record<keyof AccessCheck & string, string>> = {
  gitlab: {
    canRead: 'read_api (or read_repository)',
    canCreateBranch: 'write_repository',
    canOpenMergeRequest: 'api',
    defaultBranch: '',
    detail: '',
  },
  github: {
    canRead: 'Contents: Read',
    canCreateBranch: 'Contents: Read and write',
    canOpenMergeRequest: 'Pull requests: Read and write',
    defaultBranch: '',
    detail: '',
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
  gitlab: 'Opens with the name and scopes already filled in — set an expiry and create it.',
  github:
    'Opens a classic token with `repo` ticked, which covers all three permissions above. ' +
    'A fine-grained token works too, but GitHub cannot pre-select its permissions from a link.',
};

const DEFAULT_HOSTS: Record<Provider, string> = {
  gitlab: 'https://gitlab.com',
  github: 'https://github.com',
};

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
        detail: `GitLab answered ${response.status} for ${repo.fullPath}`,
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
        detail: `GitHub answered ${response.status} for ${repo.fullPath}`,
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
