import { describe, expect, test } from 'bun:test';
import type { PipelineSnapshot } from '@factory/shared';
import {
  findOpenMergeRequest,
  type MergeRequestContent,
  OPEN_RETRY_WAITS_MS,
  openMergeRequest,
} from '../../src/orchestrate/merge-request';
import { snapshot as base } from '../fake-host';

/**
 * Opening the merge request is the last step of a run whose every expensive
 * step has already succeeded. A provider that stumbles is asked again, and
 * asked first whether it already has the merge request — so a lost answer
 * never leaves two of them.
 */

const content: MergeRequestContent = {
  title: 'Add Google OAuth sign-in (#142)',
  description: 'The body.',
  labels: ['factory'],
  source_branch: base.repo.branch,
  target_branch: 'main',
};
const OPENED = 'https://gitlab.com/netgroup/shop-frontend/-/merge_requests/7';

/** A provider scripted per request: what each POST answers, and what the listing holds. */
function provider(script: {
  creates: ('unreachable' | 'timeout' | number | 'ok')[];
  listed?: string[];
  listFails?: boolean;
}) {
  const requests: { method: string; url: string; signal: AbortSignal | null | undefined }[] = [];
  let creates = 0;
  const doFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    requests.push({ method, url, signal: init?.signal });
    if (method === 'POST') {
      const answer = script.creates[creates] ?? 'ok';
      creates += 1;
      if (answer === 'unreachable') throw new TypeError('Unable to connect');
      if (answer === 'timeout') {
        const error = new Error('The operation timed out');
        error.name = 'TimeoutError';
        throw error;
      }
      if (typeof answer === 'number') {
        return new Response(JSON.stringify({ message: 'not now' }), { status: answer });
      }
      return Response.json({ web_url: OPENED, html_url: OPENED });
    }
    if (script.listFails) return new Response('boom', { status: 500 });
    return Response.json((script.listed ?? []).map((url) => ({ web_url: url, html_url: url })));
  };
  return { doFetch, requests, posts: () => requests.filter((r) => r.method === 'POST').length };
}

const instant = { sleep: async () => {}, waits: [1, 1, 1] };

describe('opening the merge request', () => {
  test('a provider that stumbles once is asked again, after a look for the request', async () => {
    const p = provider({ creates: [502, 'ok'] });
    const { url } = await openMergeRequest(base, 'glpat-x', content, p.doFetch, instant);
    expect(url).toBe(OPENED);
    expect(p.requests.map((r) => r.method)).toEqual(['POST', 'GET', 'POST']);
    // The look asks for THIS branch's open requests, nothing wider.
    expect(p.requests[1]?.url).toContain(`source_branch=${encodeURIComponent(base.repo.branch)}`);
    expect(p.requests[1]?.url).toContain('state=opened');
  });

  test('a create whose answer was lost is found, not repeated', async () => {
    // The first POST timed out — the provider may well have opened it. The
    // look finds it, and no second one is created.
    const p = provider({ creates: ['timeout', 'ok'], listed: [OPENED] });
    const { url } = await openMergeRequest(base, 'glpat-x', content, p.doFetch, instant);
    expect(url).toBe(OPENED);
    expect(p.posts()).toBe(1);
    expect(p.requests.map((r) => r.method)).toEqual(['POST', 'GET']);
  });

  test('being asked to slow down is not a refusal', async () => {
    const p = provider({ creates: [429, 429, 'ok'] });
    await openMergeRequest(base, 'glpat-x', content, p.doFetch, instant);
    expect(p.posts()).toBe(3);
  });

  test('a refusal is not asked again, because asking would not change it', async () => {
    const p = provider({ creates: [422] });
    // FR-098's sentence is the message; what the provider said is the detail.
    const error = (await openMergeRequest(base, 'glpat-x', content, p.doFetch, instant).catch(
      (e: unknown) => e,
    )) as { message: string; detail?: string };
    expect(error.message).toContain('Your code is safe on the branch');
    expect(error.detail).toMatch(/answered 422/);
    expect(p.requests.map((r) => r.method)).toEqual(['POST']);
  });

  test('a provider that never answers fails the step, saying how often it was asked', async () => {
    const p = provider({ creates: ['unreachable', 'unreachable', 'unreachable', 'unreachable'] });
    const error = (await openMergeRequest(base, 'glpat-x', content, p.doFetch, instant).catch(
      (e: unknown) => e,
    )) as { detail?: string };
    expect(error.detail).toMatch(/could not be reached.*after 4 attempts/);
    expect(p.posts()).toBe(4);
  });

  test('a look that itself fails does not stop the retry', async () => {
    const p = provider({ creates: [503, 'ok'], listFails: true });
    const { url } = await openMergeRequest(base, 'glpat-x', content, p.doFetch, instant);
    expect(url).toBe(OPENED);
    expect(p.posts()).toBe(2);
  });

  test('every request to the provider carries a timeout', async () => {
    const p = provider({ creates: [502, 'ok'] });
    await openMergeRequest(base, 'glpat-x', content, p.doFetch, instant);
    for (const request of p.requests) expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  test('the pauses grow, and are short enough to fit the end of a run', () => {
    expect(OPEN_RETRY_WAITS_MS.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < OPEN_RETRY_WAITS_MS.length; i += 1) {
      expect(OPEN_RETRY_WAITS_MS[i]).toBeGreaterThan(OPEN_RETRY_WAITS_MS[i - 1] ?? 0);
    }
    expect(OPEN_RETRY_WAITS_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(60_000);
  });
});

describe('on GitHub', () => {
  const github: PipelineSnapshot = {
    ...base,
    repo: {
      ...base.repo,
      provider: 'github',
      clone_url: 'https://github.com/netgroup/shop-frontend.git',
    },
  };

  test('the look names the head as owner:branch, and the create the pulls endpoint', async () => {
    const p = provider({ creates: [500, 'ok'] });
    await openMergeRequest(github, 'ghp_x', content, p.doFetch, instant);
    expect(p.requests[0]?.url).toBe('https://api.github.com/repos/netgroup/shop-frontend/pulls');
    expect(p.requests[1]?.url).toContain(
      `head=${encodeURIComponent(`netgroup:${base.repo.branch}`)}`,
    );
    expect(p.requests[1]?.url).toContain('state=open');
  });

  test('an already-open pull request is found by its address field', async () => {
    const p = provider({
      creates: [],
      listed: ['https://github.com/netgroup/shop-frontend/pull/9'],
    });
    expect(await findOpenMergeRequest(github, 'ghp_x', content, p.doFetch)).toBe(
      'https://github.com/netgroup/shop-frontend/pull/9',
    );
  });
});
