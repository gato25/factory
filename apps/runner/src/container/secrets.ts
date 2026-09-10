import type { PipelineSnapshot } from '@factory/shared';
import { FactoryError } from '@factory/shared';

/**
 * Credentials arrive as environment variables at container start and are
 * never written into the repository workspace (FR-083, Principle V).
 *
 * The design credential is supplied ONLY to runs whose pipeline contains a
 * design step (FR-083a), and a missing or rejected one fails that step
 * immediately with a message naming where it is configured (FR-083b).
 */

export interface ResolvedCredentials {
  gitToken: string;
  modelKey: string;
  designKey?: string;
}

export function pipelineNeedsDesign(snapshot: PipelineSnapshot): boolean {
  return snapshot.pipeline.steps.some((step) => step.type === 'design');
}

export function buildEnvironment(
  snapshot: PipelineSnapshot,
  credentials: ResolvedCredentials,
): Record<string, string> {
  const env: Record<string, string> = {
    ANTHROPIC_API_KEY: credentials.modelKey,
    GIT_TOKEN: credentials.gitToken,
    // Used by the clone URL rewrite; never persisted to disk.
    GIT_ASKPASS: '/bin/true',
    FACTORY_RUN_ID: snapshot.run_id,
    FACTORY_TICKET: snapshot.ticket.reference,
    FACTORY_BRANCH: snapshot.repo.branch,
  };

  if (pipelineNeedsDesign(snapshot)) {
    if (!credentials.designKey) {
      // Detected at container start, not at the design step (FR-083b).
      throw new FactoryError(
        'credential_missing',
        'This pipeline contains a design step, but no design service credential is ' +
          'configured. Add one under Settings → Design.',
      );
    }
    env.PEN_API_KEY = credentials.designKey;
  }
  return env;
}

/** Every secret value in play, for the redactor (Principle V). */
export function secretValues(credentials: ResolvedCredentials): string[] {
  return [credentials.gitToken, credentials.modelKey, credentials.designKey].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}
