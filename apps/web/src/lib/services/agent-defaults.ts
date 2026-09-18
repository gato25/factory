import type { Step } from '@factory/shared';

/**
 * The shipped defaults, so a workspace produces a merge request with nothing
 * configured (FR-033). Model identifiers are exact and carry no date suffix.
 * Contracts are those in contracts/step-engines.md.
 */

export interface DefaultAgent {
  slug: string;
  name: string;
  description: string;
  icon: string;
  engine: 'claude_cli' | 'design_cli';
  model: string;
  systemPrompt: string;
  allowedTools: string[];
  outputFiles: string[];
}

const SPEC_PROMPT = `Чи нэг даалгаврын тодорхойлолтыг бичнэ.

Даалгаврын гарчиг, тайлбар, хүлээн авах шалгуурыг унш. \`docs/spec.md\`-д дараахыг
бич: зорилго, юу хамрах хүрээнд байгаа, юу тодорхой хамаарахгүй, хүлээн авах
шалгуурыг өөрийн үгээр дахин найруулсан хэсэг, мөн нээлттэй үлдээхийн оронд
таамаглалаар шийдсэн бүх асуулт.

Баримтыг яг энэ блокоор төгсгө, түүний ард юу ч бүү бич:

\`\`\`factory
has_ui: true | false
rationale: <one sentence>
\`\`\`

\`has_ui\` нь бүтээгдэхүүнийг хэрэглэж буй хүн шинэ буюу өөр зүйл харах бол true,
харин өөрчлөлт нь тэдэнд харагдахгүй бол — миграц, ажлын процесс, дотоод API —
false байна. Үүнийг даалгаврыг үүсгэгчээс хэн ч асуугаагүй: чи шийднэ, мөн
rationale нь чиний хариунаас болж дизайн алхам ажиллах эсвэл алгасах үед тэдний
уншиж харах өгүүлбэр юм.

Өөр юу ч бүү бич. Ажлыг бүү төлөвлө, кодод бүү хүр.`;

const DESIGN_PROMPT = `Чи нэг даалгаврын дэлгэцүүдийг зурна.

\`docs/spec.md\` болон даалгаврын хүлээн авах шалгуурыг унш. Засварлаж болох
дизайны эх файл, мөн дэлгэц тус бүрт нэг экспортлосон зураг гарга. Зөвхөн
даалгаврын хүссэнийг зур; хүлээн авах шалгуурт дурдагдаагүй дэлгэц энд хамаарахгүй.`;

const PLAN_PROMPT = `Чи нэг даалгаврын хөгжүүлэлтийг төлөвлөнө.

\`docs/spec.md\`-ийг, дизайны дэлгэц байвал тэдгээрийг унш. Репозиторийг зөвхөн
уншиж судалж, яг хэрхэн бүтээгдсэнийг мэдэж ав. \`docs/plan.md\`-д дараахыг бич:
арга барил, өөрчлөх файлууд болон яагаад, өгөгдлийн өөрчлөлт, эрсдэлүүд. Дизайн
байгаа бол интерфейсийг түүнд тааруулж барихаар төлөвлө.

Код бүү бич.`;

const TASKS_PROMPT = `Чи нэг төлөвлөгөөг дараалсан даалгавруудад хуваана.

\`docs/spec.md\` болон \`docs/plan.md\`-ийг унш. \`docs/tasks.md\`-д жижиг
даалгавруудын дараалсан жагсаалтыг бич, тус бүрд нь дууссаныг харуулах шалгалтыг
нь хамт бич. Шалгаж болохгүй даалгавар хэтэрхий бүрхэг — хуваах эсвэл шалгалтаа зааж өг.

Код бүү бич.`;

const IMPLEMENT_PROMPT = `Чи нэг даалгаврыг гүйцэтгэнэ.

\`docs/spec.md\`, \`docs/plan.md\`, \`docs/tasks.md\`-ийг, дизайны дэлгэц байвал
тэдгээрийг унш. Даалгавруудыг дарааллаар нь гүйцэтгэж, тус бүрийн дараа
\`feat(#<ticket>): <task>\` хэлбэрийн мессежтэй нэг commit хий.

Энэ алхмын дотор репозиторийн тестийг ажиллаж байхаар үлдээх нь чиний хариуцлага
бөгөөд зөвшөөрөгдсөн хэрэгслүүдээ ашиглана. Энэ репозитори тестээ хэрхэн
ажиллуулдгийг ол — таамагласан команд биш, өөрийнх нь скриптүүдийг — ажиллуулаад
эвдсэнээ зас. Чиний оронд үүнийг хийх юу ч цаана алга: үүний дараа шалгах үе шат
байхгүй бөгөөд тестээ улаан үлдээж дууссан алхам дуусаагүйтэй адил. Дизайн байгаа
бол интерфейсийг түүнд тааруулж бүтээ.`;

export const DEFAULT_AGENTS: DefaultAgent[] = [
  {
    slug: 'spec',
    name: 'Тодорхойлолт агент',
    description: 'Даалгаврыг тодорхой шаардлагын баримт болгоно.',
    icon: 'file-text',
    engine: 'claude_cli',
    model: 'claude-sonnet-5',
    systemPrompt: SPEC_PROMPT,
    allowedTools: ['Read', 'Write'],
    outputFiles: ['docs/spec.md'],
  },
  {
    // Ships as an agent from user story 1 (FR-033). The default pipelines
    // below gain a conditional design step in user story 5, once the
    // orchestrator evaluates conditions (T141) — until then a design step
    // would run on every ticket.
    slug: 'design',
    name: 'Дизайн агент',
    description: 'Код төлөвлөхөөс өмнө дэлгэцүүдийг гаргана.',
    icon: 'palette',
    engine: 'design_cli',
    model: 'pen-default',
    systemPrompt: DESIGN_PROMPT,
    // Tool permissions do not apply to this engine (FR-036a).
    allowedTools: [],
    outputFiles: ['docs/design/ui.pen'],
  },
  {
    slug: 'plan',
    name: 'Төлөвлөгөө агент',
    description: 'Тодорхойлолтыг арга барил болгоно.',
    icon: 'map',
    engine: 'claude_cli',
    model: 'claude-opus-5',
    systemPrompt: PLAN_PROMPT,
    allowedTools: ['Read', 'Write', 'Bash'],
    outputFiles: ['docs/plan.md'],
  },
  {
    slug: 'tasks',
    name: 'Даалгавар агент',
    description: 'Төлөвлөгөөг дараалсан, шалгаж болох даалгаврууд болгоно.',
    icon: 'list-checks',
    engine: 'claude_cli',
    model: 'claude-sonnet-5',
    systemPrompt: TASKS_PROMPT,
    allowedTools: ['Read', 'Write'],
    outputFiles: ['docs/tasks.md'],
  },
  {
    slug: 'implement',
    name: 'Хөгжүүлэлт агент',
    description: 'Код бичиж, тестийг ажиллаж байхаар үлдээнэ.',
    icon: 'code',
    engine: 'claude_cli',
    model: 'claude-opus-5',
    systemPrompt: IMPLEMENT_PROMPT,
    // `Write` as well as `Edit`: this is the agent that creates files, and a
    // ticket on a new or nearly empty repository is all creation. Without it
    // every `Write` was refused — silently, as far as the step was concerned —
    // and the agent either improvised with a shell heredoc or gave up and
    // reported success having produced nothing.
    // No `GitPush`: pushing the branch is the execution service's own step
    // after the pipeline finishes, never a tool an agent calls.
    allowedTools: ['Read', 'Write', 'Edit', 'Bash'],
    outputFiles: [],
  },
];

export function defaultAgent(slug: string): DefaultAgent {
  const found = DEFAULT_AGENTS.find((a) => a.slug === slug);
  if (!found) throw new Error(`no default agent named ${slug}`);
  return found;
}

/** An agent step built from a shipped default. */
export function agentStep(slug: string, extra: Partial<Step> = {}): Step {
  const agent = defaultAgent(slug);
  return {
    type: 'agent',
    condition: 'always',
    agent_id: agent.slug,
    output_files: agent.outputFiles,
    ...extra,
  };
}
