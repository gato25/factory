import type { Database } from '@factory/db';
import { artifacts, runs, stepResults, tickets } from '@factory/db/schema';
import { type FailureReason, notFound, type PipelineSnapshot } from '@factory/shared';
import { desc, eq, sql } from 'drizzle-orm';

/**
 * What a person is shown when a run fails: which step, why, and what to do
 * about it — in language that does not require reading raw output
 * (FR-087, SC-008). The raw output stays one click away; it is never the
 * first thing a person has to read.
 */

export interface Failure {
  stepIndex: number | null;
  /** The step's own name, not its index. */
  stepLabel: string | null;
  /** One sentence saying what went wrong. */
  what: string;
  /** One sentence saying what to do about it. */
  next: string;
  /** True when retrying alone is unlikely to help. */
  needsAChange: boolean;
  /** The engine's own words, for whoever wants them. */
  detail: string | null;
  /** What the run consumed before it stopped. */
  spentUsd: string;
  ceilingUsd: string;
  /** The documents the failed attempt did produce, which a retry can build on. */
  produced: { path: string; version: number }[];
  attempt: number;
  /** False for a run that failed at a step, true for one stopped by us. */
  stoppedByACeiling: boolean;
}

/**
 * A reason maps to a sentence and a next step. This is the whole vocabulary:
 * anything not in it falls back to the step's own error, which is why the
 * fallback says what it can rather than pretending to diagnose.
 */
const EXPLANATIONS: Record<FailureReason, { what: string; next: string; needsAChange: boolean }> = {
  missing_output: {
    what: 'Алхам бичих ёстой байсан баримтаа гаргалгүй дуусчээ.',
    next: 'Ихэвчлэн даалгавар агентад ажиллах хангалттай мэдээлэл өгөөгүй байдаг. Тайлбар эсвэл хүлээн авах шалгуураа дэлгэрүүлээд дахин оролдоно уу.',
    needsAChange: true,
  },
  budget_exceeded: {
    what: 'Ажиллагаа зарцуулж болох дээд хэмжээндээ хүрлээ.',
    next: 'Даалгавар хязгаараас том байна, эсвэл нарийсгах хэрэгтэй. Хуваах эсвэл дамжлагын хязгаарыг нэмэгдүүлнэ үү.',
    needsAChange: true,
  },
  time_exceeded: {
    what: 'Ажиллагаа зөвшөөрөгдсөн дээд хугацаандаа хүрлээ.',
    next: 'Даалгавраа нарийсгах эсвэл дамжлагын хугацааны хязгаарыг нэмэгдүүлнэ үү.',
    needsAChange: true,
  },
  engine_unavailable: {
    what: 'Загвар руу холбогдож чадсангүй.',
    next: 'Даалгаварт буруу зүйл алга. Дахин оролдоно уу.',
    needsAChange: false,
  },
  credential_invalid: {
    what: 'Хадгалагдсан нууц түлхүүрийг татгалзлаа.',
    next: 'Дахин оролдлого цааш явахын өмнө администратор Тохиргоо хэсэгт түүнийг солих хэрэгтэй.',
    needsAChange: true,
  },
  credential_missing: {
    what: 'Энэ дамжлагад хэрэгтэй нууц түлхүүр тохируулагдаагүй байна.',
    next: 'Дахин оролдлого цааш явахын өмнө администратор Тохиргоо хэсэгт түүнийг нэмэх хэрэгтэй.',
    needsAChange: true,
  },
  sandbox_lost: {
    what: 'Алхмын ажиллаж байсан орчин алга болж, хоёр дахь оролдлого ч цааш яваагүй.',
    next: 'Даалгаварт буруу зүйл алга. Дахин оролдоно уу.',
    needsAChange: false,
  },
  app_unreachable: {
    what: 'Гүйцэтгэх үйлчилгээ ажиллагаанд хэрэгтэй зүйлийг авахаар энэ аппликэйшн руу хүрч чадсангүй.',
    next: 'Даалгаварт буруу зүйл алга. Гүйцэтгэх үйлчилгээ PUBLIC_BASE_URL дэх хаяг руу хүрч чадаж байгааг шалгаад дахин оролдоно уу.',
    needsAChange: false,
  },
  runner_unreachable: {
    what: 'Энэ аппликэйшн гүйцэтгэх үйлчилгээ рүү хүрч чадсангүй.',
    next: 'Даалгаварт буруу зүйл алга. Тохиргоо дахь ажиллуулагчийн хаягийг болон ажиллуулагч ажиллаж байгааг шалгаад дахин оролдоно уу.',
    needsAChange: false,
  },
  command_failed: {
    what: 'Дамжлагын ажиллуулсан команд алдаатай дуусчээ.',
    next: 'Аль команд, яагаад болохыг алхмын гаралтаас уншина уу. Хэрэв репозиторийн буруу бол эхлээд түүнийг зас.',
    needsAChange: true,
  },
  not_authorised: {
    what: 'Ажиллагаанд хэрэгтэй байсан зүйл рүү хандах эрхийг татгалзлаа.',
    next: 'Нууц түлхүүр репозиторийн шаардах эрхүүдтэй эсэхийг шалгана уу.',
    needsAChange: true,
  },
  conflict: {
    what: 'Ажиллагааны доор ямар нэг зүйл өөрчлөгджээ.',
    next: 'Дахин оролдоно уу — ажиллагаа шинээр харна.',
    needsAChange: false,
  },
  not_found: {
    what: 'Ажиллагааны байх ёстой гэж үзсэн зүйл байсангүй.',
    next: 'Репозитори, салбар байсаар байгаа эсэхийг шалгаад дахин оролдоно уу.',
    needsAChange: true,
  },
  invalid_input: {
    what: 'Ажиллагаанд ашиглах боломжгүй зүйл өглөө.',
    next: 'Доорх дэлгэрэнгүйг уншиж, даалгавраа зассаны дараа дахин оролдоно уу.',
    needsAChange: true,
  },
};

/** Recognises a stored reason string, whether a code or a sentence we wrote. */
export function explain(reason: string | null): {
  what: string;
  next: string;
  needsAChange: boolean;
} {
  if (!reason) {
    return {
      what: 'Ажиллагаа шалтгаанаа тэмдэглэлгүй зогсчээ.',
      next: 'Дахин оролдоно уу. Мөн адил зогсвол алхмын гаралтаас өөр харах газар үлдэхгүй.',
      needsAChange: false,
    };
  }
  const known = EXPLANATIONS[reason as FailureReason];
  if (known) return known;

  // A ceiling reached is reported as a sentence rather than a code by both
  // the orchestrator and the ledger; recognise it either way.
  if (/cost ceiling|ceiling of \$|budget/i.test(reason)) {
    return EXPLANATIONS.budget_exceeded;
  }
  if (/time ceiling|minutes/i.test(reason)) return EXPLANATIONS.time_exceeded;
  if (/checkpoint within/i.test(reason)) {
    return {
      what: 'Хяналтын цэгийн хугацаа дуусахаас өмнө хэн ч шийдээгүй бөгөөд цэг нь амжилтгүй болохоор тохируулагдсан байжээ.',
      next: 'Дахин оролдоод энэ удаад хяналтын цэгийг шийднэ үү — эсвэл хугацаагүй хүлээхээр өөрчилнө үү.',
      needsAChange: false,
    };
  }

  // Our own sentence, already written for a person. Say it as it stands
  // rather than wrapping it in a worse one.
  return {
    what: reason.charAt(0).toUpperCase() + reason.slice(1),
    next: 'Дахин оролдоно уу, эсвэл шалтгаан нь даалгаврыг заасан бол эхлээд даалгавраа зас.',
    needsAChange: false,
  };
}

export async function failureOf(database: Database, runId: string): Promise<Failure | null> {
  const [run] = await database.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw notFound('тийм ажиллагаа алга');
  if (run.status !== 'failed' && run.status !== 'cancelled') return null;

  const snapshot = run.snapshot as PipelineSnapshot;
  const stepIndex = run.failureStepIndex ?? run.currentStepIndex ?? null;
  const definition = stepIndex === null ? undefined : snapshot.pipeline.steps[stepIndex];
  const stepLabel = definition
    ? (snapshot.agents.find((a) => a.id === definition.agent_id)?.name ?? definition.type)
    : null;

  const [failedStep] =
    stepIndex === null
      ? []
      : await database
          .select({ errorDetail: stepResults.errorDetail })
          .from(stepResults)
          .where(
            sql`${stepResults.runId} = ${runId}::uuid and ${stepResults.stepIndex} = ${stepIndex}`,
          )
          .limit(1);

  const explanation = explain(run.failureReason);
  const produced = await database
    .select({ path: artifacts.path, version: artifacts.version })
    .from(artifacts)
    .where(eq(artifacts.runId, runId))
    .orderBy(artifacts.path, desc(artifacts.version));
  const latest = new Map<string, number>();
  for (const row of produced) if (!latest.has(row.path)) latest.set(row.path, row.version);

  return {
    stepIndex,
    stepLabel,
    what:
      run.status === 'cancelled'
        ? 'The run was cancelled. The branch it had pushed is still there.'
        : explanation.what,
    next: run.status === 'cancelled' ? 'Retry when you want it to carry on.' : explanation.next,
    needsAChange: run.status === 'cancelled' ? false : explanation.needsAChange,
    detail: failedStep?.errorDetail ?? null,
    spentUsd: run.costUsd,
    ceilingUsd: run.costCeilingUsd,
    produced: [...latest.entries()].map(([path, version]) => ({ path, version })),
    attempt: run.attempt,
    stoppedByACeiling:
      explanation === EXPLANATIONS.budget_exceeded || explanation === EXPLANATIONS.time_exceeded,
  };
}

/** Every attempt on a ticket, so a previous one stays readable (FR-090). */
export async function attemptsOf(database: Database, ticketId: string) {
  const [ticket] = await database
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!ticket) throw notFound('тийм даалгавар алга');

  const rows = await database
    .select({
      id: runs.id,
      attempt: runs.attempt,
      status: runs.status,
      costUsd: runs.costUsd,
      failureReason: runs.failureReason,
      failureStepIndex: runs.failureStepIndex,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
    })
    .from(runs)
    .where(eq(runs.ticketId, ticketId))
    .orderBy(desc(runs.attempt));

  return rows.map((row) => ({
    ...row,
    // A previous attempt is summarised in the same language as a current one.
    what: row.failureReason ? explain(row.failureReason).what : null,
  }));
}
