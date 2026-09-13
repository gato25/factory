import {
  createLogger,
  FactoryError,
  type PipelineSnapshot,
  REQUIREMENTS_DIR,
  safeFileName,
} from '@factory/shared';
import type { ContainerHost } from './host';

const log = createLogger('runner');

/**
 * The requirement documents a person attached to the ticket, put into the
 * sandbox where every step can read them.
 *
 * A ticket's own fields are what somebody retyped; these are the brief as it
 * already existed. They are written once, at start, into
 * `.factory/requirements/`, beside the ticket and feedback files that are
 * already there — so a step reads them the same way it reads anything else,
 * with no new mechanism and no prompt variable it has to remember to mention.
 *
 * FETCHED rather than carried in the snapshot. The snapshot holds a manifest
 * of names and sizes only: it is held for the life of a run, passed through
 * the orchestration service, and stored again on every step — so several
 * megabytes of requirements inside it would be copied at every one of those
 * points for content that is needed exactly once. This mirrors how credentials
 * already reach the Runner — from the application, authenticated with the
 * run's own secret, never through the orchestration service.
 */

export interface RequirementFile {
  name: string;
  content: string;
}

/** Where the application serves a run's requirement documents. */
function requirementsUrl(snapshot: PipelineSnapshot): string {
  return snapshot.callback_url.replace(
    /\/api\/hooks\/n8n$/,
    `/api/runs/${snapshot.run_id}/requirements`,
  );
}

/** Only the origin, so naming the address in an error cannot leak the secret. */
function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'the application';
  }
}

/**
 * Collects the documents from the application.
 *
 * Returns nothing when the ticket has none, WITHOUT asking: the manifest in
 * the snapshot already says so, and a run whose ticket carries no documents
 * should not depend on the application being reachable at all.
 */
export async function fetchRequirementFiles(
  snapshot: PipelineSnapshot,
  doFetch: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<RequirementFile[]> {
  if (!snapshot.ticket.requirement_files?.length) return [];

  const url = requirementsUrl(snapshot);
  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${snapshot.resume_secret}`,
      },
    });
  } catch (error) {
    // Named the same way the credentials fetch names it, and for the same
    // reason: since the execution service moved off the application's
    // machine, "could not get the requirements" could be a misconfigured
    // address, a firewall, or an application that is down, and an operator
    // cannot tell those apart without the address.
    throw new FactoryError(
      'app_unreachable',
      `could not reach the application at ${safeOrigin(url)} for this ticket's requirement documents`,
      { detail: error instanceof Error ? error.message : String(error) },
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new FactoryError(
      response.status === 401 ? 'not_authorised' : 'app_unreachable',
      body.error ?? `the app answered ${response.status} for this ticket's requirement documents`,
    );
  }

  const body = (await response.json()) as { files?: RequirementFile[] };
  const files = (body.files ?? []).filter((file) => file?.name && typeof file.content === 'string');

  // The run was told to expect documents and none came back. Continuing
  // silently would hand an agent a ticket whose brief is missing and let it
  // invent one, which is the failure this whole feature exists to prevent —
  // and it would look, from the output, like a run that simply went wrong.
  if (files.length === 0) {
    throw new FactoryError(
      'invalid_input',
      `this ticket lists ${snapshot.ticket.requirement_files.length} requirement document(s), but the application returned none`,
    );
  }
  return files;
}

/**
 * Writes them into the sandbox, with an index naming each one.
 *
 * The index exists because a step's prompt is written by whoever configured
 * the agent, and it may never mention requirements at all. A file the agent is
 * not told about is a file it does not read, so the names are stated in a
 * place it already looks — the same reasoning that puts `screens.md` and
 * `feedback.md` there.
 */
export async function writeRequirementFiles(
  host: ContainerHost,
  containerId: string,
  workdir: string,
  files: RequirementFile[],
): Promise<string[]> {
  if (files.length === 0) return [];

  const directory = `${workdir}/${REQUIREMENTS_DIR}`;
  await host.exec(containerId, ['mkdir', '-p', directory]);

  const written: string[] = [];
  for (const file of files) {
    // Made safe again here rather than trusted from the application. The name
    // becomes a path, this service is the thing holding rights on a container
    // host, and a boundary that trusts its caller is not one.
    const name = safeFileName(file.name);
    await host.writeFile(containerId, `${directory}/${name}`, file.content);
    written.push(name);
  }

  await host.writeFile(
    containerId,
    `${workdir}/.factory/requirements.md`,
    `# Requirement documents\n\n` +
      `These were supplied with the ticket. They are the requirements themselves, ` +
      `not a summary of them — read them before deciding what to build, and treat ` +
      `them as taking precedence over any assumption you would otherwise make.\n\n` +
      `${written.map((name) => `- ${REQUIREMENTS_DIR}/${name}`).join('\n')}\n`,
  );

  log.info('requirement documents written into the sandbox', {
    container_id: containerId,
    count: written.length,
  });
  return written;
}
