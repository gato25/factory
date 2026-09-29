/**
 * Mongolian — the interface's language, and the shape every other language
 * must match (`Messages` in `./index.ts` is `typeof mn`).
 *
 * The words come from `design.pen`, which is the source of truth for copy the
 * same way it is for spacing. `bun scripts/design/report.ts "01 Dashboard"`
 * prints an artboard's labels; `bun test scripts/design/tests/screens.test.ts`
 * fails when a phrase here stops matching the artboard it was taken from.
 *
 * What stays in English stays on purpose, and the rule is the one commit
 * 3903db7 set when it translated the design: command-line output is what the
 * tool actually prints, and repository names, branch names, model identifiers,
 * file paths, URLs and the product's own name are identifiers rather than
 * prose. Translating either would be inventing text the system never produced.
 */

/** The units a distance in time is counted in, largest first. */
export type TimeUnit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute';

export const mn = {
  /** The product's name, which is not translated. */
  app: {
    name: 'Code Factory',
  },

  /** The sidebar's destinations, and the heading each screen shows. */
  nav: {
    section: 'ҮНДСЭН',
    dashboard: 'Хяналтын самбар',
    repositories: 'Репозитори',
    tickets: 'Даалгавар',
    pipelines: 'Дамжлага',
    agents: 'Агент',
    skills: 'Ур чадвар',
    settings: 'Тохиргоо',
  },

  /** The frame every screen sits in: sidebar foot and top bar. */
  frame: {
    workspace: (name: string) => `${name} ажлын талбар`,
    searchLabel: 'Даалгавар, репозитори хайх',
    searchPlaceholder: 'Даалгавар, репозитори хайх',
    approvalsBell: 'Батлахыг хүлээж буй ажиллагаа',
    newTicket: 'Шинэ даалгавар',
  },

  /** The floating top bar every signed-in screen opens with (Kit · 08 "Top Nav"). */
  topNav: {
    label: 'Үндсэн цэс',
    home: 'Code Factory — хяналт руу',
    dashboard: 'Хяналт',
    tickets: 'Даалгавар',
    repositories: 'Репозитори',
    pipelines: 'Дамжлага',
    agents: 'Агент',
    skills: 'Ур чадвар',
    search: 'Хайх',
    searchLabel: 'Даалгавар хайх',
    newTicket: 'Шинэ даалгавар',
    settings: 'Тохиргоо',
    account: (name: string) => `${name} — таны бүртгэл`,
  },

  /** A step bar: one segment per step of the ticket's own pipeline, plus its merge request. */
  stepBar: {
    label: (at: number, total: number) => `Алхам ${at} / ${total}`,
    count: (at: number, total: number) => `${at}/${total} алхам`,
  },

  /**
   * The shipped default agents and pipelines, as a person reads them here
   * (FR-028). The rows are stored under their shipped names; these are how
   * those names are SHOWN. A name somebody gave is shown as given.
   */
  defaults: {
    agents: {
      spec: {
        name: 'Тодорхойлолт агент',
        step: 'Тодорхойлолт',
        running: 'Тодорхойлж байна',
        description: 'Даалгаврыг тодорхой шаардлагын баримт болгож, нээлттэй асуултуудыг хаана.',
      },
      design: {
        name: 'Дизайн агент',
        step: 'Дизайн · pen.dev',
        running: 'pen.dev дээр зурж байна',
        description: 'Интерфейс өөрчилдөг даалгаврын дэлгэцийг зурж, зураг болгон гаргана.',
      },
      plan: {
        name: 'Төлөвлөгөө агент',
        step: 'Төлөвлөгөө',
        running: 'Төлөвлөж байна',
        description:
          'Тодорхойлолт болон репозиторийг уншиж, архитектур, өөрчлөх файл, эрсдэлийг санал болгоно.',
      },
      tasks: {
        name: 'Даалгавар агент',
        step: 'Даалгавар',
        running: 'Даалгавар гаргаж байна',
        description: 'Төлөвлөгөөг тест бүхий жижиг, дараалсан алхмуудад хуваана.',
      },
      implement: {
        name: 'Хөгжүүлэлт агент',
        step: 'Хөгжүүлэлт',
        running: 'Хөгжүүлж байна',
        description:
          'Даалгавруудыг нэг нэгээр гүйцэтгэж, тест ажиллуулж, алдааг зассаны дараа тодорхой мессежтэй commit хийнэ.',
      },
    },
    pipelines: {
      quickFix: {
        name: 'Хурдан засвар',
        description:
          'Хяналтын цэггүй. Хүн хараагүй ч итгэж болох жижиг, сайн тодорхойлсон өөрчлөлтөд.',
      },
      standard: {
        name: 'Стандарт',
        description: 'Төлөвлөгөөний дараа, код бичихээс өмнө нэг хяналтын цэгтэй.',
      },
      reviewHeavy: {
        name: 'Хяналттай',
        description: 'Тодорхойлолт, төлөвлөгөө, хөгжүүлэлт бүрийн дараа хяналтын цэгтэй.',
      },
    },
    /** A design step that is not the shipped agent, while it runs. */
    designRunning: 'pen.dev дээр зурж байна',
    /** Any other step, while it runs: its own name. */
    running: (name: string) => `${name} ажиллаж байна`,
  },

  /**
   * Distances in time and lengths of time, as the artboards write them:
   * "4 мин өмнө", "5 өдрийн өмнө", "2м 10с". Written out here because neither
   * the server nor the browser has Mongolian in `Intl` — asked for `mn`,
   * both answered "12 minutes ago".
   */
  time: {
    justNow: 'дөнгөж сая',
    unknown: 'хэзээ нь тодорхойгүй',
    ago: (n: number, unit: TimeUnit) =>
      unit === 'day' && n === 1
        ? 'өчигдөр'
        : `${n} ${{ minute: 'мин', hour: 'цагийн', day: 'өдрийн', week: '7 хоногийн', month: 'сарын', year: 'жилийн' }[unit]} өмнө`,
    in: (n: number, unit: TimeUnit) =>
      `${n} ${{ minute: 'минутын', hour: 'цагийн', day: 'өдрийн', week: '7 хоногийн', month: 'сарын', year: 'жилийн' }[unit]} дараа`,
    duration: (minutes: number, seconds: number) =>
      minutes > 0 ? `${minutes}м ${String(seconds).padStart(2, '0')}с` : `${seconds}с`,
  },

  dashboard: {
    loading: 'Ачаалж байна…',
    /** The ticket list tile (artboard 01, "Tile · Даалгавар"). */
    ticketsTitle: 'Даалгаврууд',
    ticketsSub: 'Даалгавар бүр өөрийн дамжлагаар явна — зурвас бүр тэр дамжлагын нэг алхам',
    viewAll: 'Бүгдийг харах →',
    groups: {
      inProgress: 'Ажиллаж буй',
      needsAttention: 'Анхаарал хэрэгтэй',
      queued: 'Дараалалд',
      done: 'Дууссан',
    },
    groupCount: (group: string, n: number) => `${group}: ${n}`,
    more: (n: number) => `Өөр ${n} — самбарыг нээх →`,
    nothing: 'Одоогоор ажиллаж буй, хүлээгдэж буй даалгавар алга.',
    /** A row's state in words, beside its bar (FR-006, FR-010). */
    status: {
      running: (phrase: string, elapsed: string | null) =>
        elapsed ? `${phrase} · ${elapsed}` : phrase,
      openingMergeRequest: 'Нэгтгэх хүсэлт нээж байна',
      waiting: 'Таны батлалт хүлээж байна',
      failed: (reason: string) => `${reason} · шалтгааныг харах`,
      failedNoReason: 'Амжилтгүй болсон',
      /** 001 FR-082: never the bare word "queued". */
      queuedAt: (position: number) => `Дараалалд · ${position}-р байр`,
      queuedNext: 'Дараалалд · удахгүй эхэлнэ',
      mergeRequestOpened: (reference: string) => `MR ${reference} нээгдлээ · хүн шийднэ`,
      done: 'Дууссан · хүн шийднэ',
    },
    /** How long a step has been running: "4 мин", "1 ц 12 мин". */
    elapsed: (minutes: number) =>
      minutes < 1
        ? 'дөнгөж эхэлсэн'
        : minutes < 60
          ? `${minutes} мин`
          : `${Math.floor(minutes / 60)} ц ${minutes % 60} мин`,
    /** The first-attempt tile (FR-012). */
    firstAttempt: {
      label: 'Эхний оролдлогоор амжилттай',
      counted: (successes: number, counted: number) =>
        `сүүлийн 30 хоног · ${counted} даалгавраас ${successes}`,
      nothing: 'Хэмжих зүйл алга',
      nothingYet: 'сүүлийн 30 хоногт үр дүн нь тодорхой болсон даалгавар хараахан алга',
    },
    /** The week tile (FR-013). */
    week: {
      title: 'Нэгтгэх хүсэлт',
      sub: 'энэ 7 хоногт нээсэн',
      /** Sunday first, as `Date.getDay()` counts. */
      weekdays: ['Ня', 'Да', 'Мя', 'Лх', 'Пү', 'Ба', 'Бя'],
      today: 'өнөөдөр',
      day: (weekday: string, n: number) => `${weekday}: ${n} нэгтгэх хүсэлт`,
      tokensToday: 'Өнөөдрийн токен',
      tokensNote: 'өнөөдөр дууссан алхмуудын боловсруулсан токен',
    },
    /** What `readiness()` finds missing, as the notice names it. */
    missing: {
      'the runner address': 'гүйцэтгэх үйлчилгээний хаяг',
      'a model credential': 'загварын нэвтрэх түлхүүр',
      'a connected repository': 'холбогдсон репозитори',
    } as Record<string, string>,
    /** Joins a list the way a person reads one, not with a bare comma. */
    listJoin: ', ',
    listLast: ' ба ',
    notReady: (missing: string) =>
      `Одоохондоо юу ч ажиллуулж болохгүй: энэ ажлын талбарт ${missing} хэрэгтэй.`,
    /**
     * Wraps the links to Settings and Repositories. Mongolian puts the verb
     * last, so the sentence cannot be a prefix with the links tacked on — it
     * is two halves with the destinations between them.
     */
    setUpBefore: 'Үүнийг ',
    setUpAfter: ' хэсэгт тохируулна.',
    askAdministrator:
      'Администратортаа хандаарай — ажлын талбарын холболт, хадгалсан мэдээллийг зөвхөн тэд тохируулна (FR-004).',
  },

  approvals: {
    heading: 'Таны батлалт хэрэгтэй',
    sub: 'Агент ажлаа дуусгаад таныг хүлээж байна',
    approve: 'Батлах',
    review: (reference: string, title: string) => `${reference} ${title}-г хянах`,
    ready: (ago: string) => `${ago} бэлэн болсон`,
  },

  /** The words for a merge request, which the provider decides. */
  provider: {
    mergeRequests: 'нэгтгэх хүсэлт',
    pullRequests: 'pull request',
    tokenPageNote: {
      gitlab: 'Нэр, эрхийг аль хэдийн бөглөсөн байдлаар нээгдэнэ — хугацаа тогтоож үүсгэнэ үү.',
      github:
        '`repo` тэмдэглэгдсэн классик токен нээнэ, энэ нь дээрх гурван эрхийг бүгдийг хамарна. ' +
        'Дэлгэрэнгүй эрхтэй токен ч ажиллана, гэхдээ GitHub түүний эрхийг холбоосоор урьдчилан сонгож чадахгүй.',
    },
  },

  repositories: {
    statConnected: 'Холбогдсон репозитори',
    byProvider: (gitlab: number, github: number) => `${gitlab} GitLab · ${github} GitHub`,
    statActive: 'Идэвхтэй даалгавар',
    onRepositories: (n: number) => `${n} репозитори дээр`,
    statAttention: 'Анхаарал хэрэгтэй',
    attentionOf: (name: string, why: string) => `${name} — ${why.toLowerCase()}`,
    allWell: 'бүгд хэвийн',
    pipelineChip: (pipeline: string) => `${pipeline} дамжлага`,
    lastWork: 'СҮҮЛИЙН АЖИЛ',
    noTicketsYet: 'Одоогоор даалгавар алга',
    activeTickets: 'идэвхтэй даалгавар',
    doneCount: (n: number) => `${n} дууссан`,
    tokenExpiredBlocks: 'Токен хугацаа дууссан — шинэ даалгавар эхлэхгүй',
    replaceTokenShort: 'Токен солих',
    heading: 'Холбогдсон репозитори',
    lede: 'Даалгавар бүр нэг репозиторид харьяалагдана. Даалгавар үүсгэхийн тулд эхлээд репозиториео холбоно уу.',
    loading: 'Репозиториудыг ачаалж байна…',
    empty:
      'Одоогоор холбогдсон репозитори байхгүй. Эхний даалгавраа үүсгэхийн тулд нэгийг холбоно уу.',
    colRepository: 'РЕПОЗИТОРИ',
    colProvider: 'ҮЙЛЧИЛГЭЭ',
    colBranch: 'ҮНДСЭН САЛБАР',
    colPipeline: 'ҮНДСЭН ДАМЖЛАГА',
    colTickets: 'ДААЛГАВАР',
    colStatus: 'ТӨЛӨВ',
    actions: 'Үйлдэл',
    actionsFor: (repository: string) => `${repository} дээрх үйлдлүүд`,
    noPipeline: 'Байхгүй — даалгавар өөрөө сонгоно',
    ticketCounts: (running: number, done: number) => `${running} идэвхтэй · ${done} дууссан`,
    connected: 'Холбогдсон',
    tokenExpired: 'Токен дууссан',
    error: 'Алдаа',
    changePipeline: 'Үндсэн дамжлагыг солих',
    replaceToken: 'Хандалтын токеныг солих',
    setHowItStarts: 'Хэрхэн ажиллахыг тохируулах',
    disconnect: 'Салгах',
    pipelineForNew: 'Шинэ даалгаврын дамжлага',
    startCommand: 'Ажиллуулах команд',
    startPort: 'Ажиллах порт',
    startHint:
      'package.json-оос тогтоолгохын тулд хоёуланг хоосон орхино уу. Команд нь PORT ба HOST тохируулагдсан sandbox дотор ажиллах бөгөөд сервер 0.0.0.0 дээр хүлээх ёстой.',
    saving: 'Хадгалж байна…',
    save: 'Хадгалах',
    newToken: 'Шинэ хандалтын токен',
    tokenHint: (requests: string) =>
      `Репозиторийг унших, салбар түлхэх, ${requests} нээх эрх шаардлагатай. Шифрлэгдэж хадгалагдах бөгөөд дахин хэзээ ч харагдахгүй — танд ч гэсэн.`,
    storing: 'Хадгалж байна…',
    storeNewToken: 'Шинэ токеныг хадгалах',
  },

  connect: {
    open: 'Репозитори холбох',
    heading: 'Репозитори холбох',
    lede: (requests: string) =>
      `Үйлдвэрт код унших, салбар түлхэх, ${requests} нээх эрх шаардлагатай.`,
    close: 'Хаах',
    stepProvider: 'Үйлчилгээгээ сонгоно уу',
    chosen: 'Сонгосон',
    stepUrl: 'Репозиторийн хаяг',
    stepToken: 'Хандалтын токен',
    stepPipeline: 'Шинэ даалгаврын үндсэн дамжлага',
    scopes: (scopes: string) =>
      `Шаардлагатай эрх: ${scopes}. Шифрлэгдэж хадгалагдана, дахин хэзээ ч харагдахгүй — танд ч гэсэн.`,
    scopesLoading: 'Шаардлагатай эрхийг ачаалж байна…',
    createOne: (provider: string) => `${provider} дээр үүсгэх →`,
    noPipeline: 'Байхгүй — даалгавар бүр өөрөө сонгоно',
    cancel: 'Болих',
    testing: 'Шалгаж байна…',
    testAndConnect: 'Шалгаад холбох',
  },

  board: {
    heading: 'Даалгаврууд',
    lede: (n: number) => `${n} даалгавар · төлөв бүрээр. Даалгавар бүр өөрийн дамжлагаар явна.`,
    column: (column: string, n: number) => `${column}: ${n}`,
    loading: 'Даалгавруудыг ачаалж байна…',
    /** The searched text is emphasised, so the sentence is two halves. */
    searchingBefore: '',
    searchingAfter: '-д тохирох даалгавруудыг харуулж байна.',
    clearSearch: 'Хайлтыг цэвэрлэх',
    repository: 'Репозитори',
    allRepositories: 'Бүх репозитори',
    pipeline: 'Дамжлага',
    anyPipeline: 'Бүх дамжлага',
    creator: 'Үүсгэсэн',
    createdByAnyone: 'Бүх хүн үүсгэсэн',
    boardView: 'Багана хэлбэр',
    listView: 'Жагсаалт хэлбэр',
    noMatch: 'Тохирох даалгавар байхгүй.',
    createOne: 'Нэгийг үүсгэх',
    backlog: 'Хүлээлгэнд',
    running: 'Ажиллаж буй',
    waitingApproval: 'Батлахыг хүлээж буй',
    done: 'Дууссан',
    failed: 'Амжилтгүй',
    newTicket: 'Шинэ даалгавар',
    colTicket: 'Даалгавар',
    colRepository: 'Репозитори',
    colPipeline: 'Дамжлага',
    colStatus: 'Төлөв',
  },

  ticketCard: {
    unknown: 'тодорхойгүй',
    changesInterface: 'Интерфейсийг өөрчилнө',
    /** A card's state, shorter than a dashboard row's (artboard 04). */
    approve: (step: string) => `${step} батлуулах`,
    mergeRequestOpened: (reference: string) => `MR ${reference} нээгдлээ`,
    done: 'Дууссан',
    cancelled: 'Цуцлагдсан',
    readyToStart: 'Эхлүүлэхэд бэлэн',
    createdBy: (name: string) => `Үүсгэсэн: ${name}`,
  },

  /** The one line a ticket carries on the board, from `run-view.ts`. */
  strip: {
    notStarted: 'Эхлээгүй',
    mergeRequestOpened: 'Нэгтгэх хүсэлт нээгдсэн',
    runFailed: 'Ажиллагаа амжилтгүй болсон',
    aStep: 'Алхам',
    needsApproval: (step: string) => `${step} батлуулах шаардлагатай`,
    atStep: (step: string, index: number, total: number) => `${step} · ${index} / ${total} алхам`,
    waitingToStart: 'Хүлээлгэнд',
  },

  newTicket: {
    heading: 'Юу хийлгэхээ бичнэ үү',
    crumb: 'Та хаана байна',
    repository: 'Репозитори',
    required: 'Заавал',
    chooseRepository: 'Репозитори сонгоно уу…',
    tokenExpiredSuffix: ' — токен хугацаа дууссан',
    title: 'Гарчиг',
    titlePlaceholder: 'Google-ийн хажууд Apple нэвтрэлт нэмэх',
    description: 'Тайлбар',
    descriptionHint:
      'Энгийн үгээр бичсэн ч болно. Тодорхойлолт агент тодруулах асуултаа өөрөө асууна.',
    descriptionPlaceholder: 'Юу өөрчлөгдөх ёстой, яагаад?',
    acceptance: 'Хүлээн авах шалгуур',
    acceptanceHint: 'Мөр бүрд нэг. Хөгжүүлэлт агент бүгдийг нь биелүүлнэ.',
    acceptancePlaceholder:
      'Бүх хэрэглэгчид /login дээр Apple товч харагдана\nАмжилттай нэвтрэхэд хэрэглэгч үүснэ эсвэл холбогдоно',
    files: 'Шаардлагын баримт',
    filesHint:
      'Заавал биш. Текст, Markdown эсвэл CSV — агент алхам бүр эдгээрийг заавар болгон уншина.',
    pipeline: 'Дамжлага',
    pipelineHint: 'Зөвхөн энэ даалгаврын алхмуудыг өөрчилнө',
    /** A pipeline card's count: its steps and the merge request (FR-019). */
    stepCount: (n: number) => `${n} алхам`,
    pipelineSteps: (pipeline: string, n: number) => `${pipeline} дамжлага · ${n} алхам`,
    /** A conditional step's condition, in words (FR-019a, FR-032f). */
    condition: {
      always: '',
      ticket_has_ui: 'Интерфейс өөрчлөгдөх бол',
      ticket_has_no_ui: 'Интерфейс өөрчлөгдөхгүй бол',
    },
    onPen: (model: string) => `pen.dev · ${model}`,
    noVerification:
      'Энэ дамжлагад шалгах алхам алга: хөгжүүлэлт агентаас өөр юу ч үр дүнг шалгахгүй. Тестээ ажиллуулах shell алхам нэмбэл өөрчлөгдөнө.',
    defaultFor: (repository: string) => `${repository}-ийн үндсэн`,
    version: (version: number) => `${version}-р хувилбар`,
    queuedNotStartedBefore: (reference: string) => `${reference} үүсгэгдэж дараалалд орсон боловч `,
    queuedNotStartedAfter: (detail: string) =>
      `: оркестраторт холбогдож чадсангүй (${detail}). Дахин оролдоно.`,
    notStarted: 'эхлээгүй',
    started: (reference: string) => `${reference} эхэллээ.`,
    savedAsDraft: (reference: string) => `${reference} ноорог болж хадгалагдлаа.`,
    estimateMeasured: (tokens: string, minutes: string | number) =>
      `Ойролцоогоор ≈ ${tokens} токен · ихэвчлэн ${minutes} мин`,
    estimateCeiling: (ceilingMinutes: string | number) =>
      `Харьцуулах ажиллагаа одоогоор байхгүй · дээд тал нь ${ceilingMinutes} мин`,
    estimateUnknown: 'Тооцоог харахын тулд репозитори, дамжлага сонгоно уу.',
    saveAsDraft: 'Ноороглох',
    creating: 'Үүсгэж байна…',
    createAndStart: 'Үүсгээд эхлүүлэх',
    whatWillHappen: 'Юу болох вэ',
    chooseToSeeSteps: 'Ажиллах алхмуудыг харахын тулд репозитори, дамжлага сонгоно уу.',
    workingOutSteps: 'Алхмуудыг тооцоолж байна…',
    openMergeRequest: 'Нэгтгэх хүсэлт нээх',
    openMergeRequestNote: 'Салбар түлхэгдэж, хүсэлт нээгдэж, даалгавар хаагдана',
    testsBeforeMr: 'Энэ дамжлага нэгтгэх хүсэлт нээхээсээ өмнө таны тестүүдийг ажиллуулна.',
    tip: 'Энэ даалгавар интерфейс өөрчилж байгаа эсэхийг Тодорхойлолт агент шийднэ. Хэрэв тийм бол Дизайн агент pen.dev дээр зурж, код бичихээс өмнө та дэлгэцүүдийг хянана.',
  },

  run: {
    stepDidNotFinish: (step: string, n: number) => `${step} — ${n}-р алхам дууссангүй`,
    runDidNotFinish: 'Энэ ажиллагаа дууссангүй',
    spentOfCeiling: (spent: string, ceiling: string) =>
      `$${ceiling} хязгаараас $${spent} зарцуулсан.`,
    producedStillReadable: (paths: string) =>
      `Дахин ажиллуулахад даалгавраас дахин эхэлнэ, гэхдээ энэ оролдлогын гаргасныг унших боломжтой хэвээр: ${paths}.`,
    tabOutput: 'Гаралт',
    tabArtifacts: 'Артефакт',
    tabLaunch: 'Ажиллуулах',
    tabRequirements: 'Шаардлага',
    tabDetails: 'Мэдээлэл',
    runView: 'Ажиллагааны харагдац',
    loading: 'Ажиллагааг ачаалж байна…',
    notStarted: 'Энэ даалгавар одоохондоо эхлээгүй байна.',
    draftNote: 'Ноорог болгон хадгалсан. Та эхлүүлэх хүртэл юу ч ажиллахгүй.',
    startTicket: 'Эхлүүлэх',
    starting: 'Эхлүүлж байна…',
    startQueued:
      'Дараалалд орсон ч гүйцэтгэх үйлчилгээ хариу өгөөгүй тул хараахан эхлээгүй байна. Дахин оролдоно.',
    startFailed: (detail: string) => `Эхлүүлж чадсангүй: ${detail}`,
    statusQueued: 'Дараалалд',
    statusRunning: 'Ажиллаж буй',
    statusWaitingApproval: 'Баталгаажуулалт хүлээж буй',
    statusOpeningMr: 'Нэгтгэх хүсэлт нээж байна',
    statusDone: 'Дууссан',
    statusFailed: 'Амжилтгүй',
    statusCancelled: 'Цуцлагдсан',
    /** "Ажиллаж буй · Хөгжүүлэлт", as the artboard draws it. */
    statusAtStep: (status: string, step: string) => `${status} · ${step}`,
    whatTheStepReported: 'Алхам өөрөө юу мэдээлсэн',
    editAndRetry: 'Засаад дахин ажиллуулах',
    title: 'Гарчиг',
    description: 'Тайлбар',
    acceptanceOnePerLine: 'Хүлээн авах шалгуур, мөр бүрд нэг',
    discard: 'Болих',
    saveAndRetry: 'Хадгалаад дахин ажиллуулах',
    reconnectingTitle: 'Шууд дамжуулалтад дахин холбогдож байна',
    reconnecting: 'дахин холбогдож байна…',
    connecting: 'холбогдож байна…',
    review: 'Хянах',
    continue: 'Үргэлжлүүлэх',
    pause: 'Түр зогсоох',
    continueRunTitle:
      'Хэсэг хугацаанд юу ч болоогүй бол ажиллагааг дуусаагүй эхний алхмаас дахин хөдөлгөнө. Дууссан алхмууд ба тэдний токен хадгалагдана. Зөвхөн гацсан ажиллагаанд: ажиллаж байгаа алхам хоёр удаа ажиллах болно.',
    continueRun: 'Ажиллагааг үргэлжлүүлэх',
    cancelRun: 'Цуцлах',
    continueFromFailedTitle:
      'Амжилтгүй болсон алхмаас дахин ажиллуулна. Дууссан алхмууд ба тэдний токен хадгалагдана.',
    continueFromFailed: 'Амжилтгүй алхмаас үргэлжлүүлэх',
    retry: 'Дахин ажиллуулах',
  },

  ticketHead: {
    tickets: 'Даалгаврууд',
    where: 'Та хаана байна',
    noBranch: 'салбар хараахан алга',
    createdBy: (name: string) => `${name} үүсгэсэн`,
    started: (ago: string) => `${ago} эхэлсэн`,
    soFar: (tokens: string) => `одоогоор ${tokens} токен`,
    elapsed: 'хугацаа',
    tokensUsed: 'токен ашигласан',
    pipeline: (pipeline: string, steps: number) => `${pipeline} · ${steps} алхам`,
  },

  runResults: {
    heading: 'Үр дүн',
    count: (n: number) => `${n} гаралт`,
    screens: (n: number) => `${n} дэлгэц`,
    screensFrom: 'ui.pen + exports · pen.dev',
    commits: (n: number) => `${n} commit`,
    mergeRequest: (reference: string) => `Нэгтгэх хүсэлт ${reference}`,
    mergeRequestOpened: 'нээгдсэн · хүн шийднэ',
    mergeRequestPending: 'хүлээгдэж · хүн шийднэ',
  },

  /** A run held by the concurrency cap, on its own page (FR-082). */
  queue: {
    position: (position: number, cap: number | null) =>
      `Чөлөөтэй орчин хүлээж байна — дараалалд ${position}-р байр${cap ? `, нэг дор ${cap} ажиллана` : ''}.`,
  },

  stepTracker: {
    label: (n: number) => `Ажиллагааны ${n} алхам`,
    stepLabel: (n: number, name: string, detail: string) => `${n}-р алхам — ${name}, ${detail}`,
    mergeRequest: 'Нэгтгэх хүсэлт',
    opened: 'нээгдсэн',
    waiting: 'хүлээгдэж',
    done: 'дууссан',
    running: 'ажиллаж буй',
    runningFor: (took: string) => `${took} · ажиллаж буй`,
    waitingForYou: 'таны батлалт',
    skipped: 'алгассан',
    failed: 'амжилтгүй',
    skippedBecause: (step: string, reason: string) => `${step} алгассан — ${reason}.`,
  },

  liveLog: {
    couldNotLoad: 'Гаралтыг ачаалж чадсангүй.',
    stepNotStarted: 'Энэ алхам эхлээгүй.',
    noOutput: 'Одоогоор гаралт байхгүй.',
    live: 'ШУУД',
    jumpToLatest: 'Хамгийн сүүлд үсрэх',
    loadingOutput: 'Гаралтыг ачаалж байна…',
    skipped: (reason: string) => `Алгассан — ${reason}.`,
    liveOutput: (step: string) => `${step} — шууд гаралт`,
    newLines: (lines: number) => `${lines} шинэ мөр`,
  },

  runDetails: {
    heading: 'Ажиллагааны мэдээлэл',
    pipeline: 'Дамжлага',
    repository: 'Репозитори',
    branch: 'Салбар',
    sandbox: 'Орчин',
    execution: 'Ажиллуулалт',
    tokens: 'Токен',
    time: 'Хугацаа',
    changesInterface: 'Интерфейсийг өөрчилнө',
    noInterfaceChange: 'Интерфейс өөрчлөгдөхгүй',
    run: 'Ажиллагаа',
    /** English needs st/nd/rd/th here; Mongolian needs a suffix on the number. */
    attemptOrdinal: (attempt: number) => `(${attempt}-р оролдлого)`,
    notCreated: 'үүсгээгүй',
    notStarted: 'эхлээгүй',
    timeCap: (minutes: string | number) => `алхам тутамд ${minutes} мин хязгаар`,
    classificationMissing:
      'Тодорхойлолтын алхам интерфейсийн талаар шийдвэр бичээгүй тул дизайн алгасагдсан. Энэ даалгаварт дэлгэц шаардлагатай байсан эсэхийг шалгана уу.',
  },

  approve: {
    cancelExplain: 'Цуцлах нь орчныг чөлөөлж, одоог хүртэл түлхсэн салбарыг хөндөхгүй.',
    /** The run so far, on the checkpoint's own page (artboard 07, "Явц"). */
    timelineStep: (step: string, status: string, took: string | null) =>
      took ? `${step} ${status} · ${took}` : `${step} ${status}`,
    timelineStepN: (n: number) => `${n}-р алхам`,
    stepStatus: {
      pending: 'хүлээгдэж буй',
      running: 'ажиллаж буй',
      done: 'дууссан',
      failed: 'амжилтгүй',
      skipped: 'алгассан',
    },
    timelineSkipped: (reason: string) => `алгассан — ${reason}`,
    decision: {
      approved: 'батлагдсан',
      changes_requested: 'өөрчлөлт хүссэн',
      edited: 'засаад баталсан',
      cancelled: 'цуцлагдсан',
    },
    timelineDecision: (decision: string, timedOut: boolean) =>
      timedOut ? `Хяналтын цэг: хугацаа дуусч ${decision}` : `Хяналтын цэг: ${decision}`,
    loading: 'Ачаалж байна…',
    notStarted: 'Энэ даалгавар эхлээгүй байна.',
    loadingCheckpoint: 'Хяналтын цэгийг ачаалж байна…',
    waitingForYourApproval: 'Таны батлалт хүлээж буй',
    decided: 'Шийдэгдсэн',
    cancelRun: 'Ажиллагаа цуцлах',
    backToTheRun: 'Ажиллагаа руу буцах',
    /**
     * "Хяналтын цэг: <юуг> код бичихээс өмнө хянана". Mongolian puts the verb
     * last, so the heading is assembled from named parts rather than by
     * stringing three fragments together in English word order.
     */
    checkpointReview: (what: string, when: string) => `Хяналтын цэг: ${when} ${what} хянана уу`,
    checkpointThis: 'үүнийг',
    /** The accusative: "төлөвлөгөөг", "тодорхойлолтыг". */
    checkpointThe: (label: string) => (/[аэиоуөүяеёюы]$/i.test(label) ? `${label}г` : `${label}ыг`),
    beforeAnyCode: 'код бичихээс өмнө',
    beforePipelineContinues: 'дамжлага үргэлжлэхээс өмнө',
    thePreviousStep: 'Өмнөх алхам',
    pausedExplain: (label: string, _step: number) =>
      `${label} ажлаа дуусгалаа. Та батлах, өөрчлөлт хүсэх, эсвэл өөрөө засах хүртэл дамжлага түр зогсоно.`,
    alreadyDecided: (decision: string) => `Аль хэдийн шийдэгдсэн: ${decision}`,
    decidedAt: (at: string) => `${at}-нд. Энд хүлээх зүйл байхгүй.`,
    notAtCheckpoint: 'Энэ ажиллагаа хяналтын цэг дээр хүлээгээгүй',
    nothingToDecide: 'Энд шийдэх зүйл байхгүй.',
    notYoursToDecide: 'Энэ хяналтын цэгийг та шийдэхгүй. Гэхдээ бүгдийг уншиж болно.',
    requestChanges: 'Өөрчлөлт хүсэх',
    approveAndContinue: 'Батлаад үргэлжлүүлэх',
    followsDesign: 'Энэ хяналтын цэг дизайн алхмын дараа байна.',
    reviewTheScreens: 'Дэлгэцүүдийг хянах',
    toSeeFullSize: 'бүтэн хэмжээгээр харах.',
    edited: 'засварласан',
    rendered: 'Харагдацаар',
    source: 'Эх хувь',
    edit: (name: string) => `${name} засах`,
    screens: 'Дэлгэцүүд',
    noDocuments: 'Одоогоор баримт байхгүй — дээрх дэлгэцүүд нь өнөөг хүртэл байгаа бүхэн.',
    discardChanges: 'Өөрчлөлтийг болих',
    saveAndContinue: 'Хадгалаад үргэлжлүүлэх',
    savingNote:
      'Хадгалахад шинэ хувилбар бичигдэнэ. Өмнөх нь хадгалагдах бөгөөд дараагийн алхам бүр та хадгалсан хувилбарыг уншина.',
    empty: '(хоосон)',
    version: (version: number) => `${version}-р хувилбар`,
    chooseDocument: 'Уншихын тулд баримт сонгоно уу.',
    sentBackTo: (label: string, what: string) =>
      `Таны тэмдэглэл ${label} руу буцаж, ${what} засагдаад дахин энд зогсоно.`,
    theWork: 'ажил',
    theAgent: 'агент',
    feedbackLabel: 'Өөрчлөлт хүсэх — энэ текст агент руу илгээгдэнэ',
    feedbackPlaceholder: 'Юу өөрчлөгдөх ёстой, яагаад?',
    sendBackTo: (label: string) => `${label} руу буцаах`,
    acceptance: 'Хүлээн авах шалгуур',
    noAcceptance: 'Нэг ч заагаагүй. Энэ нь чанарын хамгийн том хөшүүрэг юм.',
    classifiedAs: (kind: string, rationale: string) => `${kind} гэж тодорхойлсон — ${rationale}`,
    interfaceWork: 'интерфейсийн ажил',
    notInterfaceWork: 'интерфейсийн ажил биш',
    timeline: 'Явц',
    waitingForApproval: 'Батлалт хүлээж буй',
    waitingForApprovalYou: ' (та)',
  },

  designReview: {
    notStarted: 'Энэ даалгавар эхлээгүй байна.',
    loading: 'Ачаалж байна…',
    loadingDesign: 'Дизайныг ачаалж байна…',
    waitingForDesignApproval: 'Дизайн батлахыг хүлээж буй',
    checkpoint: 'Хяналтын цэг: код бичихээс өмнө дэлгэцүүдийг хянана уу',
    decided: 'Шийдэгдсэн',
    cancelRun: 'Ажиллагаа цуцлах',
    backToTheRun: 'Ажиллагаа руу буцах',
    producedScreens: (screens: number) => `Дизайн агент pen.dev CLI-аар ${screens} дэлгэц зурсан.`,
    nothingImplemented: 'Одоогоор юу ч хэрэгжүүлээгүй.',
    approveToContinue: (next: string) => `Батлавал ${next} рүү шилжинэ.`,
    alreadyDecided: (decision: string) => `Аль хэдийн шийдэгдсэн: ${decision}`,
    decidedAt: (at: string) => `${at}-нд. Энд хүлээх зүйл байхгүй.`,
    notAtCheckpoint: 'Энэ ажиллагаа дизайны хяналтын цэг дээр хүлээгээгүй',
    nothingToDecide: 'Энд шийдэх зүйл байхгүй.',
    notYoursToDecide: 'Энэ хяналтын цэгийг та шийдэхгүй. Гэхдээ бүгдийг уншиж болно.',
    requestChanges: 'Өөрчлөлт хүсэх',
    approveAndContinue: 'Батлаад үргэлжлүүлэх',
    screens: 'Дэлгэцүүд',
    exported: (screens: number) => `${screens} экспортлосон`,
    openDesignSource: 'pen.dev дээр нээх',
    downloadSource: '.pen татах',
    sourceNotLinkable: (path: string) =>
      `${path} салбарт commit хийгдсэн; энэ репозиторийн хаягаас файлын холбоос үүсгэх боломжгүй.`,
    designedScreens: 'Зурагдсан дэлгэцүүд',
    whyDesigned: 'Яагаад энэ даалгаврыг зурсан бэ',
    decidedBySpec: (kind: string) => `Тодорхойлолт агент шийдсэн · ${kind}`,
    interfaceWork: 'интерфейсийн ажил',
    notInterfaceWork: 'интерфейсийн ажил биш',
    classificationMissing:
      'Тодорхойлолтын алхам энэ даалгавар интерфейсийг өөрчлөх эсэх талаар хэрэглэж болох шийдвэр гаргаагүй тул өөрчлөхгүй гэж авсан.',
    noReason: 'Ямар ч шалтгаан бичигдээгүй.',
    checkAgainst: 'Дэлгэцүүдийг эдгээртэй тулгана уу',
    galleryNote: 'Тус бүр бүтэн хэмжээгээр нээгдэнэ. Сум товчоор хооронд нь шилжинэ.',
    noAcceptance: 'Нэг ч заагаагүй. Энэ нь чанарын хамгийн том хөшүүрэг юм.',
    revisedNotRedrawn: 'Дизайныг шинээр зурахгүй, зассан хувилбар нь энд эргэж ирнэ.',
    feedbackLabel: 'Өөрчлөлт хүсэх — энэ текст дизайны хэрэгсэл руу илгээгдэнэ',
    feedbackPlaceholder: 'Юу өөрчлөгдөх ёстой, яагаад?',
    sendBackToDesign: 'Дизайн алхам руу буцаах',
    afterYouApprove: 'Батласны дараа',
    openMergeRequest: 'Нэгтгэх хүсэлт нээх',
    openMergeRequestNote: 'Салбар түлхэгдэж, хүсэлт нээгдэж, даалгавар хаагдана',
    stepCost: (took: string, tokens: string) =>
      `Дизайн алхам ${took} ажиллаж, ${tokens} токен ашигласан.`,
    stepTook: (took: string) => `Дизайн алхам ${took} ажилласан.`,
  },

  agents: {
    heading: 'Агент',
    lede: 'Агент бүр өөрийн заавар, загвар, хэрэгсэл, ур чадвартайгаар ажиллана. Дизайн агент pen.dev CLI дээр, бусад нь Claude CLI дээр ажиллана.',
    search: 'Агент хайх',
    loading: 'Агентуудыг ачаалж байна…',
    noMatch: 'Тохирох агент байхгүй. Доор нэгийг үүсгэнэ үү.',
    newAgent: 'Шинэ агент',
    name: 'Нэр',
    namePlaceholder: 'Хянагч',
    engine: 'Хөдөлгүүр',
    codingAgent: 'Кодын агент',
    designService: 'Дизайны үйлчилгээ',
    whatItIsFor: 'Юунд хэрэглэх',
    descriptionPlaceholder: 'Өөрчлөлтийг уншиж, санал болгоно',
    create: 'Үүсгэх',
  },

  skills: {
    heading: 'Ур чадвар',
    new: 'Шинэ',
    lede: 'Аль ч агент ашиглаж болох дахин хэрэглэгдэх зааврын файлууд. Ажиллагаа бүрт .claude/skills/ дотор хуулагдана.',
    search: 'Ур чадвар хайх',
    loading: 'Ур чадваруудыг ачаалж байна…',
    empty: 'Одоогоор ур чадвар байхгүй.',
    noMatch: 'Тохирох ур чадвар байхгүй.',
    loadingOne: 'Ачаалж байна…',
    pickOne: 'Зүүн талаас ур чадвар сонгох, эсвэл шинээр үүсгэнэ үү.',
    newSkill: 'Шинэ ур чадвар',
    usedBy: (agents: number) => `${agents} агент ашиглаж байна`,
    agentCount: (agents: number) => `${agents} агент`,
    savedTo: 'Үүнийг хэрэглэх ажиллагаа бүрд .claude/skills/<нэр>/SKILL.md-д хадгалагдана.',
    lastEdited: (when: string) => `· сүүлд ${when} засварласан`,
    by: (who: string) => `(${who})`,
    shipped: '· нийлүүлсэн',
    ownedBy: (who: string) => `· ${who}-ийн эзэмшилд`,
    history: 'Түүх',
    delete: 'Устгах',
    createSkill: 'Ур чадвар үүсгэх',
    saveSkill: 'Ур чадвар хадгалах',
    name: 'Нэр',
    descriptionLabel: 'Тайлбар (агент хэзээ ашиглахаа мэдэхийн тулд харна)',
    descriptionPlaceholder: 'Файл үүсгэх, зөөхөөс өмнө хэрэглэнэ',
    loadingHistory: 'Түүхийг ачаалж байна…',
    pickVersion: 'Юу бичсэнийг уншихын тулд хувилбар сонгоно уу.',
    current: 'одоогийн',
    noHistory:
      'Одоогоор юу ч бичигдээгүй — энэ ур чадвар түүхээс өмнө үүссэн бөгөөд дараагийн хадгалалт түүхийг нь эхлүүлнэ.',
    content: 'Агуулга (Markdown)',
    source: 'Эх хувь',
    preview: 'Урьдчилан харах',
    backToContent: 'Агуулга руу буцах',
    putBack: (version: number) => `${version}-р хувилбарыг засварлагчид оруулах`,
    putBackNotice: (version: number) =>
      `${version}-р хувилбар засварлагчид байна. Хадгалах хүртэл хадгалагдахгүй бөгөөд хадгалахад хуучныг дарж бичихгүй, шинэ хувилбар үүснэ.`,
    ready: (name: string) => `“${name}” агентад хавсаргахад бэлэн.`,
    savedAs: (version: number) => `${version}-р хувилбар болгон хадгаллаа.`,
    reaches: (agents: string) =>
      `${agents} дараагийн эхлүүлэх ажиллагаандаа үүнийг хэрэглэнэ; явагдаж буй ажиллагаанд хамаарахгүй.`,
    deleted: 'Устгалаа.',
    deletedFrom: (agents: string) => `Устгаж, ${agents}-аас хаслаа.`,
  },

  settings: {
    heading: 'Тохиргоо',
    lede: 'Ажлын талбарын тохиргоо. Зөвхөн администратор өөрчилнө.',
    loading: 'Тохиргоог ачаалж байна…',
    testAll: 'Бүх холболтыг шалгах',
    runner: 'Ажиллуулагч',
    runnerLede:
      'Даалгаврын ажиллагаа бүрийг ажиллуулагч гүйцэтгэж, дарааллыг өөрөө удирдана. Апп зөвхөн өгөгдөл хадгалж, явцыг харуулна.',
    runnerAddress: 'Ажиллуулагчийн хаяг',
    runnerToken: 'Нэвтрэх токен',
    tokenHint: 'Ажиллагаа эхлүүлэх, хүлээлтийг үргэлжлүүлэхэд ашиглана',
    tokenSetMasked: 'тохируулсан · утгыг хэзээ ч харуулахгүй',
    tokenMissing: 'Тохируулаагүй — RUNNER_AUTH_TOKEN орчны хувьсагчид тавина',
    callback: 'Буцах дуудлага (ажиллуулагч → апп)',
    testHint:
      'Шалгалт нь холбогдож, зөвшөөрөгдсөнийг хүрэх боломжгүй болон татгалзсанаас ялгана — гурвуулаа өөр засвар шаарддаг.',
    state: {
      reachable: 'Холбогдсон',
      unconfigured: 'Тохируулаагүй',
      unreachable: 'Хүрэх боломжгүй',
      unauthorised: 'Татгалзсан',
      wrong_shape: 'Өөр үйлчилгээ',
    } as Record<string, string>,
    modelCredentialHint:
      'Anthropic Console бүртгэлд хэрэглээгээр төлөгдөх API түлхүүр, эсвэл `claude setup-token`-оор авсан Claude захиалгын токен — энэ нь захиалгынхаа хязгаараас хэрэглэнэ. Захиалгын хязгаар нэг хүний ажилд тохирсон тул олон ажиллагаа зэрэг явбал анхаарна уу.',
    designStepNote:
      'Дизайн алхмын загвар, экспортын тохиргоо энд биш, алхам дээрээ байна — дамжлага байгуулагч дээр тохируулна уу.',
    loadingMembers: 'Ачаалж байна…',
    ticketsCreated: (n: number) => `${n} даалгавар`,
    you: 'та',
    queueSummary: (executing: number, cap: number, waiting: number) =>
      `${cap}-аас ${executing} ажиллаж байна${waiting > 0 ? ` · ${waiting} хүлээж байна` : ''}`,
    unknownAuthor: 'тодорхойгүй',
    executing: 'ажиллаж байна',
    position: (n: number) => `${n}-р байр`,
    invited: (email: string) => `${email} одоо нэвтэрч болно.`,
    nowRole: (admin: boolean): string => (admin ? 'Одоо администратор.' : 'Одоо гишүүн.'),
    accessRevoked: 'Эрхийг цуцаллаа.',
    ticketsStay: (n: number) =>
      `Тэдний үүсгэсэн ${n} даалгавар үлдэнэ: энэ бол болсон зүйлийн бүртгэл.`,
    ownedTransferred: (n: number) =>
      `Тэдний эзэмшиж байсан ${n} дамжлага, агент эсвэл ур чадвар одоо таных.`,
    sections: 'Тохиргооны хэсгүүд',
    workspace: 'Ажлын талбар',
    sandboxDocker: 'Sandbox (Docker)',
    claudeCliAndKeys: 'Claude CLI ба түлхүүр',
    designPen: 'Дизайн (pen.dev)',
    costLimits: 'Зардлын хязгаар',
    members: 'Гишүүд',
    notifications: 'Мэдэгдэл',
    containerHost: 'Контейнерийн хост',
    designService: 'Дизайны үйлчилгээ',
    configured: 'Тохируулсан',
    notSetUp: 'Тохируулаагүй',
    adminOnly:
      'Ажлын талбарын тохиргоо — мэдээлэл, холболт, хязгаар, гишүүнчлэл — администраторт зориулагдсан. Code Factory-ийн бусад бүхэн тийм биш: дамжлага, агент, ур чадвар нь эзэмшигчээрээ явах бөгөөд хэн ч өөрийнхийг үүсгэж болно.',
    workspaceLede: 'Нэг deployment, нэг ажлын талбар. Түүний нэрийг гишүүд хажуугийн мөрөнд харна.',
    readyToRun: 'Ажиллахад бэлэн',
    notReady: 'Бэлэн биш',
    cannotStart: (missing: string) =>
      `Энэ ажлын талбар одоохондоо ажиллагаа эхлүүлж чадахгүй. Дутуу байгаа: ${missing}.`,
    name: 'Нэр',
    sandboxHeading: 'Sandbox · Docker',
    sandboxLede: 'Ажиллагаа бүр репозитори, Claude CLI, хэрэгслүүдээ агуулсан шинэ орчин авна.',
    containerHostAddress: 'Контейнерийн хостын хаяг',
    image: 'Ажиллуулагчийн образ',
    processors: 'Нэг орчны CPU',
    memoryMb: 'Санах ой, MB',
    lifetimeMinutes: 'Дээд хугацаа, мин',
    retainFailedHours: 'Амжилтгүй ажиллагааны орчныг хэдэн цаг хадгалах',
    networkDuringImplement: 'Хөгжүүлэлтийн үед сүлжээнд нэвтрэх',
    networkDuringImplementNote:
      'Агент ба дизайны алхам бүрд шаардлагатай: агент орчин дотор ажиллаж, моделтой сүлжээгээр холбогддог тул эдгээр алхам бүхий ажиллагаа энэ тохиргоо унтраалттай байхад татгалзагдана. Зөвхөн shell алхмуудаас бүрдсэн дамжлагад унтраа — сүлжээнд хандаж чадахгүй орчин юу ч гадагш илгээж чадахгүй.',
    costLimitsLede:
      'Гишүүний өөрийн хязгаар хэтрүүлж болохгүй дээд хязгаарууд. Хэн нэгэн өөрийн агент дээр тавьсан хязгаар эдгээрээр хязгаарлагдах тул ажиллагааны хэрэглээг зөвхөн бууруулж чадна.',
    maxSpend: 'Ажиллагаа зарцуулж болох дээд хэмжээ, доллараар',
    maxTime: 'Ажиллагаа үргэлжлэх дээд хугацаа, минутаар',
    maxConcurrent: 'Зэрэг ажиллаж болох ажиллагааны тоо',
    testing: 'Шалгаж байна…',
    testConnection: 'Холболт шалгах',
    save: 'Хадгалах',
    keysLede:
      'Шифрлэгдэж хадгалагдаж, ажиллагаанд орчны хувьсагчаар дамжуулагдах бөгөөд дахин хэзээ ч харагдахгүй — танд ч гэсэн. Солих нь өөрчлөх цорын ганц арга.',
    oneIsStored: 'Нэг нь хадгалагдсан',
    noneYet: 'Одоогоор байхгүй',
    modelCredential: 'Моделийн мэдээлэл',
    pasteItHere: 'энд буулгана уу',
    store: 'Хадгалах',
    designHeading: 'Дизайн · pen.dev',
    designLede:
      'Зөвхөн дизайн алхамд ашиглана. Дэлгэцүүд зураг болон гарч, .pen файл кодтойгоо хамт commit хийгдэнэ.',
    signedIn: 'Нэвтэрсэн',
    designCredential: 'Бүртгэлийн түлхүүр',
    storeDesignCredential: 'Дизайны мэдээллийг хадгалах',
    membersLede:
      'Администратор ажлын талбарыг тохируулна. Бусад бүхэн — дамжлага, агент, ур чадвар — эзэмшигчээрээ явна.',
    roleFor: (person: string) => `${person}-ийн үүрэг`,
    member: 'Гишүүн',
    administrator: 'Администратор',
    remove: 'Хасах',
    email: 'И-мэйл',
    role: 'Үүрэг',
    invite: 'Урих',
    notificationsLede: 'Ажиллагаанд хүн шаардлагатай болбол хэнд, хэрхэн мэдэгдэх.',
    nothingToConfigure: 'Тохируулах зүйл байхгүй',
    approversNote:
      'Хяналтын цэг хэн батлахыг өөрөө шийднэ — ажлын талбарын хэн ч, даалгаврын зохиогч, эсвэл нэрлэсэн хүмүүс — дамжлага байгуулагч дээрх алхам дээр. Ажиллагаа цэгт хүрэхэд тэдгээр хүмүүс тодорхойлогдож бичигдэх бөгөөд мэдэгдэл програмын лог руу бичигдэнэ.',
    notifyStepNote:
      'Дамжлагын Мэдэгдэх алхам одоогоор юу ч илгээдэггүй: ажиллагаа үүнийг бичээд цааш үргэлжилнэ.',
    runsNow: 'Одоо ажиллаж байна',
  },

  pipelines: {
    lede: 'Дамжлага гэдэг нь даалгавар дамжин өнгөрөх алхмуудын дараалал юм.',
    heading: 'Дамжлага',
    loading: 'Дамжлагуудыг ачаалж байна…',
    empty: 'Одоогоор байхгүй. Доор нэгийг үүсгэнэ үү.',
    repositoriesUsing: (repositories: number) => `· ${repositories} репозитори ашиглаж байна`,
    duplicate: 'Хуулбарлах',
    newPipeline: 'Шинэ дамжлага',
    name: 'Нэр',
    namePlaceholder: 'Бүтээхээс өмнө хянана',
    whatItIsFor: 'Юунд хэрэглэх',
    descriptionPlaceholder: 'Хэрэглэгчид харагдах бүх зүйл',
    create: 'Үүсгэх',
  },

  pipeline: {
    loading: 'Дамжлагыг ачаалж байна…',
    runsInFlight: (n: number) => `${n} ажиллагаа явагдаж байна`,
    inFlightNote: (n: number) =>
      `Энэ дамжлагаар ${n} ажиллагаа явагдаж байна. Хадгалах нь тэдэнд хамаарахгүй: тус бүр эхэлсэн хувилбараараа үргэлжилнэ.`,
    toFix: (n: number) => `Хадгалахаас өмнө ${n} зүйл засах хэрэгтэй.`,
    willWrite: (version: number) => `Хадгалахад ${version}-р хувилбар бичигдэнэ.`,
    nothingToSave: 'Хадгалах зүйл алга.',
    saveAs: (version: number) => `${version}-р хувилбар болгон хадгалах`,
    saved: (version: number, inFlight: number) =>
      inFlight === 0
        ? `${version}-р хувилбар болгон хадгаллаа.`
        : `${version}-р хувилбар болгон хадгаллаа. Явагдаж буй ${inFlight} ажиллагаа эхэлсэн хувилбараараа үргэлжилнэ.`,
    duplicated: (name: string) => `“${name}” нэрээр хуулбарлав.`,
    breadcrumb: 'Дамжлага',
    nameLabel: 'Дамжлагын нэр',
    rename: 'Энэ дамжлагын нэрийг солих',
    usedBy: (repositories: number) => `${repositories} репозитори ашиглаж байна`,
    version: (version: number) => `${version}-р хувилбар`,
    dragHint:
      'Алхмуудаа хүссэн дарааллаар чирнэ үү. Дамжлага үргэлжлэхээс өмнө хүн харах ёстой газарт хяналтын цэг нэмээрэй.',
    someoneElseOwns: 'Энэ дамжлагыг өөр хүн эзэмшдэг — та хэрэглэж болох ч өөрчилж болохгүй.',
    shippedDefault: 'Энэ нь нийлүүлсэн стандарт — та хэрэглэж болох ч өөрчилж болохгүй.',
    duplicate: 'Хуулбарлах',
    testRun: 'Туршилтаар ажиллуулах',
    preflightHeading: 'Одоо энэ дамжлагаар даалгавар эхэлбэл',
    preflightNote: (version: number) => `${version}-р хувилбар, хадгалсан байдлаар. Юу ч эхлээгүй.`,
    workingItOut: 'Тооцоолж байна…',
    estimateMeasured: (minutes: string | number, tokens: string, samples: number) =>
      `Ижил төрлийн ажиллагаанууд ойролцоогоор ${minutes} минут, ${tokens} токен ашигласан (${samples} ажиллагаагаар). Энэ нь тооцоо бөгөөд батлан даалт биш.`,
    estimateNone: (ceilingMinutes: string | number) =>
      `Харьцуулах ажиллагаа байхгүй тул тооцоолох үндэс байхгүй. Дээд хугацаа нь ${ceilingMinutes} минут.`,
    nothingVerifies: 'Энэ дамжлагад үр дүнг шалгах юу ч байхгүй (FR-034a).',
  },

  /** The palette's words, which `design.pen`'s 08 Pipeline Builder draws. */
  stepKind: {
    agent: 'Агент алхам',
    design: 'Дизайн алхам',
    checkpoint: 'Хүний хяналтын цэг',
    shell: 'Shell команд',
    notify: 'Мэдэгдэх',
    agentDetail: 'Claude CLI-аар агентаа ажиллуулна',
    designDetail: 'pen.dev CLI-аар дэлгэц зурна',
    checkpointDetail: 'Хэн нэгэн батлах хүртэл зогсоно',
    shellDetail: 'Тусгаарлагдсан орчинд скрипт ажиллуулна (lint, build)',
    notifyDetail: 'Slack / и-мэйл / webhook',
    implicitLast: 'Нэгтгэх хүсэлт нээх',
    implicitLastWhy: 'Дамжлага бүр энд төгсдөг. Үүнийг зөөж, хасч болохгүй.',
  },

  stepNode: {
    noAgentChosen: (kind: string) => `${kind} — агент сонгоогүй`,
    writesDesign: (path: string) => `${path} бичнэ`,
    skills: (names: string) => `ур чадвар: ${names}`,
    conditional: 'Нөхцөлт',
    moveUp: (n: number) => `${n}-р алхмыг дээш`,
    moveDown: (n: number) => `${n}-р алхмыг доош`,
    remove: (n: number) => `${n}-р алхмыг хасах`,
    produces: (files: string) => `${files}-ийг гаргана`,
    writesTheCode: 'Код бичнэ',
    anyoneDecides: 'Ажлын талбарын хэн ч батална',
    authorDecides: 'Даалгаврын зохиогч батална',
    namedApprovers: (count: number) => `Нэрлэсэн ${count} батлагч`,
    timeout: (hours: number, then: string) => `${hours} ц хүлээнэ, дараа нь ${then}`,
    autoContinue: 'автоматаар үргэлжилнэ',
    runFails: 'ажиллагаа амжилтгүй болно',
    keepsWaiting: 'үргэлжлүүлж хүлээнэ',
    waitsIndefinitely: 'хугацаагүй хүлээнэ',
    noCommandYet: 'команд хараахан байхгүй',
    noChannelYet: 'суваг хараахан байхгүй',
    stepLabel: (index: number, title: string) => `${index}-р алхам — ${title}`,
    custom: 'Захиалгат',
    actionsFor: (index: number) => `${index}-р алхмын үйлдлүүд`,
  },

  builder: {
    trigger: 'Эхлэл: даалгавар үүсэх',
    insertAt: (n: number) => `${n}-р байранд алхам оруулах`,
    finish: 'Нэгтгэх хүсэлт нээх → даалгавар хаах',
    addAtEnd: 'Төгсгөлд алхам нэмэх',
    addSequence: 'Алхам нэмэх',
    addHint: 'Зураг дээр чирэх эсвэл холбоос дээрх + дарна уу.',
    yourAgents: 'Таны агентууд',
    noAgents: 'Одоогоор байхгүй.',
  },

  stepEditor: {
    whenRuns: 'Энэ алхам хэзээ ажиллах вэ?',
    /** A step's condition in the editor, and inside a sentence that names it. */
    condition: {
      always: 'үргэлж',
      ticket_has_ui: 'зөвхөн даалгавар интерфейс өөрчлөх үед',
      ticket_has_no_ui: 'зөвхөн даалгавар интерфейс өөрчлөхгүй үед',
    },
    heading: (index: number, kind: string) => `${index}-р алхам — ${kind}`,
    close: (index: number) => `${index}-р алхмыг хаах`,
    agent: 'Агент',
    chooseAgent: 'Агент сонгоно уу…',
    outputFiles: 'Энэ алхам гаргах ёстой баримтууд, мөр бүрд нэг',
    designSourcePath: 'Дизайны эх файлын зам',
    screensExportedTo: 'Дэлгэцүүд хаана гарах',
    whoMayDecide: 'Энэ хяналтын цэгийг хэн шийдэж болох вэ?',
    anyone: 'Ажлын талбарын хэн ч',
    ticketAuthor: 'Даалгаврын зохиогч',
    onlyNamed: 'Зөвхөн миний нэрлэсэн хүмүүс',
    approvers: 'Батлагчид',
    timeoutHours: 'Хэдэн цаг хүлээх',
    indefinitely: 'хугацаагүй',
    timeoutHint: 'Хэн нэгэн шийдэх хүртэл хүлээлгэхийн тулд хоосон орхино уу.',
    whenExpires: 'Тэр хугацаа дуусахад',
    keepWaiting: 'Үргэлжлүүлж хүлээх',
    continueAsApproved: 'Батлагдсан гэж үзэн үргэлжлүүлэх',
    failTheRun: 'Ажиллагааг амжилтгүй болгох',
    command: 'Команд',
    channel: 'Суваг',
    message: 'Мессеж',
  },

  agentEditor: {
    loading: 'Агентыг ачаалж байна…',
    name: 'Нэр',
    default: 'Үндсэн',
    custom: 'Захиалгат',
    edited: ' · засварласан',
    usage: (pipelines: number, runs: number) => `${pipelines} дамжлага · ${runs} ажиллагаа`,
    whatItIsFor: 'Юунд хэрэглэх',
    changingIsFor: (who: string) => `Үүнийг өөрчлөх нь ${who}-ийн эрх.`,
    anAdministrator: 'администратор',
    itsOwner: 'эзэмшигч',
    changesApplyNote:
      'Өөрчлөлт зөвхөн шинэ ажиллагаанд үйлчилнэ. Ажиллаж буй даалгаврууд эхэлсэн хувилбараа хадгална.',
    resetTitle: 'Бүх өөрчлөлтийг болиод нийлүүлсэн хувилбар руу буцах',
    alreadyShipped: 'Энэ агент нийлүүлсэн хувилбартай аль хэдийн тохирч байна',
    resetToDefault: 'Анхны төлөвт буцаах',
    saving: 'Хадгалж байна…',
    saveChanges: 'Өөрчлөлтийг хадгалах',
    systemPrompt: 'Системийн заавар',
    systemPromptNote: (file: string) =>
      `CLI ажиллахын өмнө ${file} болгон оруулна. Даалгаврын өгөгдлийг {{variables}}-аар бичнэ.`,
    designPromptNote:
      'Дизайны үйлчилгээ ажиллахын өмнө өгөгдөнө. Даалгаврын өгөгдлийг {{variables}}-аар бичнэ.',
    allOf: (count: number) => `бүгд ${count}`,
    engine: 'Хөдөлгүүр',
    codingAgent: 'Кодын агент',
    designService: 'Дизайны үйлчилгээ',
    model: 'Загвар',
    modelOption: (name: string, id: string) => (name === id ? id : `${name}  (${id})`),
    modelAndLimits: 'Загвар ба хязгаар',
    maxCost: 'Дээд зардал',
    runsLimit: 'өгөгдмөл',
    noLimit: 'байхгүй',
    limitsNote:
      'Тус бүр ажиллагааны зөвшөөрснөөр хязгаарлагдана, тиймээс энд тавьсан хязгаар даалгаврын зарцуулж болохыг нэмэгдүүлэхгүй. Ажиллагааныхыг хэрэглэхийн тулд хоосон үлдээнэ үү.',
    noToolsForDesign:
      'Хэрэгслийн зөвшөөрөл дизайны үйлчилгээнд хамаарахгүй тул тохируулах зүйл алга.',
    maxTime: 'Дээд хугацаа',
    maxTurns: 'Дээд эргэлт',
    allowedTools: 'Зөвшөөрөгдсөн хэрэгсэл',
    allowedToolsNote: 'CLI-д --allowedTools болгон дамжина',
    toolLabel: (name: string, what: string) => `${name} — ${what}`,
    skillsAttached: 'Хавсаргасан ур чадвар',
    manageSkills: 'Удирдах →',
    removeSkill: (skill: string) => `${skill}-ийг хасах`,
    add: 'Нэмэх',
    noSkillsYet: 'Одоогоор ур чадвар байхгүй — эхлээд нэгийг бичнэ үү.',
    holdsEverySkill: 'Бүх ур чадварыг аль хэдийн хавсаргасан.',
    none: 'Байхгүй.',
  },

  launch: {
    heading: 'Ажиллуулж үзэх',
    noBranchYet: 'Энэ даалгаварт салбар хараахан байхгүй.',
    afterPush: 'Ажиллагаа дуусаж, салбараа түлхсэний дараа боломжтой.',
    atCheckpoint: 'Ажиллагаа дуусмагц боломжтой; одоо хяналтын цэг дээр хүлээж байна.',
    didNotFinish: 'Ажиллагаа дуусаагүй тул салбарт ажиллах төсөл байхгүй байж магадгүй.',
    afterAnyRun: 'Ажиллагаа дуусмагц боломжтой.',
    didNotWork: 'Энэ болсонгүй.',
    running: 'Ажиллаж байна',
    starting: 'Эхэлж байна',
    didNotStart: 'Эхэлсэнгүй.',
    setHowItStarts: 'Репозитори → Хэрхэн ажиллахыг тохируулах',
    stopped: 'Зогссон.',
    runAgain: 'Дахин ажиллуулах',
    commandFrom: (source: string) => `Команд ${source}-оос.`,
    page: 'Хуудас',
    requests: 'Хүсэлтүүд',
    runningProject: 'Ажиллаж байгаа төсөл',
  },

  artifacts: {
    loading: 'Ачаалж байна…',
    emptyDocument: '(хоосон)',
    documentLine: (purpose: string, version: number, step: number) =>
      `${purpose} · v${version} · ${step}-р алхам`,
    committed: (path: string) => `${path} commit хийгдсэн`,
    heading: 'Артефакт',
    couldNotOpen: 'Үүнийг нээж чадсангүй.',
    empty: 'Одоогоор юу ч гараагүй.',
    purposeSpec: 'Шаардлага',
    purposePlan: 'Арга барил',
    purposeTasks: 'Дараалсан ажлууд',
    purposeOther: 'Ажиллагаа гаргасан',
    screens: 'Дэлгэцүүд',
    opening: 'Нээж байна…',
    openInPen: 'pen.dev дээр нээх',
    onBranch: (branch: string) => `${branch} салбар дээр`,
    mergeRequest: 'Нэгтгэх хүсэлт',
    mergeRequestOpen: 'Үйлчилгээ дээр хэвийн журмаар хянаж нэгтгэнэ',
    mergeRequestPending: 'Сүүлийн алхам дуусахад үүснэ',
  },

  /** One agent's tile on artboard 09. */
  agentCard: {
    isDefault: 'Үндсэн',
    conditional: 'Нөхцөлт',
    custom: 'Захиалгат',
    model: 'Загвар',
    tools: 'Хэрэгсэл',
    skills: 'Ур чадвар',
    engine: 'Хөдөлгүүр',
    output: 'Гаралт',
    penCli: 'pen.dev CLI',
    claudeCli: 'Claude CLI',
    designOutput: 'ui.pen + PNG screens',
    noTools: 'байхгүй — юу ч уншиж, бичиж чадахгүй',
    usage: (pipelines: number, runs: number) => `${pipelines} дамжлагад · ${runs} ажиллагаа`,
    unused: 'Хараахан ашиглаагүй',
    inFlight: (n: number) => `${n} явагдаж буй`,
    edit: 'Засах',
    read: 'Унших',
    duplicate: 'Хуулбарлах',
    newSub: 'Дамжлагадаа өөрийн алхам нэмэх',
  },

  /** A tool by its short name, where a list of them is shown. */
  toolName: {
    Read: 'Унших',
    Write: 'Бичих',
    Edit: 'Засах',
    Glob: 'Файл хайх',
    Grep: 'Агуулга хайх',
    Bash: 'Bash',
    WebFetch: 'WebFetch',
    GitPush: 'Git түлхэлт',
  },

  /**
   * Tokens — what a step or a run processed, shown wherever the screens used to
   * show what it cost. The engine's own counts; `total` is all four added up.
   */
  tokens: {
    count: (compact: string) => `${compact} токен`,
    breakdown: (input: string, output: string, cached: string) =>
      `оролт ${input} · гаралт ${output} · кэш ${cached}`,
  },

  owner: {
    sharedTitle: 'Хүн бүрд боломжтой; администратор өөрчилнө',
    shipped: 'Нийлүүлсэн',
    yours: 'Танай',
    youCanChange: 'Та үүнийг өөрчилж болно',
    youCannotChange: 'Та хэрэглэж болох ч өөрчилж болохгүй',
    someoneElse: 'Өөр хүн',
  },

  gallery: {
    position: (n: number, total: number) => `${total}-с ${n}`,
    heading: 'Дэлгэцүүд',
    empty: 'Ямар ч дэлгэц гараагүй.',
    close: 'Хаах',
    previous: 'Өмнөх дэлгэц',
    next: 'Дараах дэлгэц',
  },

  console: {
    method: 'Метод',
    path: (baseUrl: string) => `Зам, ${baseUrl} руу илгээгдэнэ`,
    sentTo: (baseUrl: string) => `${baseUrl} руу илгээгдэнэ`,
    headers: 'Толгойнууд, мөр бүрд нэг',
    body: 'Бие',
    truncated: 'Эхний 256 KB-ыг харуулж байна.',
  },

  files: {
    heading: 'Шаардлага',
    remove: (file: string) => `${file}-ийг хасах`,
    empty: 'Юу ч хавсаргаагүй. Агентууд зөвхөн даалгаврын текстээс ажиллана.',
    view: (file: string) => `${file}-ийг унших`,
    loading: 'Ачаалж байна…',
    gone: 'Энэ файл хавсралтаас хасагдсан байна.',
    attach: 'Хавсаргах',
    removed: (file: string) => `${file} хасагдлаа.`,
    alreadyGone: (file: string) => `${file} аль хэдийн хасагдсан байсан.`,
    runReadsOnce:
      'Ажиллагаа эдгээрийг нэг л удаа, орчноо бүтээхдээ уншдаг. Эндээс өөрчилбөл дараагийн оролдлогод нөлөөлнө, ажиллаж буйд нөлөөлөхгүй.',
  },

  /**
   * What the person gave when they made the ticket, shown on the ticket
   * itself. It was written once, on the form, and nothing afterwards showed it.
   */
  brief: {
    heading: 'Юу хүссэн бэ',
    empty: 'Юу ч бичээгүй: тайлбар ч, шалгуур ч алга.',
    readDocuments: 'Баримтуудыг унших',
  },

  markdown: {
    nothingToPreview: 'Урьдчилан харах юу ч байхгүй.',
  },

  /**
   * Why a run failed and what to do about it (FR-087). The one place in this
   * catalogue where the words matter most: this is what a person reads when
   * something has gone wrong and they have to decide what to do next.
   */
  failure: {
    missingOutputWhat: 'Алхам нь бичих ёстой байсан баримтаа гаргалгүй дуусав.',
    missingOutputNext:
      'Ихэвчлэн даалгавар агентад ажиллах хангалттай мэдээлэл өгөөгүй байдаг. Тайлбар эсвэл хүлээн авах шалгуурт нэмж бичээд дахин ажиллуулна уу.',
    budgetWhat: 'Ажиллагаа зарцуулж болох дээд хэмжээндээ хүрлээ.',
    budgetNext:
      'Даалгавар нь хязгаараас том, эсвэл нарийсгах шаардлагатай. Хуваах, эсвэл дамжлагын хязгаарыг ахиулна уу.',
    timeWhat: 'Алхам нь зөвшөөрөгдсөн хугацаанаас урт ажиллав.',
    timeNext:
      'Хугацааны хязгаар алхам тус бүрд тусад нь хамаарна, тул энэ нь ажиллагаа бүхэлдээ биш, нэг алхамд илүү хугацаа хэрэгтэй байгааг хэлж байна. Тэр агентад өөрийн урт хязгаар өгөх, даалгаврыг нарийсгах, эсвэл дамжлагын хязгаарыг ахиулна уу — сүүлийнх нь алхам бүрд хамаарна.',
    engineWhat: 'Модельтой холбогдож чадсангүй.',
    retryOnly: 'Даалгаварт ямар ч буруу зүйл байхгүй. Дахин ажиллуулна уу.',
    credentialInvalidWhat: 'Хадгалсан мэдээллийг татгалзав.',
    credentialInvalidNext:
      'Дахин ажиллуулахаас өмнө администратор Тохиргоо дээр үүнийг солих шаардлагатай.',
    credentialMissingWhat: 'Энэ дамжлагад шаардлагатай мэдээлэл тохируулаагүй байна.',
    credentialMissingNext:
      'Дахин ажиллуулахаас өмнө администратор Тохиргоо дээр үүнийг нэмэх шаардлагатай.',
    sandboxLostWhat:
      'Алхам ажиллаж байсан орчин үгүй болсон бөгөөд хоёр дахь оролдлого ч ахисангүй.',
    appUnreachableWhat:
      'Ажиллуулах үйлчилгээ нь ажиллагаанд шаардлагатай зүйлийг авахаар энэ програм руу холбогдож чадсангүй.',
    appUnreachableNext:
      'Даалгаварт ямар ч буруу зүйл байхгүй. PUBLIC_BASE_URL дахь хаяг руу ажиллуулах үйлчилгээ холбогдож чадаж байгаа эсэхийг шалгаад дахин ажиллуулна уу.',
    runnerUnreachableWhat: 'Энэ програм ажиллуулах үйлчилгээтэй холбогдож чадсангүй.',
    runnerUnreachableNext:
      'Даалгаварт ямар ч буруу зүйл байхгүй. Тохиргоо дээрх runner-ийн хаяг ба runner ажиллаж байгаа эсэхийг шалгаад дахин оролдоно уу.',
    commandFailedWhat: 'Дамжлагын ажиллуулсан команд алдаатай дуусав.',
    commandFailedNext:
      'Аль команд, яагаад болохыг алхмын гаралтаас уншина уу. Хэрэв репозиторид байгаа бол түүнийг эхлээд засна уу.',
    notAuthorisedWhat: 'Ажиллагаанд шаардлагатай зүйлд хандах эрх татгалзагдав.',
    notAuthorisedNext: 'Репозитори шаардаж байгаа эрхүүд мэдээлэлд байгаа эсэхийг шалгана уу.',
    conflictWhat: 'Ажиллагааны доор ямар нэг зүйл өөрчлөгдсөн.',
    conflictNext: 'Дахин ажиллуулна уу — ажиллагаа шинээр харна.',
    notFoundWhat: 'Ажиллагаа байх ёстой гэж үзсэн зүйл байсангүй.',
    notFoundNext: 'Репозитори ба салбар байгаа эсэхийг шалгаад дахин ажиллуулна уу.',
    invalidInputWhat: 'Ажиллагаанд хэрэглэж болохгүй зүйл өгөгдсөн.',
    invalidInputNext: 'Доорх дэлгэрэнгүйг уншиж, даалгаврыг зөвтгөөд дахин ажиллуулна уу.',
    unknownWhat: 'Ажиллагаа шалтгааныг бичилгүй зогсов.',
    unknownNext:
      'Дахин ажиллуулна уу. Хэрэв дахиад ижилхэн зогсвол алхмын гаралт л үзэх цорын ганц газар болно.',
    gateExpiredWhat:
      'Хяналтын цэгийг хугацаа дуусахаас өмнө хэн ч шийдээгүй бөгөөд цэг нь амжилтгүй болгохоор тохируулагдсан байв.',
    gateExpiredNext:
      'Дахин ажиллуулж, энэ удаад хяналтын цэгийг шийднэ үү — эсвэл цэгийг хугацаагүй хүлээхээр өөрчилнө үү.',
    ownSentenceNext:
      'Дахин ажиллуулах, эсвэл шалтгаан даалгавар руу чиглэж байвал эхлээд даалгаврыг засна уу.',
    cancelledWhat: 'Ажиллагааг цуцалсан. Түлхсэн салбар нь байгаа.',
    cancelledNext: 'Үргэлжлүүлэхийг хүсвэл дахин ажиллуулна уу.',
  },

  /**
   * What a form says when it refuses, and what a service says when it cannot
   * do the thing. These reach a person through the same screens as everything
   * else, so they are copy — `notFound('no such agent')` put an English
   * sentence into a Mongolian interface.
   *
   * Deliberately NOT here: the default agents' system prompts, the default
   * skills' descriptions and the log lines. Those are read by the model or by
   * whoever is holding the log, not by somebody using the application.
   */
  form: {
    signInRequired: 'нэвтэрсэн байх шаардлагатай',
    wholeNumber: 'Бүхэл тоо байх ёстой.',
    wholeNumberOrMore: 'Бүхэл тоо, тэгээс их байх ёстой.',
    agentName: 'Агентад нэр өгнө үү.',
    chooseModel: 'Загвар сонгоно уу.',
    pipelineName: 'Дамжлагад нэр өгнө үү.',
    workspaceName: 'Ажлын талбарт нэр өгнө үү.',
    skillName: 'Ур чадварт нэр өгнө үү.',
    skillContent: 'Ур чадварт хэрэгжүүлэх агуулга хэрэгтэй.',
    ticketTitle: 'Даалгаварт гарчиг өгнө үү.',
    ticketTitleLong: 'Даалгаварт гарчиг өгнө үү — энэ нь нэгтгэх хүсэлтийн гарчиг болно.',
    personName: 'Тэдэнд нэр өгнө үү.',
    chooseRepository: 'Репозитори сонгоно уу.',
    repositoryAddress: 'Репозиторийн хаягийг буулгана уу.',
    accessToken: 'Хандалтын токеныг буулгана уу.',
    accessTokenFor: 'Энэ репозиторийн хандалтын токеныг буулгана уу.',
    newAccessToken: 'Шинэ хандалтын токеныг буулгана уу.',
    credential: 'Мэдээллийг буулгана уу.',
    notAnEmail: 'Энэ и-мэйл хаяг шиг харагдахгүй байна.',
    startCommandLength: 'Ажиллуулах командыг 500 тэмдэгтээс багад барина уу.',
    portRange: 'Порт нь 1-ээс 65535 хоорондох бүхэл тоо байх ёстой.',
    costCeiling: 'Зардлын хязгаарыг тогтооно уу.',
    timeCeiling: 'Хугацааны хязгаарыг бүхэл минутаар тогтооно уу.',
    concurrency: 'Зэрэг хэдэн ажиллагаа ажиллахыг тогтооно уу.',
    sandboxImage: 'Орчны дүрсийг нэрлэнэ үү.',
    processors: 'Процессорын тоог бүхэл тоогоор тогтооно уу.',
    memory: 'Санах ойг бүхэл мегабайтаар тогтооно уу.',
    lifetime: 'Орчны ашиглалтын хугацааг бүхэл минутаар тогтооно уу.',
    retention: 'Хадгалах хугацааг бүхэл цагаар тогтооно уу.',
    skillDescription: 'Агент энэ ур чадварыг хэзээ хэрэглэхийг бичнэ үү.',
    skillDescriptionLong:
      'Агент энэ ур чадварыг хэзээ хэрэглэхийг бичнэ үү. Тэр өгүүлбэрийг агент уншиж шийддэг.',
    skillEmpty: 'Агуулгагүй ур чадвар агентад юу ч өгөхгүй.',
    documentEmpty: 'Баримтыг хоосон болгож болохгүй.',
    feedbackRequired: 'Юу өөрчлөгдөхийг бичнэ үү — агент энэ санал хүсэлтийг уншина.',
    notAStepOfThisRun: 'Энэ нь тухайн ажиллагааны алхам биш.',
    stepsUnreadable: 'Алхмуудыг уншиж чадсангүй.',
    pathNotAddress: '/api/items гэх мэт замыг бичнэ үү, бүтэн хаяг биш.',
    zeroCost: 'Тэг зардлын хязгаар алхмыг эхлэхээс нь өмнө зогсоох болно.',
    zeroTime: 'Тэг хугацааны хязгаар алхмыг эхлэхээс нь өмнө зогсоох болно.',
    zeroTurns: 'Тэг эргэлтийн хязгаар алхмыг эхлэхээс нь өмнө зогсоох болно.',
    zeroCostCeiling: 'Тэг зардлын хязгаар ажиллагаа бүрийг эхлэхээс нь өмнө зогсоох болно.',
    zeroTimeCeiling: 'Тэг хугацааны хязгаар ажиллагаа бүрийг эхлэхээс нь өмнө зогсоох болно.',
    atLeastOneRun: 'Дор хаяж нэг ажиллагаа ажиллах боломжтой байх ёстой.',
    atLeastOneProcessor: 'Орчинд дор хаяж нэг процессор хэрэгтэй.',
    memoryTooSmall: '512 MB-аас бага орчин хэрэгслүүдийг хадгалж чадахгүй.',
    zeroLifetime: 'Тэг ашиглалтын хугацаа ажиллагаа бүрийг эхэлж байхад нь зогсоох болно.',
    negativeRetention: 'Хадгалах хугацаа сөрөг байж болохгүй. Тэг нь шууд чөлөөлөхийг хэлнэ.',
  },

  notice: {
    continuingFrom: (step: string, n: number) =>
      `${step}-ээс (${n}-р алхам) үргэлжилж байна. Дууссан алхмууд хадгалагдана.`,
    couldNotHandBack: (detail: string) =>
      `Ажиллагааг гүйцэтгэх үйлчилгээнд буцааж өгч чадсангүй: ${detail}`,
    attemptStarted: (attempt: number) => `${attempt}-р оролдлого эхэллээ.`,
    attemptNotBegun: (attempt: number, detail: string) =>
      `${attempt}-р оролдлого дараалалд орсон ч эхлээгүй: ${detail}. Дахин оролдоно.`,
    updatedAttemptStarted: (attempt: number) =>
      `Даалгавар шинэчлэгдэж, ${attempt}-р оролдлого эхэллээ.`,
    updatedAttemptNotBegun: (attempt: number, detail: string) =>
      `Даалгавар шинэчлэгдлээ. ${attempt}-р оролдлого дараалалд орсон ч эхлээгүй: ${detail}.`,
    agentSaved: 'Хадгалагдлаа. Ажиллаж байгаа ажиллагаанд хамаарахгүй.',
    agentReset: 'Энэ агент нийлүүлэгдсэн тохиргоо руугаа буцлаа.',
    agentDuplicated: (name: string) => `“${name}” нэрээр хуулбарлав. Одоо та үүнийг өөрчилж болно.`,
    agentDeleted: (inFlight: number) =>
      inFlight === 0
        ? 'Устгалаа.'
        : `Устгалаа. Явагдаж буй ${inFlight} ажиллагаа дуусна: тус бүр эхлэхдээ энэ агентыг уншсан бөгөөд дахин хардаггүй.`,
    settingsSaved: 'Хадгалагдлаа. Ажиллаж байгаа ажиллагаанууд эхэлсэн хязгаараа хадгална.',
    credentialStored: 'Хадгалагдлаа. Шифрлэгдэн хадгалагдах бөгөөд дахин харагдахгүй.',
    alreadyPausing: 'Энэ ажиллагаа аль хэдийн түр зогсож байна.',
    pausing: 'Түр зогсож байна. Одоо ажиллаж байгаа алхам дуусах бөгөөд дараа нь юу ч эхлэхгүй.',
    continuing: 'Зогссон газраасаа үргэлжилж байна.',
    wasNotPaused: 'Энэ ажиллагаа түр зогсоогүй байсан.',
    cancelled: 'Цуцлагдлаа. Орчин чөлөөлөгдөж, одоог хүртэл түлхсэн салбар хөндөгдөөгүй.',
    alreadyFinished: 'Энэ ажиллагаа аль хэдийн дууссан байсан.',
    openingInPen: 'pen.dev дээр нээж байна.',
    designToolSilent: 'Ажиллуулах үйлчилгээ хариу өгсөнгүй тул юу ч нээгдсэнгүй.',
    noAgentHoldsSkill: 'Одоогоор ямар ч агент энэ ур чадварыг хэрэглэхгүй байна.',
    onlyFailedRetryable:
      'Зөвхөн амжилтгүй болсон эсвэл цуцлагдсан оролдлогыг дахин ажиллуулж болно.',
  },

  error: {
    credentialsDoNotMatch: 'Имэйл хаяг, нууц үг таарахгүй байна',
    passwordTooShort: (minimum: number) =>
      `Дор хаяж ${minimum} тэмдэгт хэрэглэнэ үү. Энэ бүртгэл ажлын талбарын хадгалсан бүх нууц мэдээллийг уншиж чадна.`,
    couldNotCreateAccount: 'Бүртгэл үүсгэж чадсангүй',
    noSuchAgent: 'тийм агент байхгүй',
    noSuchSkill: 'тийм ур чадвар байхгүй',
    noSuchTicket: 'тийм даалгавар байхгүй',
    noSuchRun: 'тийм ажиллагаа байхгүй',
    noSuchPipeline: 'тийм дамжлага байхгүй',
    noSuchRepository: 'тийм репозитори байхгүй',
    noSuchPerson: 'тийм хүн байхгүй',
    noSuchLaunch: 'тийм ажиллуулалт байхгүй',
    noSuchArtifact: 'тийм артефакт байхгүй',
    repositoryNotConnected: 'тэр репозитори холбогдоогүй байна',
    pipelineDoesNotExist: 'тэр дамжлага байхгүй',
    runHasNoTicket: 'тэр ажиллагаанд даалгавар байхгүй',
    couldNotCreateAgent: 'агентыг үүсгэж чадсангүй',
    couldNotCreateSkill: 'ур чадварыг үүсгэж чадсангүй',
    couldNotCreateRun: 'ажиллагааг үүсгэж чадсангүй',
    couldNotInvite: 'тэднийг урьж чадсангүй',
    skillNameTaken: (name: string) => `“${name}” нэртэй ур чадвар аль хэдийн байна.`,
    cannotRemoveYourself: 'Та өөрийгөө хасч болохгүй. Өөр администратороос хүсээрэй.',
    runnerAddressMissing: 'Тохиргоо дээр runner-ийн хаяг тохируулагдаагүй байна.',
    launchAlreadyRunning: 'Энэ даалгавар аль хэдийн ажиллаж байна. Эхлээд зогсооно уу.',
    launchLostWithRestart: 'Ажиллуулах үйлчилгээ дахин эхэлж, ажиллуулалт нь тэр хамт үгүй болсон.',
    noDefaultPipeline: (repository: string) =>
      `${repository}-д үндсэн дамжлага байхгүй. Нэгийг сонгох, эсвэл репозитори дээр үндсэнийг тохируулна уу.`,
    signInRequired: 'нэвтэрсэн байх шаардлагатай',
    accountNotCreated: 'Бүртгэлийг үүсгэж чадсангүй. Шалтгаан нь програмын гаралтад байна.',
    enterEmailAndPassword: 'И-мэйл хаяг, нэвтрэх үг оруулна уу.',
    enterYourEmailAndPassword: 'И-мэйл хаяг, нэвтрэх үгээ оруулна уу.',
    couldNotSignIn: 'Одоохондоо нэвтрүүлж чадсангүй.',
  },

  tools: {
    Read: 'Репозиторийн аль ч файлыг унших',
    Write: 'Файл үүсгэх',
    Edit: 'Байгаа файлыг өөрчлөх',
    Glob: 'Файлыг нэрээр хайх',
    Grep: 'Файлын агуулгыг хайх',
    Bash: 'Shell команд ажиллуулах (тест, build)',
    WebFetch: 'Гадаад хаягаас татах',
    GitPush: 'Дуусахад салбарыг түлхэх',
  },

  /** What a connection check found, in words that say what to do (FR-005a). */
  connection: {
    unconfigured: 'Хараахан тохируулаагүй.',
    reachable: 'Холбогдож, манай нэвтрэх мэдээллийг хүлээн авлаа.',
    unreachable: 'Тэр хаягаар юу ч хариулсангүй. Хаяг болон үйлчилгээ ажиллаж байгааг шалгана уу.',
    unauthorised: 'Хариулсан ч манай нэвтрэх мэдээллээс татгалзлаа. Нэвтрэх мэдээллийг солино уу.',
    wrongShape: 'Ямар нэг зүйл хариулсан ч энэ үйлчилгээ биш. Хаягаа шалгана уу.',
    answered: (status: number) => `${status} гэж хариулсан.`,
    timedOut: (ms: number) => `${ms}ms дотор юу ч хариулсангүй.`,
    noDesignCredential:
      'Дизайны нэвтрэх мэдээлэл хараахан алга. Энэ нь зөвхөн дизайн алхамтай дамжлагад асуудал бөгөөд тэр алхам дээр амжилтгүй болж шалтгаанаа хэлнэ.',
  },

  /** What an agent's prompt may refer to, listed in the Agent Editor. */
  vocabulary: {
    reference: 'Даалгаврын дугаар, жишээ нь #142',
    acceptance: 'Хүлээн авах шалгуурууд, мөр бүрд нэг',
    hasUi: 'Интерфейс өөрчлөгдөх эсэх, шийдэгдсэн бол',
    repository: 'Репозиторийн нэр',
    defaultBranch: 'Нэгтгэх салбар',
    attempt: 'Хэд дэх оролдлого',
    screens: 'Зурагдсан дэлгэцүүдийн зам, дизайн алхам ажилласан бол',
  },

  validate: {
    noCodeStepDeclares:
      'Энэ дамжлагад код бичих алхам байхгүй — агент алхам бүр нь баримт гаргахаар л бичигдсэн.',
    noCodeStep: 'Энэ дамжлагад код бичих алхам байхгүй тул нэгтгэх хүсэлт гаргаж чадахгүй.',
    addAgentStep: 'Агент алхам нэмж, шалгалт, хяналтын цэг, мэдэгдлийг түүний дараа тавина уу.',
    noVerification:
      'Энэ дамжлагад шалгах алхам байхгүй тул хөгжүүлэх агентаас өөр юу ч үр дүнг шалгахгүй.',
    addCodeStep:
      'Шаардлагатай баримтгүй агент алхам нэмж, шалгалт, хяналтын цэг, мэдэгдлийг түүний дараа тавина уу.',
    conditionTooEarly: (n: number, when: string) =>
      `${n}-р алхам ${when} ажиллана, гэвч тэр үед даалгавар интерфейс өөрчлөх эсэх хараахан тодорхойгүй. Үүнийг тодорхойлолт бичдэг алхмын дараа зөөнө үү.`,
    designTooEarly: (n: number) =>
      `${n}-р алхам нь дизайн алхам боловч даалгавар интерфейс өөрчлөх эсэхийг шийддэг тодорхойлолтын алхмаас өмнө байна. Түүний дараа зөөнө үү.`,
    noAgent: (n: number) => `${n}-р алхамд агент сонгоогүй. Нэгийг сонгох эсвэл алхмыг хасна уу.`,
    noApprovers: (n: number) =>
      `${n}-р алхам нь батлагчийн жагсаалт хоосон хяналтын цэг тул хэн ч шийдэж чадахгүй. Хэн нэгнийг нэрлэх эсвэл ажлын талбарын хэн ч шийдэхийг зөвшөөрнө үү.`,
    timeoutTooShort: (n: number, hours: number) =>
      `${n}-р алхам ${hours} цаг хүлээх бөгөөд хэн нэгэн харахаас өмнө дуусна. Хугацаагүй хүлээлгэхийн тулд хүлээх хугацааг хоосон үлдээнэ үү.`,
    noCommand: (n: number) =>
      `${n}-р алхам нь команд байхгүй Shell алхам тул юу ч ажиллуулахгүйгээр амжилттай болно. Энэ репозиторийн хэрэглэдэг командыг өгнө үү.`,
    noSteps: 'Дамжлагад дор хаяж нэг алхам хэрэгтэй. Самбараас нэгийг нэмнэ үү.',
  },

  conflicts: {
    pipelineSavedElsewhere:
      'Та засаж байх зуур өөр хүн энэ дамжлагыг хадгалсан. Тэдний өөрчлөлтийг харахын тулд дахин ачаална уу.',
    noSuchStepToMove: 'зөөх тийм алхам байхгүй',
    noSuchStepToRemove: 'хасах тийм алхам байхгүй',
    couldNotDuplicatePipeline: 'дамжлагыг хувилж чадсангүй',
    couldNotCreatePipeline: 'дамжлагыг үүсгэж чадсангүй',
    couldNotDuplicateAgent: 'агентыг хувилж чадсангүй',
    skillDoesNotExist: 'тэдгээр ур чадваруудын нэг байхгүй',
    notShipped:
      'Энэ агент нийлүүлэгдсэн бус, энд үүсгэгдсэн тул буцах нийлүүлэгдсэн тохиргоо байхгүй.',
    runInProgress: (reference: string) =>
      `${reference} дээр ажиллагаа явагдаж байна. Дуусахыг хүлээх, эсвэл цуцлана уу.`,
    attemptExists: (attempt: number, reference: string) =>
      `${reference}-ийн ${attempt}-р оролдлого аль хэдийн байна`,
    notRunYet: (reference: string) =>
      `${reference} хараахан ажиллаагүй — дахин ажиллуулахын оронд эхлүүлнэ үү.`,
    attemptIs: (attempt: number, reference: string, status: string) =>
      `${reference}-ийн ${attempt}-р оролдлого ${status}.`,
    nothingToPause: (status: string) => `Энэ оролдлого ${status} — түр зогсоох юу ч байхгүй.`,
    noSuchKind: (kind: string) => `тийм ${kind} байхгүй`,
    noArtifactToEdit: (path: string) => `энэ ажиллагаанд засах ${path} байхгүй`,
    accountExists: 'Энэ ажлын талбарт бүртгэл аль хэдийн байна. Администратороос урилга хүсээрэй.',
    adminOnlySettings: 'зөвхөн администратор ажлын талбарын тохиргоог өөрчилнө',
    belongsToSomeoneElse: (what: string) =>
      `${what} өөр хүнд харьяалагдана — та хэрэглэж болох ч өөрчилж болохгүй`,
    checkpointNotYours: 'энэ хяналтын цэгийг та шийдэхгүй',
    hostNotSupported: (hostname: string) =>
      `${hostname}-ийг дэмжихгүй. Энэ хувилбар нь GitLab.com ба GitHub.com дээр байрлах репозиториудыг холбоно.`,
    tokenExpiredOrScope:
      'Токен хугацаа дууссан, эсвэл төсөл нь түүний хүрээнээс гадуур байж магадгүй.',
    fileNotText: (name: string) => `${name} нь текстээр уншиж болох төрөл биш.`,
    noPinnedVersion: 'энэ даалгаварт бэхлэгдсэн дамжлагын хувилбар байхгүй тул эхлэх боломжгүй',
    noStoredCredential: (repository: string) => `${repository}-д хадгалсан мэдээлэл байхгүй`,
    versionGone: (version: number) => `дамжлагын ${version}-р хувилбар байхгүй болсон`,
    workspaceNotConfigured: 'ажлын талбар тохируулагдаагүй байна',
  },

  login: {
    headline: 'Даалгавраас нэгтгэх хүсэлт хүртэл — автоматаар',
    oneLiner:
      'Репозиториео холбож, өөрчлөлтөө бичээд өгнө. Агентууд тодорхойлолт бичиж, интерфейсийг pen.dev дээр зурж, төлөвлөөд хэрэгжүүлж, нэгтгэх хүсэлт нээнэ. Хүссэн газраа хяналтын цэг тавьж болно.',
    /** The pipeline, as the hero draws it; `flowDesign` is the step it lights up. */
    flow: ['Даалгавар', 'Тодорхойлолт', 'Дизайн · pen.dev', 'Төлөвлөгөө', 'Хөгжүүлэлт', 'MR'],
    flowDesign: 'Дизайн · pen.dev',
    flowLabel: 'Даалгавар хэрхэн нэгтгэх хүсэлт болдог',
    foot: (year: number) => `© ${year} Netgroup · Claude CLI ба pen.dev дээр ажилладаг`,
    signIn: 'Нэвтрэх',
    signInLede: 'Ажлын бүртгэлээрээ үргэлжлүүлнэ үү.',
    createFirstAccount: 'Эхний бүртгэлийг үүсгэх',
    firstAccountLede:
      'Энд хэн ч бүртгэлгүй байна. Эхнийх нь администратор болно — холболтуудыг тохируулж, мэдээллийг хадгалж, бусдыг урьж чадна.',
    yourName: 'Таны нэр',
    optional: 'Заавал биш',
    email: 'Ажлын имэйл',
    password: 'Нууц үг',
    passwordHint: (minimum: number) =>
      `Дор хаяж ${minimum} тэмдэгт — энэ бүртгэл хадгалагдсан бүх мэдээллийг уншиж чадна.`,
    createAccountAndSignIn: 'Бүртгэл үүсгээд нэвтрэх',
    continueWith: (provider: string) => `${provider}-аар үргэлжлүүлэх`,
    or: 'эсвэл имэйлээр',
    signInNote: 'Нэвтэрснээр юу ч холбогдохгүй. Репозиториео дараагийн алхамд нэмнэ.',
  },
};
