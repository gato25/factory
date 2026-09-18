/**
 * What each screen takes from `design.pen`, named.
 *
 * A screen built from an artboard and then left alone drifts: somebody
 * rewords a button, somebody else redraws the artboard, and nothing says so.
 * This is the list that binds the two together. `takes` are phrases that
 * must be in BOTH the artboard and the screen's source; `omits` are phrases
 * that must be in the artboard and NOT in the source, each with the reason
 * it was left out.
 *
 * The phrases are the fixed copy — headings, labels, button text, the
 * sentences that explain a thing. Never the artboard's sample data: "Add
 * OAuth login with Google" is a ticket somebody invented for a picture, and
 * a screen that contained it would be wrong, not right.
 *
 * An omission that stops being true is as much a failure as a label that
 * drifts: if the artboard loses "Self-hosted Git", the note explaining why
 * we do not offer it is stale, and the check says so.
 */

export interface Screen {
  artboard: string;
  files: string[];
  takes: string[];
  omits?: { label: string; why: string }[];
}

const APP = 'apps/web/src/routes/(app)';
const UI = 'apps/web/src/components';

export const SCREENS: Screen[] = [
  {
    artboard: '00 Login',
    files: ['apps/web/src/routes/login/+page.svelte'],
    takes: [
      'Code Factory',
      'Нэвтрэх',
      'ээр үргэлжлүүлэх',
      'GitLab',
      'GitHub',
      'Нууц үг',
      'Даалгавар',
      'Тодорхойлолт',
      'Төлөвлөгөө',
      'Даалгаврууд',
      'Хөгжүүлэлт',
    ],
  },
  {
    // The frame every screen sits in: the sidebar and the top bar.
    artboard: '01 Dashboard',
    files: [`${APP}/+layout.svelte`],
    takes: [
      'Code Factory',
      'Хяналтын самбар',
      'Репозитори',
      'Даалгавар',
      'Дамжлага',
      'Агент',
      'Ур чадвар',
      'Тохиргоо',
      'Даалгавар, репозитори хайх',
      'Шинэ даалгавар',
    ],
  },
  {
    artboard: '01 Dashboard',
    files: [
      `${APP}/+page.svelte`,
      `${UI}/StatTile.svelte`,
      `${UI}/ActiveRuns.svelte`,
      `${UI}/ActivityFeed.svelte`,
      `${UI}/ApprovalPanel.svelte`,
    ],
    takes: [
      'Холбогдсон репозитори',
      'Ажиллаж буй даалгавар',
      'Баталгаажуулалт хүлээж буй',
      'Долоо хоногийн нэгтгэлт',
      'Идэвхтэй ажиллагаа',
      'Бүх даалгавар',
      'Таны баталгаажуулалт',
      'Сүүлийн үйл ажиллагаа',
      'Хянах',
      'репозиторид',
      'таны хяналт шаардлагатай',
    ],
  },
  {
    artboard: '02 Repositories',
    files: [`${APP}/repositories/+page.svelte`],
    takes: [
      'Холбогдсон репозитори',
      'Даалгавар бүр нэг репозиторид харьяалагдана. Даалгавар үүсгэхийн тулд эхлээд репозиториео холбоно уу.',
      'Холбогдсон',
      'Токен хугацаа дууссан',
      'идэвхтэй',
      'дууссан',
    ],
  },
  {
    artboard: '03 Connect Repository',
    files: [`${UI}/ConnectRepository.svelte`],
    takes: [
      'Репозитори холбох',
      'Код унших, салбар түлхэх',
      '1. Үйлчилгээгээ сонгоно уу',
      'GitLab',
      'GitHub',
      '2. Репозиторийн хаяг',
      '3. Хандалтын токен',
      'Шаардлагатай эрх:',
      '4. Шинэ даалгаврын үндсэн дамжлага',
      'Болих',
      'Шалгаад холбох',
    ],
    omits: [
      {
        label: 'Өөрийн Git сервер',
        why: 'This version connects GitLab.com and GitHub.com and nothing else (FR-014a). A third option that refused every address would be worse than no option.',
      },
    ],
  },
  {
    artboard: '04 Tickets Board',
    files: [
      `${APP}/tickets/+page.svelte`,
      `${UI}/TicketCard.svelte`,
      // The strip's words are decided where the board's data is built.
      'apps/web/src/lib/services/run-view.ts',
    ],
    takes: [
      'Бүх репозитори',
      'Бүх дамжлага',
      'Бүх хүн үүсгэсэн',
      'Хүлээлгэнд',
      'Ажиллаж буй',
      'Батлахыг хүлээж буй',
      'Дууссан',
      'Амжилтгүй',
      'батлуулах шаардлагатай',
      'алхам',
    ],
  },
  {
    artboard: '05 Create Ticket',
    files: [`${APP}/tickets/new/+page.svelte`],
    takes: [
      'Юу хийлгэхээ бичнэ үү',
      'Репозитори',
      'Заавал',
      'Гарчиг',
      'Тайлбар',
      'Энгийн үгээр бичсэн ч болно. Тодорхойлолт агент тодруулах асуултаа өөрөө асууна.',
      'Хүлээн авах шалгуур',
      'Мөр бүрд нэг.',
      'Дамжлага',
      'Ноороглох',
      'Үүсгээд эхлүүлэх',
      'Юу болох вэ',
      'Нэгтгэх хүсэлт нээх',
      'интерфейс өөрчилж байгаа эсэхийг Тодорхойлолт агент шийднэ',
    ],
  },
  {
    artboard: '06 Ticket Run',
    files: [
      `${APP}/tickets/[id]/+page.svelte`,
      `${UI}/TicketHead.svelte`,
      `${UI}/StepTracker.svelte`,
      `${UI}/LiveLog.svelte`,
      `${UI}/ArtifactViewer.svelte`,
      `${UI}/RunDetails.svelte`,
      `${UI}/LaunchPanel.svelte`,
      `${UI}/RequestConsole.svelte`,
    ],
    takes: [
      'Ажиллуулж үзэх',
      'Ажиллаж буй хаяг',
      'Шинэ цонхонд нээх',
      'Хүсэлт',
      'Илгээх',
      'Зогсоох',
      'үүсгэсэн',
      'эхэлсэн',
      'одоогоор',
      'Түр зогсоох',
      'Ажиллагаа цуцлах',
      'Нэгтгэх хүсэлт',
      'хүлээгдэж буй',
      'шууд гаралт',
      'ШУУД',
      'Үр дүн',
      'Ажиллагааны мэдээлэл',
      'Дамжлага',
      'Тусгаарлагдсан орчин',
      'Төсөв',
      'хязгаараас',
    ],
  },
  {
    artboard: '07 Approval Checkpoint',
    files: [`${APP}/tickets/[id]/approve/+page.svelte`, `${UI}/TicketHead.svelte`],
    takes: [
      'Таны баталгаажуулалт хүлээж буй',
      'Ажиллагаа цуцлах',
      'Хяналтын цэг:',
      'код бичихээс өмнө',
      'Өөрчлөлт хүсэх',
      'Батлаад үргэлжлүүлэх',
      'засах',
      'руу буцаах',
      'Явц',
    ],
  },
  {
    artboard: '08 Pipeline Builder',
    files: [
      `${APP}/pipelines/[id]/+page.svelte`,
      `${UI}/PipelineBuilder.svelte`,
      `${UI}/StepNode.svelte`,
      'apps/web/src/lib/services/pipeline.ts',
    ],
    takes: [
      'ашиглаж байна',
      'Алхмуудаа хүссэн дарааллаар чирнэ үү. Дамжлага үргэлжлэхээс өмнө хүн харах ёстой газарт хяналтын цэг нэмээрэй.',
      'Хуулбарлах',
      'Туршилтаар ажиллуулах',
      'Нэгтгэх хүсэлт нээх',
      'Алхам нэмэх',
      'Зураг дээр чирэх эсвэл холбоос дээрх + дарна уу.',
      'Хүний хяналтын цэг',
      'Хэн нэгэн батлах хүртэл зогсоно',
      'Дизайн алхам',
      'pen.dev CLI-аар дэлгэц зурна',
      'Агент алхам',
      'Claude CLI-аар агентаа ажиллуулна',
      'Shell команд',
      'Тусгаарлагдсан орчинд скрипт ажиллуулна (lint, build)',
      'Мэдэгдэх',
      'Таны агентууд',
      'Захиалгат',
    ],
  },
  {
    artboard: '09 Agents',
    files: [`${APP}/agents/+page.svelte`, `${UI}/AgentCard.svelte`],
    takes: [
      'Агент бүр өөрийн заавар, загвар, хэрэгсэл, ур чадвартайгаар ажиллана. Дизайн агент pen.dev CLI дээр, бусад нь Claude CLI дээр ажиллана.',
      'Үндсэн',
      'Нөхцөлт',
      'Захиалгат',
      'Загвар',
      'Хэрэгсэл',
      'Ур чадвар',
      'дамжлагад',
      'ажиллагаа',
      'Засах',
    ],
  },
  {
    artboard: '10 Agent Editor',
    files: [`${APP}/agents/[id]/+page.svelte`],
    takes: [
      'Өөрчлөлт зөвхөн шинэ ажиллагаанд үйлчилнэ. Ажиллаж буй даалгаврууд эхэлсэн хувилбараа хадгална.',
      'Анхны төлөвт буцаах',
      'Системийн заавар',
      'Загвар ба хязгаар',
      'Загвар',
      'Нэг ажиллагааны дээд зардал',
      'Дээд хугацаа',
      'Дээд эргэлт',
      'Зөвшөөрөгдсөн хэрэгсэл',
      'CLI-д --allowedTools болгон дамжина',
      'Хавсаргасан ур чадвар',
      'Ур чадвар удирдах',
      'Нэмэх',
    ],
    omits: [
      {
        label: 'Sandbox-д турших',
        why: 'Nothing behind it exists — a run needs an orchestrator and a container host — and a button that does nothing is worse than no button.',
      },
    ],
  },
  {
    artboard: '11 Skills',
    files: [`${APP}/skills/+page.svelte`],
    takes: [
      'Аль ч агент ашиглаж болох дахин хэрэглэгдэх зааврын файлууд. Ажиллагаа бүрт .claude/skills/ дотор хуулагдана.',
      'Ур чадвар хайх',
      'ашиглаж байна',
      'Түүх',
      'Устгах',
      'Ур чадвар хадгалах',
      'Нэр',
      'Тайлбар (агент хэзээ ашиглахаа мэдэхийн тулд харна)',
      'Агуулга (Markdown)',
      'Урьдчилан харах',
    ],
  },
  {
    artboard: '12 Settings',
    files: [`${APP}/settings/+page.svelte`],
    takes: [
      'Ажлын талбар',
      'Sandbox (Docker)',
      'Claude CLI ба түлхүүр',
      'Дизайн (pen.dev)',
      'Зардлын хязгаар',
      'Гишүүд',
      'Мэдэгдэл',
      'Холболт шалгах',
      'Sandbox · Docker',
      'Дизайн · pen.dev',
      'Зөвхөн дизайн алхамд ашиглана.',
    ],
  },
  {
    artboard: '14 Design Review',
    files: [`${APP}/tickets/[id]/design/+page.svelte`, `${UI}/TicketHead.svelte`],
    takes: [
      'Дизайн батлахыг хүлээж буй',
      'Ажиллагаа цуцлах',
      'Хяналтын цэг: код бичихээс өмнө дэлгэцүүдийг хянана уу',
      'Өөрчлөлт хүсэх',
      'Батлаад үргэлжлүүлэх',
      'Дэлгэцүүд',
      'экспортлосон',
      'Яагаад энэ даалгаврыг зурсан бэ',
      'Дэлгэцүүдийг юутай тулгах вэ',
      'Батласны дараа',
    ],
    omits: [
      {
        label: '.pen татах',
        why: 'The source is committed to the run’s branch rather than held by the app, so the honest affordance is a link to the provider’s view of that file (FR-064e).',
      },
    ],
  },
];
