import { FactoryError, notAuthorised } from '@factory/shared';
import * as v from 'valibot';
import { command, form, getRequestEvent, query } from '$app/server';
import { db } from '$lib/db';
import {
  createSkill,
  deleteSkill,
  getSkill,
  listSkills,
  skillHistory,
  updateSkill,
} from '$lib/services/skill';

/**
 * Skills — named instruction documents attachable to any number of agents
 * (FR-042). Same ownership rule as everything else: anyone may read and use
 * one, only the owner or an administrator may change it.
 */

function requireUser() {
  const user = getRequestEvent().locals.user;
  if (!user) throw notAuthorised('та нэвтэрсэн байх ёстой');
  return user;
}

const SkillId = v.pipe(v.string(), v.uuid());

async function attempt<T extends object>(work: () => Promise<T>): Promise<T | { problem: string }> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FactoryError) return { problem: error.message };
    throw error;
  }
}

export const skills = query(async () => {
  const user = requireUser();
  return listSkills(db(), user);
});

export const skill = query(SkillId, async (id) => {
  const user = requireUser();
  return getSkill(db(), id, user);
});

/**
 * What the skill has said, newest first. Readable by anyone who may read the
 * skill: a run that behaved oddly is explained by what the skill said then,
 * regardless of who owns it now (FR-043b).
 */
export const history = query(SkillId, async (id) => {
  requireUser();
  return skillHistory(db(), id);
});

/**
 * The description is required, not optional: it is the sentence an agent
 * reads to decide whether to reach for the skill (FR-043).
 */
const Fields = {
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Ур чадварт нэр өгнө үү.')),
  description: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1, 'Агент энэ ур чадварыг хэзээ ашиглахыг бичнэ үү.'),
  ),
  content: v.pipe(v.string(), v.minLength(1, 'A skill needs content to apply.')),
};

export const create = form(v.object(Fields), async (input) => {
  const user = requireUser();
  return attempt(async () => {
    const created = await createSkill(db(), input, user);
    await skills().refresh();
    return { id: created.id, message: `“${input.name}” is ready to attach to an agent.` };
  });
});

export const save = form(v.object({ skillId: SkillId, ...Fields }), async (input) => {
  const user = requireUser();
  return attempt(async () => {
    const { reaches, version } = await updateSkill(
      db(),
      input.skillId,
      { name: input.name, description: input.description, content: input.content },
      user,
    );
    await skill(input.skillId).refresh();
    await history(input.skillId).refresh();
    await skills().refresh();
    return {
      message:
        `${version}-р хувилбар болгон хадгаллаа. ` +
        (reaches.length === 0
          ? 'Хараахан энэ ур чадварыг эзэмшсэн агент алга.'
          : `${reaches.map((a) => a.name).join(', ')} дараагийн ажиллагаанаасаа эхлэн ` +
            'үүнийг ашиглана; явж байгаа ажиллагаанууд хэвээрээ.'),
    };
  });
});

export const remove = command(SkillId, async (id) => {
  const user = requireUser();
  return attempt(async () => {
    const { detachedFrom } = await deleteSkill(db(), id, user);
    await skills().refresh();
    return {
      message:
        detachedFrom.length === 0
          ? 'Устгагдлаа.'
          : `Устгагдаж, ${detachedFrom.map((a) => a.name).join(', ')}-аас хасагдлаа.`,
    };
  });
});
