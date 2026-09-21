import { FactoryError, notAuthorised, type Step } from '@factory/shared';
import * as v from 'valibot';
import { command, form, getRequestEvent, query } from '$app/server';
import { db } from '$lib/db';
import { previewRun } from '$lib/services/estimate';
import {
  blankStep,
  createPipeline,
  duplicatePipeline,
  getPipeline,
  insertStep,
  listPipelines,
  moveStep,
  removeStep,
  renamePipeline,
  STEP_KINDS,
  savePipeline,
} from '$lib/services/pipeline';
import { m } from '$lib/i18n';

/**
 * The builder's data. A `query` for one pipeline, a `form` for the save
 * (which carries the whole step list), and `command`s for the controls that
 * rearrange it (contracts/ui-data.md).
 *
 * The controls edit a DRAFT: they return the rearranged list and change
 * nothing stored. A pipeline gains a version when someone saves, not when
 * they drag a step — otherwise dragging four steps would burn four versions
 * and detach four runs' worth of nothing.
 */

function requireUser() {
  const user = getRequestEvent().locals.user;
  if (!user) throw notAuthorised(m.form.signInRequired);
  return user;
}

const PipelineId = v.pipe(v.string(), v.uuid());

export const pipelines = query(async () => {
  requireUser();
  return listPipelines(db());
});

export const pipeline = query(PipelineId, async (id) => {
  const user = requireUser();
  return getPipeline(db(), id, user);
});

/**
 * Steps arrive as JSON because they are a nested list, not a flat set of
 * fields — a form is still the right shape, because saving must not depend
 * on JavaScript any more than approving does.
 */
const SaveSchema = v.object({
  pipelineId: PipelineId,
  name: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1, m.form.pipelineName))),
  description: v.optional(v.string()),
  steps: v.pipe(
    v.string(),
    v.transform((raw) => {
      try {
        return JSON.parse(raw) as Step[];
      } catch {
        return null;
      }
    }),
    v.custom<Step[]>((value) => Array.isArray(value), m.form.stepsUnreadable),
  ),
});

export const save = form(SaveSchema, async (input) => {
  const user = requireUser();
  try {
    const { version, runsUnaffected } = await savePipeline(
      db(),
      {
        pipelineId: input.pipelineId,
        name: input.name,
        description: input.description,
        steps: input.steps,
      },
      user,
    );
    await pipeline(input.pipelineId).refresh();
    await pipelines().refresh();
    return {
      version,
      runsUnaffected,
      message:
        runsUnaffected === 0
          ? `Saved as version ${version}.`
          : runsUnaffected === 1
            ? `Saved as version ${version}. 1 run already in flight continues on the version ` +
              'it started with.'
            : `Saved as version ${version}. ${runsUnaffected} runs already in flight continue ` +
              'on the versions they started with.',
    };
  } catch (error) {
    if (error instanceof FactoryError) return { problem: error.message };
    throw error;
  }
});

/**
 * The draft edits. Each takes the list it is editing and returns the new one,
 * so the screen holds the draft and the server holds the rules.
 */
const Draft = v.object({
  steps: v.array(v.custom<Step>((value) => typeof value === 'object' && value !== null)),
});

export const reorder = command(
  v.object({ ...Draft.entries, from: v.number(), to: v.number() }),
  async ({ steps, from, to }) => {
    requireUser();
    return { steps: moveStep(steps, from, to) };
  },
);

export const insert = command(
  v.object({
    ...Draft.entries,
    at: v.number(),
    kind: v.picklist(STEP_KINDS),
  }),
  async ({ steps, at, kind }) => {
    requireUser();
    return { steps: insertStep(steps, at, blankStep(kind)) };
  },
);

export const remove = command(
  v.object({ ...Draft.entries, at: v.number() }),
  async ({ steps, at }) => {
    requireUser();
    return { steps: removeStep(steps, at) };
  },
);

/**
 * What this pipeline would do if a ticket started on it now: every step with
 * the agent behind it, which steps are conditional and on what, whether
 * anything verifies the result, and an estimate from comparable past runs
 * (FR-019, FR-019a, FR-034a). A dry run — it starts nothing.
 */
export const preflight = query(PipelineId, async (id) => {
  requireUser();
  const detail = await getPipeline(db(), id, getRequestEvent().locals.user);
  return previewRun(db(), id, detail.currentVersion);
});

/** The name on its own — not a new version (FR-027). */
export const rename = command(
  v.object({
    pipelineId: PipelineId,
    name: v.pipe(v.string(), v.trim(), v.minLength(1, m.form.pipelineName)),
  }),
  async ({ pipelineId, name }) => {
    const user = requireUser();
    try {
      const renamed = await renamePipeline(db(), pipelineId, name, user);
      await pipeline(pipelineId).refresh();
      await pipelines().refresh();
      return renamed;
    } catch (error) {
      if (error instanceof FactoryError) return { problem: error.message };
      throw error;
    }
  },
);

export const duplicate = command(PipelineId, async (id) => {
  const user = requireUser();
  try {
    const copy = await duplicatePipeline(db(), id, user);
    await pipelines().refresh();
    return { ...copy, message: `Duplicated as “${copy.name}”.` };
  } catch (error) {
    if (error instanceof FactoryError) return { problem: error.message };
    throw error;
  }
});

const CreateSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, m.form.pipelineName)),
  description: v.optional(v.string(), ''),
});

export const create = form(CreateSchema, async (input) => {
  const user = requireUser();
  try {
    const created = await createPipeline(db(), input, user);
    await pipelines().refresh();
    return { id: created.id };
  } catch (error) {
    if (error instanceof FactoryError) return { problem: error.message };
    throw error;
  }
});
