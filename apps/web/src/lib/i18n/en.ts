/**
 * English — the language the screens were written in before the design was
 * translated, kept so the catalogue layer holds more than one language and is
 * therefore actually a catalogue.
 *
 * `Messages` is `typeof mn`, so this file cannot omit a word Mongolian has,
 * cannot add one it does not, and cannot disagree about what a phrase's
 * arguments are. That is the whole guarantee: `bun run check` is what tells you
 * a translation is incomplete.
 */

import type { Messages } from './index';
import type { TimeUnit } from './mn';

const ENGLISH_RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export const en: Messages = {
  app: {
    name: 'Code Factory',
  },

  nav: {
    section: 'Main',
    dashboard: 'Dashboard',
    repositories: 'Repositories',
    tickets: 'Tickets',
    pipelines: 'Pipelines',
    agents: 'Agents',
    skills: 'Skills',
    settings: 'Settings',
  },

  frame: {
    workspace: (name: string) => `${name} workspace`,
    searchLabel: 'Search tickets and repositories',
    searchPlaceholder: 'Search tickets, repos...',
    approvalsBell: 'Runs waiting for your approval',
    newTicket: 'New ticket',
  },

  topNav: {
    label: 'Main menu',
    home: 'Code Factory — to the dashboard',
    dashboard: 'Dashboard',
    tickets: 'Tickets',
    repositories: 'Repositories',
    pipelines: 'Pipelines',
    agents: 'Agents',
    skills: 'Skills',
    search: 'Search',
    searchLabel: 'Search tickets',
    newTicket: 'New ticket',
    settings: 'Settings',
    account: (name: string) => `${name} — your account`,
  },

  stepBar: {
    label: (at: number, total: number) => `Step ${at} of ${total}`,
    count: (at: number, total: number) => `${at}/${total} steps`,
  },

  defaults: {
    agents: {
      spec: {
        name: 'Spec',
        step: 'Spec',
        running: 'Writing the specification',
        description: 'Turns a ticket into a specification.',
      },
      design: {
        name: 'Design',
        step: 'Design · pen.dev',
        running: 'Drawing in pen.dev',
        description: 'Produces screens before any code is planned.',
      },
      plan: {
        name: 'Plan',
        step: 'Plan',
        running: 'Planning',
        description: 'Turns a specification into an approach.',
      },
      tasks: {
        name: 'Tasks',
        step: 'Tasks',
        running: 'Breaking the plan into tasks',
        description: 'Turns a plan into ordered, verifiable tasks.',
      },
      implement: {
        name: 'Implement',
        step: 'Implement',
        running: 'Implementing',
        description: 'Writes the code and leaves the tests passing.',
      },
    },
    pipelines: {
      quickFix: {
        name: 'Quick fix',
        description: 'No checkpoints. For small, well-described changes you trust unattended.',
      },
      standard: {
        name: 'Standard',
        description: 'One checkpoint, after the plan, before any code is written.',
      },
      reviewHeavy: {
        name: 'Review-heavy',
        description: 'A checkpoint after the specification, the plan, and the implementation.',
      },
    },
    designRunning: 'Drawing in pen.dev',
    running: (name: string) => `${name} is running`,
  },

  time: {
    justNow: 'just now',
    unknown: 'at an unknown time',
    // `Intl` does speak English, so English keeps the phrasing it always had.
    ago: (n: number, unit: TimeUnit) => ENGLISH_RELATIVE.format(-n, unit),
    in: (n: number, unit: TimeUnit) => ENGLISH_RELATIVE.format(n, unit),
    duration: (minutes: number, seconds: number) =>
      minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`,
  },

  dashboard: {
    loading: 'Loading…',
    ticketsTitle: 'Tickets',
    ticketsSub: 'Every ticket runs its own pipeline — each segment is one step of it',
    viewAll: 'View all →',
    groups: {
      inProgress: 'In progress',
      needsAttention: 'Needs attention',
      queued: 'Queued',
      done: 'Done',
    },
    groupCount: (group: string, n: number) => `${group}: ${n}`,
    more: (n: number) => `${n} more — open the board →`,
    nothing: 'Nothing is running or waiting right now.',
    status: {
      running: (phrase: string, elapsed: string | null) =>
        elapsed ? `${phrase} · ${elapsed}` : phrase,
      openingMergeRequest: 'Opening the merge request',
      waiting: 'Waiting for your approval',
      failed: (reason: string) => `${reason} · see why`,
      failedNoReason: 'Failed',
      queuedAt: (position: number) => `Queued · position ${position}`,
      queuedNext: 'Queued · starting shortly',
      mergeRequestOpened: (reference: string) => `MR ${reference} opened · a person decides`,
      done: 'Done · a person decides',
    },
    elapsed: (minutes: number) =>
      minutes < 1
        ? 'just started'
        : minutes < 60
          ? `${minutes} min`
          : `${Math.floor(minutes / 60)} h ${minutes % 60} min`,
    firstAttempt: {
      label: 'Succeeded on the first attempt',
      counted: (successes: number, counted: number) =>
        `last 30 days · ${successes} of ${counted} tickets`,
      nothing: 'Nothing to measure yet',
      nothingYet: 'no ticket of the last 30 days has a known outcome yet',
    },
    week: {
      title: 'Merge requests',
      sub: 'opened in the last 7 days',
      weekdays: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
      today: 'today',
      day: (weekday: string, n: number) =>
        `${weekday}: ${n} ${n === 1 ? 'merge request' : 'merge requests'}`,
      tokensToday: "Today's tokens",
      tokensNote: 'tokens processed by the steps that finished today',
    },
    missing: {
      'the runner address': 'the runner address',
      'a model credential': 'a model credential',
      'a connected repository': 'a connected repository',
    } as Record<string, string>,
    listJoin: ', ',
    listLast: ' and ',
    notReady: (missing: string) => `Nothing can run yet: this workspace still needs ${missing}.`,
    setUpBefore: 'Set that up in ',
    setUpAfter: '.',
    askAdministrator:
      'Ask an administrator — workspace connections and credentials are theirs to set (FR-004).',
  },

  approvals: {
    heading: 'Your approval is needed',
    sub: 'An agent finished its work and is waiting for you',
    approve: 'Approve',
    review: (reference: string, title: string) => `Review ${reference} ${title}`,
    ready: (ago: string) => `ready ${ago}`,
  },

  provider: {
    mergeRequests: 'merge requests',
    pullRequests: 'pull requests',
    tokenPageNote: {
      gitlab: 'Opens with the name and scopes already filled in — set an expiry and create it.',
      github:
        'Opens a classic token with `repo` ticked, which covers all three permissions above. ' +
        'A fine-grained token works too, but GitHub cannot pre-select its permissions from a link.',
    },
  },

  repositories: {
    statConnected: 'Connected repositories',
    byProvider: (gitlab: number, github: number) => `${gitlab} GitLab · ${github} GitHub`,
    statActive: 'Active tickets',
    onRepositories: (n: number) => `on ${n} ${n === 1 ? 'repository' : 'repositories'}`,
    statAttention: 'Needs attention',
    attentionOf: (name: string, why: string) => `${name} — ${why.toLowerCase()}`,
    allWell: 'all well',
    pipelineChip: (pipeline: string) => `${pipeline} pipeline`,
    lastWork: 'LATEST WORK',
    noTicketsYet: 'No tickets yet',
    activeTickets: 'active tickets',
    doneCount: (n: number) => `${n} done`,
    tokenExpiredBlocks: 'Token expired — no new ticket can start',
    replaceTokenShort: 'Replace token',
    heading: 'Connected repositories',
    lede: 'Each ticket belongs to one repository. Connect a repo to start creating tickets for it.',
    loading: 'Loading repositories…',
    empty: 'No repositories connected yet. Connect one to create your first ticket.',
    colRepository: 'Repository',
    colProvider: 'Provider',
    colBranch: 'Default branch',
    colPipeline: 'Default pipeline',
    colTickets: 'Tickets',
    colStatus: 'Status',
    actions: 'Actions',
    actionsFor: (repository: string) => `Actions for ${repository}`,
    noPipeline: 'None — a ticket picks one',
    ticketCounts: (running: number, done: number) => `${running} running · ${done} done`,
    connected: 'Connected',
    tokenExpired: 'Token expired',
    error: 'Error',
    changePipeline: 'Change the default pipeline',
    replaceToken: 'Replace the access token',
    setHowItStarts: 'Set how it starts',
    disconnect: 'Disconnect',
    pipelineForNew: 'Pipeline for new tickets',
    startCommand: 'Start command',
    startPort: 'Port it listens on',
    startHint:
      'Leave both empty to detect from package.json. The command runs inside the sandbox with PORT and HOST set; the server has to listen on 0.0.0.0.',
    saving: 'Saving…',
    save: 'Save',
    newToken: 'New access token',
    tokenHint: (requests: string) =>
      `It needs to read the repository, push branches and open ${requests}. Stored encrypted and never shown again — not even to you.`,
    storing: 'Storing…',
    storeNewToken: 'Store the new token',
  },

  connect: {
    open: 'Connect repository',
    heading: 'Connect a repository',
    lede: (requests: string) =>
      `The factory needs permission to read code, push branches and open ${requests}.`,
    close: 'Close',
    stepProvider: 'Choose provider',
    chosen: 'Selected',
    stepUrl: 'Repository URL',
    stepToken: 'Access token',
    stepPipeline: 'Default pipeline for new tickets',
    scopes: (scopes: string) =>
      `Needs scopes: ${scopes}. Stored encrypted and never shown again — not even to you.`,
    scopesLoading: 'Loading the required permissions…',
    createOne: (provider: string) => `Create one on ${provider} →`,
    noPipeline: 'None — each ticket picks one',
    cancel: 'Cancel',
    testing: 'Testing…',
    testAndConnect: 'Test & connect',
  },

  board: {
    heading: 'Tickets',
    lede: (n: number) =>
      `${n} ${n === 1 ? 'ticket' : 'tickets'} · by state. Every ticket runs its own pipeline.`,
    column: (column: string, n: number) => `${column}: ${n}`,
    loading: 'Loading tickets…',
    searchingBefore: 'Showing tickets matching ',
    searchingAfter: '.',
    clearSearch: 'Clear the search',
    repository: 'Repository',
    allRepositories: 'All repositories',
    pipeline: 'Pipeline',
    anyPipeline: 'Any pipeline',
    creator: 'Creator',
    createdByAnyone: 'Created by anyone',
    boardView: 'Board view',
    listView: 'List view',
    noMatch: 'No tickets match.',
    createOne: 'Create one',
    backlog: 'Queued',
    running: 'Running',
    waitingApproval: 'Waiting approval',
    done: 'Done',
    failed: 'Failed',
    newTicket: 'New ticket',
    colTicket: 'Ticket',
    colRepository: 'Repository',
    colPipeline: 'Pipeline',
    colStatus: 'Status',
  },

  ticketCard: {
    unknown: 'unknown',
    changesInterface: 'Changes the interface',
    approve: (step: string) => `${step} needs approval`,
    mergeRequestOpened: (reference: string) => `MR ${reference} opened`,
    done: 'Done',
    cancelled: 'Cancelled',
    readyToStart: 'Ready to start',
    createdBy: (name: string) => `Created by ${name}`,
  },

  strip: {
    notStarted: 'Not started',
    mergeRequestOpened: 'Merge request opened',
    runFailed: 'The run failed',
    aStep: 'A step',
    needsApproval: (step: string) => `${step} needs your approval`,
    atStep: (step: string, index: number, total: number) => `${step} · step ${index} of ${total}`,
    waitingToStart: 'Waiting to start',
  },

  newTicket: {
    heading: 'Describe what you want built',
    crumb: 'You are here',
    repository: 'Repository',
    required: 'Required',
    chooseRepository: 'Choose a repository…',
    tokenExpiredSuffix: ' — token expired',
    title: 'Title',
    titlePlaceholder: 'Add Apple Sign-In next to Google login',
    description: 'Description',
    descriptionHint:
      'Plain language is fine. The Spec agent will ask itself the clarifying questions.',
    descriptionPlaceholder: 'What should change, and why?',
    acceptance: 'Acceptance criteria',
    acceptanceHint: 'One per line. The Implement agent must make all of these pass.',
    acceptancePlaceholder:
      'Apple button visible on /login for all users\nSuccessful sign-in creates or links a user record',
    files: 'Requirement documents',
    filesHint: 'Optional. Text, Markdown or CSV — every agent step reads them as the brief.',
    pipeline: 'Pipeline',
    pipelineHint: 'Changes the steps of this ticket only',
    stepCount: (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`,
    pipelineSteps: (pipeline: string, n: number) => `${pipeline} pipeline · ${n} steps`,
    condition: {
      always: '',
      ticket_has_ui: 'If the interface changes',
      ticket_has_no_ui: 'If the interface does not change',
    },
    onPen: (model: string) => `pen.dev · ${model}`,
    noVerification:
      'This pipeline has no verification step, so nothing beyond the implementing agent will check the result. Add a shell step running your tests to change that.',
    defaultFor: (repository: string) => `${repository}'s default`,
    version: (version: number) => `Version ${version}`,
    queuedNotStartedBefore: (reference: string) =>
      `${reference} was created and is queued, but has `,
    queuedNotStartedAfter: (detail: string) =>
      `: the orchestrator could not be reached (${detail}). It will be retried.`,
    notStarted: 'not started',
    started: (reference: string) => `${reference} started.`,
    savedAsDraft: (reference: string) => `${reference} saved as a draft.`,
    estimateMeasured: (tokens: string, minutes: string | number) =>
      `About ≈ ${tokens} tokens · usually ${minutes} min`,
    estimateCeiling: (ceilingMinutes: string | number) =>
      `No comparable run yet · up to ${ceilingMinutes} min`,
    estimateUnknown: 'Choose a repository and a pipeline to see an estimate.',
    saveAsDraft: 'Save as draft',
    creating: 'Creating…',
    createAndStart: 'Create & start pipeline',
    whatWillHappen: 'What will happen',
    chooseToSeeSteps: 'Choose a repository and a pipeline to see the steps that will run.',
    workingOutSteps: 'Working out the steps…',
    openMergeRequest: 'Open merge request',
    openMergeRequestNote: 'Branch pushed, merge request created, ticket closed',
    testsBeforeMr: 'This pipeline runs your tests before opening the merge request.',
    tip: 'The Spec agent decides whether this ticket touches the interface. If it does, the Design step runs and you review the screens before any code is written.',
  },

  run: {
    stepDidNotFinish: (step: string, n: number) => `${step} — step ${n} did not finish`,
    runDidNotFinish: 'This run did not finish',
    spentOfCeiling: (spent: string, ceiling: string) => `Spent $${spent} of a $${ceiling} ceiling.`,
    producedStillReadable: (paths: string) =>
      `A retry starts again from the ticket, but what this attempt produced is still readable: ${paths}.`,
    tabOutput: 'Output',
    tabArtifacts: 'Artifacts',
    tabLaunch: 'Run it',
    tabRequirements: 'Requirements',
    tabDetails: 'Run details',
    runView: 'Run view',
    loading: 'Loading the run…',
    notStarted: 'This ticket has not been started yet.',
    draftNote: 'Saved as a draft. Nothing runs until you start it.',
    startTicket: 'Start',
    starting: 'Starting…',
    startQueued:
      'Queued, but the execution service did not answer, so it has not started yet. It will be tried again.',
    startFailed: (detail: string) => `Could not start it: ${detail}`,
    statusQueued: 'Queued',
    statusRunning: 'Running',
    statusWaitingApproval: 'Waiting for approval',
    statusOpeningMr: 'Opening merge request',
    statusDone: 'Done',
    statusFailed: 'Failed',
    statusCancelled: 'Cancelled',
    statusAtStep: (status: string, step: string) => `${status} · ${step}`,
    whatTheStepReported: 'What the step itself reported',
    editAndRetry: 'Edit and retry',
    title: 'Title',
    description: 'Description',
    acceptanceOnePerLine: 'Acceptance criteria, one per line',
    discard: 'Discard',
    saveAndRetry: 'Save & retry',
    reconnectingTitle: 'Reconnecting to the live stream',
    reconnecting: 'reconnecting…',
    connecting: 'connecting…',
    review: 'Review',
    continue: 'Continue',
    pause: 'Pause',
    continueRunTitle:
      'If nothing has happened for a while, drive the run again from its first unfinished step. Finished steps and their tokens are kept. Only for a run that is stuck: a step still running would run twice.',
    continueRun: 'Continue run',
    cancelRun: 'Cancel run',
    continueFromFailedTitle:
      'Run again from the step that failed. Finished steps and their tokens are kept.',
    continueFromFailed: 'Continue from the failed step',
    retry: 'Retry',
  },

  ticketHead: {
    tickets: 'Tickets',
    where: 'You are here',
    noBranch: 'no branch yet',
    createdBy: (name: string) => `Created by ${name}`,
    started: (ago: string) => `Started ${ago}`,
    soFar: (tokens: string) => `${tokens} tokens so far`,
    elapsed: 'elapsed',
    tokensUsed: 'tokens used',
    pipeline: (pipeline: string, steps: number) => `${pipeline} · ${steps} steps`,
  },

  runResults: {
    heading: 'Results',
    count: (n: number) => `${n} ${n === 1 ? 'output' : 'outputs'}`,
    screens: (n: number) => `${n} ${n === 1 ? 'screen' : 'screens'}`,
    screensFrom: 'ui.pen + exports · pen.dev',
    commits: (n: number) => `${n} ${n === 1 ? 'commit' : 'commits'}`,
    mergeRequest: (reference: string) => `Merge request ${reference}`,
    mergeRequestOpened: 'opened · a person decides',
    mergeRequestPending: 'waiting · a person decides',
  },

  queue: {
    position: (position: number, cap: number | null) =>
      `Waiting for a free sandbox — position ${position} in the queue${cap ? `, which holds ${cap} at once` : ''}.`,
  },

  stepTracker: {
    label: (n: number) => `The run's ${n} steps`,
    stepLabel: (n: number, name: string, detail: string) => `Step ${n} — ${name}, ${detail}`,
    mergeRequest: 'Merge request',
    opened: 'opened',
    waiting: 'waiting',
    done: 'done',
    running: 'running',
    runningFor: (took: string) => `${took} · running`,
    waitingForYou: 'your approval',
    skipped: 'skipped',
    failed: 'failed',
    skippedBecause: (step: string, reason: string) => `${step} skipped — ${reason}.`,
  },

  liveLog: {
    couldNotLoad: 'Could not load the output.',
    stepNotStarted: 'This step has not started.',
    noOutput: 'No output yet.',
    live: 'LIVE',
    jumpToLatest: 'Jump to latest',
    loadingOutput: 'Loading output…',
    skipped: (reason: string) => `Skipped — ${reason}.`,
    liveOutput: (step: string) => `${step} live output`,
    newLines: (lines: number) => `${lines} new line${lines === 1 ? '' : 's'}`,
  },

  runDetails: {
    heading: 'Run details',
    pipeline: 'Pipeline',
    repository: 'Repository',
    branch: 'Branch',
    sandbox: 'Sandbox',
    execution: 'Execution',
    tokens: 'Tokens',
    time: 'Time',
    changesInterface: 'Changes the interface',
    noInterfaceChange: 'No interface change',
    run: 'Run',
    attemptOrdinal: (attempt: number) => {
      const suffix = attempt === 1 ? 'st' : attempt === 2 ? 'nd' : attempt === 3 ? 'rd' : 'th';
      return `(${attempt}${suffix} attempt)`;
    },
    notCreated: 'not created',
    notStarted: 'not started',
    timeCap: (minutes: string | number) => `${minutes} min cap per step`,
    classificationMissing:
      'The specification step recorded no decision about the interface, so design was skipped. Check whether this ticket needed screens.',
  },

  approve: {
    cancelExplain: 'Cancelling releases the sandbox and leaves the branch pushed so far alone.',
    timelineStep: (step: string, status: string, took: string | null) =>
      took ? `${step} ${status} · ${took}` : `${step} ${status}`,
    timelineStepN: (n: number) => `step ${n}`,
    stepStatus: {
      pending: 'pending',
      running: 'running',
      done: 'done',
      failed: 'failed',
      skipped: 'skipped',
    },
    timelineSkipped: (reason: string) => `skipped — ${reason}`,
    decision: {
      approved: 'approved',
      changes_requested: 'changes requested',
      edited: 'edited and approved',
      cancelled: 'cancelled',
    },
    timelineDecision: (decision: string, timedOut: boolean) =>
      timedOut ? `Checkpoint ${decision} on timeout` : `Checkpoint ${decision}`,
    loading: 'Loading…',
    notStarted: 'This ticket has not been started.',
    loadingCheckpoint: 'Loading the checkpoint…',
    waitingForYourApproval: 'Waiting for your approval',
    decided: 'Decided',
    cancelRun: 'Cancel run',
    backToTheRun: 'Back to the run',
    checkpointReview: (what: string, when: string) => `Checkpoint: review ${what} ${when}`,
    checkpointThis: 'this',
    checkpointThe: (label: string) => `the ${label}`,
    beforeAnyCode: 'before any code is written',
    beforePipelineContinues: 'before the pipeline continues',
    thePreviousStep: 'The previous step',
    pausedExplain: (label: string, step: number) =>
      `${label} finished. The pipeline is paused at step ${step} (held by the execution service) until you approve, ask for changes, or edit the document yourself. Cancelling instead releases the sandbox and leaves the branch alone.`,
    alreadyDecided: (decision: string) => `Already decided: ${decision}`,
    decidedAt: (at: string) => `On ${at}. Nothing is waiting here.`,
    notAtCheckpoint: 'This run is not waiting at a checkpoint',
    nothingToDecide: 'Nothing here needs deciding.',
    notYoursToDecide: 'This checkpoint is not yours to decide. You can read everything here.',
    requestChanges: 'Request changes',
    approveAndContinue: 'Approve & continue',
    followsDesign: 'This checkpoint follows a design step.',
    reviewTheScreens: 'Review the screens',
    toSeeFullSize: 'to see them at full size.',
    edited: 'edited',
    rendered: 'Rendered',
    source: 'Source',
    edit: (name: string) => `Edit ${name}`,
    screens: 'Screens',
    noDocuments: 'No documents yet — the screens above are what exists so far.',
    discardChanges: 'Discard changes',
    saveAndContinue: 'Save & continue',
    savingNote:
      'Saving writes a new version. The previous one is kept, and every step after this reads the version you saved.',
    empty: '(empty)',
    version: (version: number) => `Version ${version}`,
    chooseDocument: 'Choose a document to read it.',
    sentBackTo: (label: string, what: string) =>
      `Your note goes back to ${label}, the ${what} is revised, and the run stops here again.`,
    theWork: 'work',
    theAgent: 'the agent',
    feedbackLabel: 'Request changes — this text is sent to the agent',
    feedbackPlaceholder: 'What should change, and why?',
    sendBackTo: (label: string) => `Send back to ${label}`,
    acceptance: 'Acceptance criteria',
    noAcceptance: 'None were given. That is the biggest quality lever there is.',
    classifiedAs: (kind: string, rationale: string) => `Classified as ${kind} — ${rationale}`,
    interfaceWork: 'interface work',
    notInterfaceWork: 'not interface work',
    timeline: 'Timeline',
    waitingForApproval: 'Waiting for approval',
    waitingForApprovalYou: ' (you)',
  },

  designReview: {
    loading: 'Loading…',
    loadingDesign: 'Loading the design…',
    checkpoint: 'Checkpoint: review the screens before any code is written',
    downloadSource: 'Download .pen',
    galleryNote: 'Each one opens at full size. Use the arrow keys to move between them.',
    notStarted: 'This ticket has not been started.',
    waitingForDesignApproval: 'Waiting for design approval',
    decided: 'Decided',
    cancelRun: 'Cancel run',
    backToTheRun: 'Back to the run',
    producedScreens: (screens: number) =>
      `The design step produced ${screens} screen${screens === 1 ? '' : 's'} with the pen.dev CLI.`,
    nothingImplemented: 'Nothing has been implemented yet.',
    approveToContinue: (next: string) => `Approve to continue to ${next}.`,
    alreadyDecided: (decision: string) => `Already decided: ${decision}`,
    decidedAt: (at: string) => `On ${at}. Nothing is waiting here.`,
    notAtCheckpoint: 'This run is not waiting at a design checkpoint',
    nothingToDecide: 'Nothing here needs deciding.',
    notYoursToDecide: 'This checkpoint is not yours to decide. You can read everything here.',
    requestChanges: 'Request changes',
    approveAndContinue: 'Approve & continue',
    screens: 'Screens',
    exported: (screens: number) => `${screens} exported`,
    openDesignSource: 'Open in pen.dev',
    sourceNotLinkable: (path: string) =>
      `${path} is committed to the branch; this repository's address is not one we can build a file link for.`,
    designedScreens: 'Designed screens',
    whyDesigned: 'Why this ticket was designed',
    decidedBySpec: (kind: string) => `Decided by the specification step · classified as ${kind}`,
    interfaceWork: 'interface work',
    notInterfaceWork: 'not interface work',
    classificationMissing:
      'The specification step produced no usable decision about whether this ticket changes the interface, so it was treated as not changing it.',
    noReason: 'No reason was recorded.',
    checkAgainst: 'Check the screens against',
    noAcceptance: 'None were given. That is the biggest quality lever there is.',
    revisedNotRedrawn: 'The design is revised rather than redrawn, and comes back here.',
    feedbackLabel: 'Request changes — this text is sent to the design tool',
    feedbackPlaceholder: 'What should change, and why?',
    sendBackToDesign: 'Send back to the design step',
    afterYouApprove: 'After you approve',
    openMergeRequest: 'Open merge request',
    openMergeRequestNote: 'Branch pushed, merge request created, ticket closed',
    stepCost: (took: string, tokens: string) =>
      `The design step took ${took} and processed ${tokens} tokens.`,
    stepTook: (took: string) => `The design step took ${took}.`,
  },

  agents: {
    heading: 'Agents',
    lede: 'Each agent runs with its own instructions, model, tools and skills. The Design agent runs on the pen.dev CLI; the rest run on the Claude CLI.',
    search: 'Search agents',
    loading: 'Loading agents…',
    noMatch: 'No agent matches. Create one below.',
    newAgent: 'New agent',
    name: 'Name',
    namePlaceholder: 'Reviewer',
    engine: 'Engine',
    codingAgent: 'Coding agent',
    designService: 'Design service',
    whatItIsFor: 'What it is for',
    descriptionPlaceholder: 'Reads a diff and objects',
    create: 'Create',
  },

  skills: {
    heading: 'Skills',
    new: 'New',
    lede: 'Reusable instruction files any agent can use. They are copied into .claude/skills/ for each run.',
    search: 'Search skills',
    loading: 'Loading skills…',
    empty: 'No skills yet.',
    noMatch: 'No skill matches that.',
    loadingOne: 'Loading…',
    pickOne: 'Pick a skill on the left, or start a new one.',
    newSkill: 'New skill',
    usedBy: (agents: number) => `Used by ${agents} agent${agents === 1 ? '' : 's'}`,
    agentCount: (agents: number) => `${agents} agent${agents === 1 ? '' : 's'}`,
    savedTo: 'Saved to .claude/skills/<name>/SKILL.md inside every run that uses it.',
    lastEdited: (when: string) => `· last edited ${when}`,
    by: (who: string) => `by ${who}`,
    shipped: '· shipped',
    ownedBy: (who: string) => `· owned by ${who}`,
    history: 'History',
    delete: 'Delete',
    createSkill: 'Create skill',
    saveSkill: 'Save skill',
    name: 'Name',
    descriptionLabel: 'Description (shown to the agent so it knows when to use this)',
    descriptionPlaceholder: 'Use before creating or moving files',
    loadingHistory: 'Loading history…',
    pickVersion: 'Pick a version to read what it said.',
    current: 'current',
    noHistory:
      'Nothing recorded yet — this skill predates the history, and the next save starts it.',
    content: 'Content (Markdown)',
    source: 'Source',
    preview: 'Preview',
    backToContent: 'Back to the content',
    putBack: (version: number) => `Put version ${version} in the editor`,
    putBackNotice: (version: number) =>
      `Version ${version} is in the editor. It is not saved until you save it, and saving it makes a new version rather than rewriting the old one.`,
    ready: (name: string) => `“${name}” is ready to attach to an agent.`,
    savedAs: (version: number) => `Saved as version ${version}.`,
    reaches: (agents: string) =>
      `${agents} will use it on the next run they start; runs already in flight are unaffected.`,
    deleted: 'Deleted.',
    deletedFrom: (agents: string) => `Deleted, and taken off ${agents}.`,
  },

  settings: {
    heading: 'Settings',
    lede: 'Workspace configuration. Only an administrator changes it.',
    loading: 'Loading settings…',
    testAll: 'Test every connection',
    runner: 'Runner',
    runnerLede:
      'The runner executes every ticket run and keeps its own queue. The app stores the data and shows the progress.',
    runnerAddress: 'Runner address',
    runnerToken: 'Access token',
    tokenHint: 'Used to start runs and to continue after a wait',
    tokenSetMasked: 'set · its value is never shown',
    tokenMissing: 'Not set — set it in the RUNNER_AUTH_TOKEN environment variable',
    callback: 'Callback (runner → app)',
    testHint:
      'A test tells reachable-and-authorised apart from unreachable and from refused, because those three need different fixes.',
    state: {
      reachable: 'Connected',
      unconfigured: 'Not set up',
      unreachable: 'Unreachable',
      unauthorised: 'Refused',
      wrong_shape: 'Another service',
    } as Record<string, string>,
    modelCredentialHint:
      "An API key, billed per use to an Anthropic Console account — or a Claude subscription token from `claude setup-token`, which draws on that subscription's own allowance instead. A subscription's limits are shaped around one person working, so watch them if several runs execute at once.",
    designStepNote:
      "A design step's model and export settings belong to the step, not here — set them on the step in the pipeline builder.",
    loadingMembers: 'Loading…',
    ticketsCreated: (n: number) => `${n} ticket${n === 1 ? '' : 's'}`,
    you: 'you',
    queueSummary: (executing: number, cap: number, waiting: number) =>
      `${executing} of ${cap} executing${waiting > 0 ? ` · ${waiting} waiting` : ''}`,
    unknownAuthor: 'unknown',
    executing: 'executing',
    position: (n: number) => `position ${n}`,
    invited: (email: string) => `${email} can sign in now.`,
    nowRole: (admin: boolean) => (admin ? 'Now an administrator.' : 'Now a member.'),
    accessRevoked: 'Access revoked.',
    ticketsStay: (n: number) =>
      `${n} ticket${n === 1 ? '' : 's'} they created stay${n === 1 ? 's' : ''}: that is the record of what happened.`,
    ownedTransferred: (n: number) =>
      `${n} pipeline${n === 1 ? '' : 's'}, agent${n === 1 ? '' : 's'} or skill${n === 1 ? '' : 's'} they owned are now yours.`,
    sections: 'Settings sections',
    workspace: 'Workspace',
    sandboxDocker: 'Sandbox (Docker)',
    claudeCliAndKeys: 'Claude CLI & keys',
    designPen: 'Design (pen.dev)',
    costLimits: 'Cost limits',
    members: 'Members',
    notifications: 'Notifications',
    containerHost: 'Container host',
    designService: 'Design service',
    configured: 'Configured',
    notSetUp: 'Not set up',
    adminOnly:
      'Workspace settings — credentials, connections, ceilings and membership — are for administrators. Everything else in Code Factory is not: pipelines, agents and skills go by who owns them, and anyone can make their own.',
    workspaceLede: 'One deployment, one workspace. Its name is what members see in the sidebar.',
    readyToRun: 'Ready to run',
    notReady: 'Not ready',
    cannotStart: (missing: string) =>
      `This workspace cannot start a run yet. Still needed: ${missing}.`,
    name: 'Name',
    sandboxHeading: 'Sandbox · Docker',
    sandboxLede: 'Each run gets one fresh container with the repo, Claude CLI and your toolchain.',
    containerHostAddress: 'Container host address',
    image: 'Image',
    processors: 'Processors',
    memoryMb: 'Memory, in megabytes',
    lifetimeMinutes: 'Lifetime, in minutes',
    retainFailedHours: "Keep a failed run's sandbox for, in hours",
    networkDuringImplement: 'Let a sandbox reach the network while code is being written',
    networkDuringImplementNote:
      'Needed by every agent and design step: the agent runs inside the sandbox and reaches the model over the network, so a run that has one of those steps is refused while this is off. Turn it off only for pipelines of shell steps, where a sandbox that cannot reach the network cannot send anything out.',
    costLimitsLede:
      "The ceilings a member's own limits cannot exceed. A limit somebody sets on their agent is capped at these, so it can only ever lower what a run may consume.",
    maxSpend: 'Most a run may spend, in dollars',
    maxTime: 'Longest a run may take, in minutes',
    maxConcurrent: 'Runs that may execute at once',
    testing: 'Testing…',
    testConnection: 'Test connection',
    save: 'Save',
    keysLede:
      'Stored encrypted, supplied to a run as environment, and never shown again — not even to you. Replacing one is the only way to change it.',
    oneIsStored: 'One is stored',
    noneYet: 'None yet',
    modelCredential: 'Model credential',
    pasteItHere: 'paste it here',
    store: 'Store',
    designHeading: 'Design · pen.dev',
    designLede:
      'Used only by design steps. Screens are exported as images and the .pen file is committed with the code.',
    signedIn: 'Signed in',
    designCredential: 'Design credential',
    storeDesignCredential: 'Store design credential',
    membersLede:
      'An administrator configures the workspace. Everything else — pipelines, agents, skills — goes by who owns it.',
    roleFor: (person: string) => `Role for ${person}`,
    member: 'Member',
    administrator: 'Administrator',
    remove: 'Remove',
    email: 'Email',
    role: 'Role',
    invite: 'Invite',
    notificationsLede: 'Who is told when a run needs a person, and how.',
    nothingToConfigure: 'Nothing to configure',
    approversNote:
      "A checkpoint decides who may approve it — anyone in the workspace, the ticket's author, or named people — on the step itself, in the pipeline builder. When a run reaches one, those people are resolved and recorded, and the notice is written to the application log.",
    notifyStepNote:
      "A pipeline's Notify step sends nothing yet: the run records it and carries on.",
    runsNow: 'Runs now',
  },

  pipelines: {
    lede: 'A pipeline is the order of steps a ticket goes through.',
    heading: 'Pipelines',
    loading: 'Loading pipelines…',
    empty: 'None yet. Create one below.',
    repositoriesUsing: (repositories: number) =>
      `· ${repositories} repositor${repositories === 1 ? 'y' : 'ies'}`,
    duplicate: 'Duplicate',
    newPipeline: 'New pipeline',
    name: 'Name',
    namePlaceholder: 'Reviewed before build',
    whatItIsFor: 'What it is for',
    descriptionPlaceholder: 'Everything customer-facing',
    create: 'Create',
  },

  pipeline: {
    loading: 'Loading the pipeline…',
    runsInFlight: (n: number) => `${n} ${n === 1 ? 'run' : 'runs'} in flight`,
    inFlightNote: (n: number) =>
      `${n} ${n === 1 ? 'run on this pipeline is' : 'runs on this pipeline are'} in flight. Saving does not affect ${n === 1 ? 'it' : 'them'}: each continues on the version it started with.`,
    toFix: (n: number) => `${n} ${n === 1 ? 'thing' : 'things'} to fix before this can be saved.`,
    willWrite: (version: number) => `Saving writes version ${version}.`,
    nothingToSave: 'Nothing to save.',
    saveAs: (version: number) => `Save as version ${version}`,
    saved: (version: number, inFlight: number) =>
      inFlight === 0
        ? `Saved as version ${version}.`
        : inFlight === 1
          ? `Saved as version ${version}. 1 run already in flight continues on the version it started with.`
          : `Saved as version ${version}. ${inFlight} runs already in flight continue on the versions they started with.`,
    duplicated: (name: string) => `Duplicated as “${name}”.`,
    breadcrumb: 'Pipelines',
    nameLabel: 'Pipeline name',
    rename: 'Rename this pipeline',
    usedBy: (repositories: number) =>
      `Used by ${repositories} repo${repositories === 1 ? '' : 's'}`,
    version: (version: number) => `Version ${version}`,
    dragHint:
      'Drag steps into the order you want. Add a checkpoint anywhere a human should look before the pipeline continues.',
    someoneElseOwns: 'Someone else owns this pipeline — you can use it, not change it.',
    shippedDefault: 'This is a shipped default — you can use it, not change it.',
    duplicate: 'Duplicate',
    testRun: 'Test run',
    preflightHeading: 'If a ticket started on this pipeline now',
    preflightNote: (version: number) => `Version ${version}, as saved. Nothing is started.`,
    workingItOut: 'Working it out…',
    estimateMeasured: (minutes: string | number, tokens: string, samples: number) =>
      `Comparable runs took about ${minutes} minutes and processed about ${tokens} tokens across ${samples} run${samples === 1 ? '' : 's'}. An estimate, not a commitment.`,
    estimateNone: (ceilingMinutes: string | number) =>
      `No comparable run yet, so there is nothing to estimate from. The time limit is ${ceilingMinutes} minutes.`,
    nothingVerifies: 'Nothing in this pipeline checks the result (FR-034a).',
  },

  stepKind: {
    agent: 'Agent step',
    design: 'Design step',
    checkpoint: 'Human checkpoint',
    shell: 'Shell command',
    notify: 'Notify',
    agentDetail: 'Run one of your agents via Claude CLI',
    designDetail: 'Draw screens with the pen.dev CLI',
    checkpointDetail: 'Pause until someone approves',
    shellDetail: 'Run a script in the sandbox (lint, build)',
    notifyDetail: 'Slack / email / webhook',
    implicitLast: 'Open merge request',
    implicitLastWhy: 'Every pipeline ends here. It is not a step you can move or remove.',
  },

  stepNode: {
    noAgentChosen: (kind: string) => `${kind} — no agent chosen`,
    writesDesign: (path: string) => `writes ${path}`,
    skills: (names: string) => `skills: ${names}`,
    conditional: 'Conditional',
    moveUp: (n: number) => `Move step ${n} up`,
    moveDown: (n: number) => `Move step ${n} down`,
    remove: (n: number) => `Remove step ${n}`,
    produces: (files: string) => `Produces ${files}`,
    writesTheCode: 'Writes the code',
    anyoneDecides: 'Anyone in the workspace decides',
    authorDecides: "The ticket's author decides",
    namedApprovers: (count: number) => `${count} named approver${count === 1 ? '' : 's'}`,
    timeout: (hours: number, then: string) => `${hours} h timeout, then ${then}`,
    autoContinue: 'auto-continue',
    runFails: 'the run fails',
    keepsWaiting: 'it keeps waiting',
    waitsIndefinitely: 'waits indefinitely',
    noCommandYet: 'no command yet',
    noChannelYet: 'no channel yet',
    stepLabel: (index: number, title: string) => `Step ${index} — ${title}`,
    custom: 'Custom',
    actionsFor: (index: number) => `Actions for step ${index}`,
  },

  builder: {
    trigger: 'Trigger: ticket created',
    insertAt: (n: number) => `Insert a step at position ${n}`,
    finish: 'Open merge request → close ticket',
    addAtEnd: 'Add a step at the end',
    addSequence: 'Add a step',
    addHint: 'Drag onto the canvas or click a + on a connector.',
    yourAgents: 'Your agents',
    noAgents: 'None yet.',
  },

  stepEditor: {
    whenRuns: 'When does this step run?',
    /** A step's condition in the editor, and inside a sentence that names it. */
    condition: {
      always: 'always',
      ticket_has_ui: 'only if this ticket changes the interface',
      ticket_has_no_ui: 'only if this ticket does not change the interface',
    },
    heading: (index: number, kind: string) => `Step ${index} — ${kind}`,
    close: (index: number) => `Close step ${index}`,
    agent: 'Agent',
    chooseAgent: 'Choose an agent…',
    outputFiles: 'Documents this step must produce, one per line',
    designSourcePath: 'Design source path',
    screensExportedTo: 'Where the screens are exported',
    whoMayDecide: 'Who may decide this checkpoint?',
    anyone: 'Anyone in the workspace',
    ticketAuthor: "The ticket's author",
    onlyNamed: 'Only the people I name',
    approvers: 'Approvers',
    timeoutHours: 'How long it waits, in hours',
    indefinitely: 'indefinitely',
    timeoutHint: 'Leave empty to wait until somebody decides.',
    whenExpires: 'When that time expires',
    keepWaiting: 'Keep waiting anyway',
    continueAsApproved: 'Continue as if approved',
    failTheRun: 'Fail the run',
    command: 'Command',
    channel: 'Channel',
    message: 'Message',
  },

  agentEditor: {
    loading: 'Loading the agent…',
    name: 'Name',
    default: 'Default',
    custom: 'Custom',
    edited: ' · edited',
    usage: (pipelines: number, runs: number) =>
      `${pipelines} pipeline${pipelines === 1 ? '' : 's'} · ${runs} run${runs === 1 ? '' : 's'}`,
    whatItIsFor: 'What it is for',
    changingIsFor: (who: string) => `Changing this one is for ${who}.`,
    anAdministrator: 'an administrator',
    itsOwner: 'its owner',
    changesApplyNote:
      'Changes apply to new runs only. Running tickets keep the version they started with.',
    resetTitle: 'Discard every change and go back to what shipped',
    alreadyShipped: 'This agent already matches what shipped',
    resetToDefault: 'Reset to default',
    saving: 'Saving…',
    saveChanges: 'Save changes',
    systemPrompt: 'System prompt',
    systemPromptNote: (file: string) =>
      `Written as ${file} before the CLI runs. Use {{variables}} for ticket data.`,
    designPromptNote:
      'Given to the design service before it runs. Use {{variables}} for ticket data.',
    allOf: (count: number) => `all ${count}`,
    engine: 'Engine',
    codingAgent: 'Coding agent',
    designService: 'Design service',
    model: 'Model',
    modelOption: (name: string, id: string) => (name === id ? id : `${name}  (${id})`),
    modelAndLimits: 'Model & limits',
    maxCost: 'Max cost per run',
    runsLimit: "the run's",
    noLimit: 'none',
    limitsNote:
      "Each is capped at what the run allows, so a limit here cannot raise what a ticket may consume. Leave one empty to use the run's.",
    noToolsForDesign:
      'Tool permissions do not apply to the design service, so there are none to set.',
    maxTime: 'Max time',
    maxTurns: 'Max turns',
    allowedTools: 'Allowed tools',
    allowedToolsNote: 'Passed to the CLI as --allowedTools',
    toolLabel: (name: string, what: string) => `${name} — ${what}`,
    skillsAttached: 'Skills attached',
    manageSkills: 'Manage skills →',
    removeSkill: (skill: string) => `Remove ${skill}`,
    add: 'Add',
    noSkillsYet: 'No skills yet — write one first.',
    holdsEverySkill: 'It already holds every skill.',
    none: 'None.',
  },

  launch: {
    heading: 'Run it',
    noBranchYet: 'This ticket has no branch yet.',
    afterPush: 'Available once the run has finished and pushed its branch.',
    atCheckpoint: 'Available once the run has finished; it is waiting at a checkpoint.',
    didNotFinish: 'The run did not finish, so the branch may not hold a working project.',
    afterAnyRun: 'Available once a run has finished.',
    didNotWork: 'That did not work.',
    running: 'Running',
    starting: 'Starting',
    didNotStart: 'It did not start.',
    setHowItStarts: 'Repositories → Set how it starts',
    stopped: 'Stopped.',
    runAgain: 'Run it again',
    commandFrom: (source: string) => `Command from ${source}.`,
    page: 'Page',
    requests: 'Requests',
    runningProject: 'The running project',
  },

  artifacts: {
    loading: 'Loading…',
    emptyDocument: '(empty)',
    documentLine: (purpose: string, version: number, step: number) =>
      `${purpose} · v${version} · step ${step}`,
    committed: (path: string) => `${path} committed`,
    heading: 'Artifacts',
    couldNotOpen: 'It could not be opened.',
    empty: 'Nothing produced yet.',
    purposeSpec: 'Requirements',
    purposePlan: 'Architecture & files to change',
    purposeTasks: 'Ordered tasks',
    purposeOther: 'Produced by the run',
    screens: 'Screens',
    opening: 'Opening…',
    openInPen: 'Open in pen.dev',
    onBranch: (branch: string) => `on ${branch}`,
    mergeRequest: 'Merge request',
    mergeRequestOpen: 'Review and merge on the provider, as usual',
    mergeRequestPending: 'Created when the last step finishes',
  },

  /** One agent's tile on artboard 09. */
  agentCard: {
    isDefault: 'Default',
    conditional: 'Conditional',
    custom: 'Custom',
    model: 'Model',
    tools: 'Tools',
    skills: 'Skills',
    engine: 'Engine',
    output: 'Output',
    penCli: 'pen.dev CLI',
    claudeCli: 'Claude CLI',
    designOutput: 'ui.pen + PNG screens',
    noTools: 'none — it can read nothing and write nothing',
    usage: (pipelines: number, runs: number) =>
      `In ${pipelines} pipeline${pipelines === 1 ? '' : 's'} · ${runs} run${runs === 1 ? '' : 's'}`,
    unused: 'Not used yet',
    inFlight: (n: number) => `${n} in flight`,
    edit: 'Edit',
    read: 'Read',
    duplicate: 'Duplicate',
    newSub: 'Add a step of your own to your pipelines',
  },

  /** A tool by its short name, where a list of them is shown. */
  toolName: {
    Read: 'Read',
    Write: 'Write',
    Edit: 'Edit',
    Glob: 'Find files',
    Grep: 'Search contents',
    Bash: 'Bash',
    WebFetch: 'WebFetch',
    GitPush: 'Git push',
  },

  /**
   * Tokens — what a step or a run processed, shown wherever the screens used to
   * show what it cost. The engine's own counts; `total` is all four added up.
   */
  tokens: {
    count: (compact: string) => `${compact} tokens`,
    breakdown: (input: string, output: string, cached: string) =>
      `in ${input} · out ${output} · cached ${cached}`,
  },

  owner: {
    sharedTitle: 'Available to everyone; administrators change it',
    shipped: 'Shipped',
    yours: 'Yours',
    youCanChange: 'You can change this',
    youCannotChange: 'You can use it, not change it',
    someoneElse: 'Someone else',
  },

  gallery: {
    position: (n: number, total: number) => `${n} of ${total}`,
    heading: 'Screens',
    empty: 'No screens were exported.',
    close: 'Close',
    previous: 'Previous screen',
    next: 'Next screen',
  },

  console: {
    method: 'Method',
    path: (baseUrl: string) => `Path, sent to ${baseUrl}`,
    sentTo: (baseUrl: string) => `Sent to ${baseUrl}`,
    headers: 'Headers, one per line',
    body: 'Body',
    truncated: 'Showing the first 256 KB.',
  },

  files: {
    heading: 'Requirements',
    remove: (file: string) => `Remove ${file}`,
    empty: 'Nothing attached. Agents work from the ticket text alone.',
    view: (file: string) => `Read ${file}`,
    loading: 'Loading…',
    gone: 'This file is no longer attached.',
    attach: 'Attach',
    removed: (file: string) => `${file} removed.`,
    alreadyGone: (file: string) => `${file} was already gone.`,
    runReadsOnce:
      'A run reads these once, when its sandbox is built. Changing them here affects the next attempt, not one already going.',
  },

  /**
   * What the person gave when they made the ticket, shown on the ticket
   * itself. It was written once, on the form, and nothing afterwards showed it.
   */
  brief: {
    heading: 'What was asked',
    empty: 'Nothing was written: no description and no criteria.',
    readDocuments: 'Read the documents',
  },

  markdown: {
    nothingToPreview: 'Nothing to preview yet.',
  },

  failure: {
    missingOutputWhat: 'The step finished without producing the document it was supposed to write.',
    missingOutputNext:
      'Usually the ticket did not give the agent enough to work from. Add detail to the description or the acceptance criteria, then retry.',
    budgetWhat: 'The run reached the most it was allowed to spend.',
    budgetNext:
      'Either the ticket is larger than the ceiling allows, or it needs narrowing. Split it, or raise the ceiling on the pipeline.',
    timeWhat: 'A step ran for longer than any one step is allowed to take.',
    timeNext:
      'The time ceiling applies to each step separately, so this is one step needing more time rather than the run as a whole. Give that agent a longer limit of its own, narrow the ticket, or raise the ceiling on the pipeline — which raises it for every step.',
    engineWhat: 'The model could not be reached.',
    retryOnly: 'Nothing is wrong with the ticket. Retry.',
    credentialInvalidWhat: 'A stored credential was rejected.',
    credentialInvalidNext:
      'An administrator needs to replace it in Settings before a retry can get further.',
    credentialMissingWhat: 'A credential this pipeline needs is not configured.',
    credentialMissingNext:
      'An administrator needs to add it in Settings before a retry can get further.',
    sandboxLostWhat:
      'The sandbox the step was running in disappeared, and the second attempt did not get further.',
    appUnreachableWhat:
      'The execution service could not reach this application to collect something the run needs.',
    appUnreachableNext:
      'Nothing is wrong with the ticket. Check that the execution service can reach the address in PUBLIC_BASE_URL, then retry.',
    runnerUnreachableWhat: 'This application could not reach the execution service.',
    runnerUnreachableNext:
      'Nothing is wrong with the ticket. Check the runner address in Settings and that the runner is running, then try again.',
    commandFailedWhat: 'A command the pipeline runs exited with an error.',
    commandFailedNext:
      'Read the step output to see which command and why. If it is the repository, fix that first.',
    notAuthorisedWhat: 'The run was refused access to something it needed.',
    notAuthorisedNext: 'Check the credential has the permissions the repository requires.',
    conflictWhat: 'Something changed underneath the run.',
    conflictNext: 'Retry — the run will take a fresh look.',
    notFoundWhat: 'Something the run expected to exist did not.',
    notFoundNext: 'Check the repository and branch still exist, then retry.',
    invalidInputWhat: 'The run was given something it could not use.',
    invalidInputNext: 'Read the detail below, correct the ticket, then retry.',
    unknownWhat: 'The run stopped without recording why.',
    unknownNext:
      'Retry. If it stops again the same way, the step output is the only place left to look.',
    gateExpiredWhat:
      'Nobody decided the checkpoint before it expired, and the gate was set to fail.',
    gateExpiredNext:
      'Retry, and decide the checkpoint this time — or change the gate to wait indefinitely.',
    ownSentenceNext: 'Retry, or edit the ticket first if the reason points at the ticket.',
    cancelledWhat: 'The run was cancelled. The branch it had pushed is still there.',
    cancelledNext: 'Retry when you want it to carry on.',
  },

  form: {
    signInRequired: 'you must be signed in',
    wholeNumber: 'Expected a whole number.',
    wholeNumberOrMore: 'Expected a whole number, zero or more.',
    agentName: 'Give the agent a name.',
    chooseModel: 'Choose a model.',
    pipelineName: 'Give the pipeline a name.',
    workspaceName: 'Give the workspace a name.',
    skillName: 'Give the skill a name.',
    skillContent: 'A skill needs content to apply.',
    ticketTitle: 'Give the ticket a title.',
    ticketTitleLong: 'Give the ticket a title — it becomes the merge request title.',
    personName: 'Give them a name.',
    chooseRepository: 'Choose a repository.',
    repositoryAddress: 'Paste the repository address.',
    accessToken: 'Paste an access token.',
    accessTokenFor: 'Paste an access token for this repository.',
    newAccessToken: 'Paste the new access token.',
    credential: 'Paste the credential.',
    notAnEmail: 'That does not look like an email address.',
    startCommandLength: 'Keep the start command under 500 characters.',
    portRange: 'The port has to be a whole number between 1 and 65535.',
    costCeiling: 'Set a cost ceiling.',
    timeCeiling: 'Set a time ceiling in whole minutes.',
    concurrency: 'Set how many runs may execute at once.',
    sandboxImage: 'Name the sandbox image.',
    processors: 'Set the processors as a whole number.',
    memory: 'Set the memory in whole megabytes.',
    lifetime: 'Set the sandbox lifetime in whole minutes.',
    retention: 'Set the retention in whole hours.',
    skillDescription: 'Say when an agent should apply this skill.',
    skillDescriptionLong:
      'Say when an agent should apply this skill. That sentence is what an agent reads to decide.',
    skillEmpty: 'A skill with no content gives an agent nothing to apply.',
    documentEmpty: 'The document cannot be emptied.',
    feedbackRequired: 'Say what should change — the feedback is what the agent reads.',
    notAStepOfThisRun: 'That is not a step of this run.',
    stepsUnreadable: 'The steps could not be read.',
    pathNotAddress: 'Type a path such as /api/items, not a full address.',
    zeroCost: 'A cost limit of zero would stop the step before it began.',
    zeroTime: 'A time limit of zero would stop the step before it began.',
    zeroTurns: 'A turn limit of zero would stop the step before it began.',
    zeroCostCeiling: 'A cost ceiling of zero would stop every run before it began.',
    zeroTimeCeiling: 'A time ceiling of zero would stop every run before it began.',
    atLeastOneRun: 'At least one run has to be able to execute.',
    atLeastOneProcessor: 'A sandbox needs at least one processor.',
    memoryTooSmall: 'A sandbox with under 512 MB cannot hold a toolchain.',
    zeroLifetime: 'A sandbox lifetime of zero would kill every run at the start.',
    negativeRetention: 'A retention period cannot be negative. Zero means release immediately.',
  },

  notice: {
    continuingFrom: (step: string, n: number) =>
      `Continuing from ${step} (step ${n}). Steps already finished are kept.`,
    couldNotHandBack: (detail: string) =>
      `Could not hand the run back to the execution service: ${detail}`,
    attemptStarted: (attempt: number) => `Attempt ${attempt} started.`,
    attemptNotBegun: (attempt: number, detail: string) =>
      `Attempt ${attempt} is queued but has not begun: ${detail}. It will be retried.`,
    updatedAttemptStarted: (attempt: number) => `Ticket updated, and attempt ${attempt} started.`,
    updatedAttemptNotBegun: (attempt: number, detail: string) =>
      `Ticket updated. Attempt ${attempt} is queued but has not begun: ${detail}.`,
    agentSaved: 'Saved. Runs already in flight are unaffected.',
    agentReset: 'Back to the configuration this agent shipped with.',
    agentDuplicated: (name: string) => `Duplicated as “${name}”, and it is yours to change.`,
    agentDeleted: (inFlight: number) =>
      inFlight === 0
        ? 'Deleted.'
        : `Deleted. ${inFlight} run${inFlight === 1 ? '' : 's'} still running will finish: each read this agent when it started and never looks again.`,
    settingsSaved: 'Saved. Runs already in flight keep the ceilings they started with.',
    credentialStored: 'Stored. It is encrypted at rest and never shown again.',
    alreadyPausing: 'This run is already pausing.',
    pausing: 'Pausing. The step running now will finish, and nothing further will start.',
    continuing: 'Continuing from where it stopped.',
    wasNotPaused: 'This run was not paused.',
    cancelled: 'Cancelled. The sandbox is released and the branch pushed so far is untouched.',
    alreadyFinished: 'This run had already finished.',
    openingInPen: 'Opening it in pen.dev.',
    designToolSilent: 'The execution service did not answer, so nothing was opened.',
    noAgentHoldsSkill: 'No agent holds this skill yet.',
    onlyFailedRetryable: 'Only a failed or cancelled attempt can be retried.',
  },

  error: {
    credentialsDoNotMatch: 'that email address and password do not match',
    passwordTooShort: (minimum: number) =>
      `Use at least ${minimum} characters. This account can read every credential the workspace stores.`,
    couldNotCreateAccount: 'could not create the account',
    noSuchAgent: 'no such agent',
    noSuchSkill: 'no such skill',
    noSuchTicket: 'no such ticket',
    noSuchRun: 'no such run',
    noSuchPipeline: 'no such pipeline',
    noSuchRepository: 'no such repository',
    noSuchPerson: 'no such person',
    noSuchLaunch: 'no such launch',
    noSuchArtifact: 'no such artifact',
    repositoryNotConnected: 'that repository is not connected',
    pipelineDoesNotExist: 'that pipeline does not exist',
    runHasNoTicket: 'that run has no ticket',
    couldNotCreateAgent: 'could not create the agent',
    couldNotCreateSkill: 'could not create the skill',
    couldNotCreateRun: 'could not create the run',
    couldNotInvite: 'could not invite them',
    skillNameTaken: (name: string) => `There is already a skill called “${name}”.`,
    cannotRemoveYourself: 'You cannot remove yourself. Ask another administrator.',
    runnerAddressMissing: 'The runner address is not set in Settings.',
    launchAlreadyRunning: 'This ticket is already running. Stop it first.',
    launchLostWithRestart: 'The execution service restarted, and the launch went with it.',
    noDefaultPipeline: (repository: string) =>
      `${repository} has no default pipeline. Choose one, or set a default on the repository.`,
    signInRequired: 'you must be signed in',
    accountNotCreated:
      'Could not create the account. The reason is in the application’s own output.',
    enterEmailAndPassword: 'Enter an email address and a password.',
    enterYourEmailAndPassword: 'Enter your email address and password.',
    couldNotSignIn: 'Could not sign you in just now.',
  },

  tools: {
    Read: 'Read a file in the repository',
    Write: 'Create a file',
    Edit: 'Change an existing file',
    Glob: 'Find files by name',
    Grep: 'Search file contents',
    Bash: 'Run a shell command — including the repository’s tests',
    WebFetch: 'Fetch a URL',
    GitPush: 'Push the branch when done',
  },

  /** What a connection check found, in words that say what to do (FR-005a). */
  connection: {
    unconfigured: 'Not configured yet.',
    reachable: 'Reachable, and it accepted our credential.',
    unreachable: 'Nothing answered at that address. Check the address, and that it is running.',
    unauthorised: 'It answered but refused our credential. Replace the credential.',
    wrongShape: 'Something answered, but not this service. Check the address.',
    answered: (status: number) => `It answered ${status}.`,
    timedOut: (ms: number) => `Nothing answered within ${ms}ms.`,
    noDesignCredential:
      'No design credential yet. That is only a problem for a pipeline containing a design step, which would fail at that step and say so.',
  },

  vocabulary: {
    reference: 'The ticket reference, like #142',
    acceptance: 'Its acceptance criteria, one per line',
    hasUi: 'Whether it changes the interface, once decided',
    repository: 'The repository name',
    defaultBranch: 'The branch it will merge into',
    attempt: 'Which attempt this is',
    screens: 'Paths of the designed screens, when a design step ran',
  },

  validate: {
    noCodeStepDeclares:
      'This pipeline has no step that writes code — every agent step here declares documents it produces.',
    noCodeStep: 'This pipeline has no step that writes code, so it cannot produce a merge request.',
    addAgentStep: 'Add an agent step, and put any verification, gate or notification after it.',
    noVerification:
      'This pipeline has no verification step, so nothing beyond the implementing agent will check the result.',
    addCodeStep:
      'Add an agent step with no required documents, and put any verification, gate or notification after it.',
    conditionTooEarly: (n: number, when: string) =>
      `Step ${n} runs ${when}, but whether the ticket changes the interface is not known yet at that point. Move it after the step that writes the specification.`,
    designTooEarly: (n: number) =>
      `Step ${n} is a design step, but it comes before the specification step that decides whether the ticket changes the interface. Move it after.`,
    noAgent: (n: number) => `Step ${n} has no agent chosen. Pick one, or remove the step.`,
    noApprovers: (n: number) =>
      `Step ${n} is a checkpoint whose approver list is empty, so nobody could ever decide it. Name someone, or let anyone in the workspace decide.`,
    timeoutTooShort: (n: number, hours: number) =>
      `Step ${n} waits ${hours} hours, which expires before anyone could look at it. Leave the waiting time empty to wait indefinitely.`,
    noCommand: (n: number) =>
      `Step ${n} is a shell command with no command, so it would pass without running anything. Give it the command this repository uses.`,
    noSteps: 'A pipeline needs at least one step. Add one from the palette.',
  },

  conflicts: {
    pipelineSavedElsewhere:
      'Someone else saved this pipeline while you were editing. Reload to see their changes.',
    noSuchStepToMove: 'there is no such step to move',
    noSuchStepToRemove: 'there is no such step to remove',
    couldNotDuplicatePipeline: 'could not duplicate the pipeline',
    couldNotCreatePipeline: 'could not create the pipeline',
    couldNotDuplicateAgent: 'could not duplicate the agent',
    skillDoesNotExist: 'one of those skills does not exist',
    notShipped:
      'This agent was created here rather than shipped, so there is no shipped configuration to go back to.',
    runInProgress: (reference: string) =>
      `${reference} already has a run in progress. Wait for it to finish, or cancel it.`,
    attemptExists: (attempt: number, reference: string) =>
      `attempt ${attempt} of ${reference} already exists`,
    notRunYet: (reference: string) =>
      `${reference} has not run yet — start it rather than retrying it.`,
    attemptIs: (attempt: number, reference: string, status: string) =>
      `attempt ${attempt} of ${reference} is ${status}.`,
    nothingToPause: (status: string) => `this attempt is ${status} — there is nothing to pause.`,
    noSuchKind: (kind: string) => `no such ${kind}`,
    noArtifactToEdit: (path: string) => `this run has no ${path} to edit`,
    accountExists: 'This workspace already has an account. Ask an administrator to invite you.',
    adminOnlySettings: 'only an administrator may change workspace settings',
    belongsToSomeoneElse: (what: string) =>
      `${what} belongs to someone else — you can use it but not change it`,
    checkpointNotYours: 'this checkpoint is not yours to decide',
    hostNotSupported: (hostname: string) =>
      `${hostname} is not supported. This version connects repositories hosted on GitLab.com and GitHub.com.`,
    tokenExpiredOrScope: 'The token may be expired or the project may be outside its scope.',
    fileNotText: (name: string) => `${name} is not a kind that can be read as text.`,
    noPinnedVersion: 'this ticket has no pinned pipeline version, so it cannot start',
    noStoredCredential: (repository: string) => `${repository} has no stored credential`,
    versionGone: (version: number) => `pipeline version ${version} no longer exists`,
    workspaceNotConfigured: 'the workspace is not configured',
  },

  login: {
    headline: 'From ticket to merge request — automatically',
    oneLiner:
      'Connect your repository and describe the change. Agents write the specification, draw the interface in pen.dev, plan and build it, and open a merge request. Put a checkpoint wherever you want one.',
    flow: ['Ticket', 'Spec', 'Design · pen.dev', 'Plan', 'Implement', 'MR'],
    flowDesign: 'Design · pen.dev',
    flowLabel: 'How a ticket becomes a merge request',
    foot: (year: number) => `© ${year} Netgroup · Runs on Claude CLI and pen.dev`,
    signIn: 'Sign in',
    signInLede: 'Continue with your work account.',
    createFirstAccount: 'Create the first account',
    firstAccountLede:
      'Nobody has an account here yet. This first one is the administrator — it can set the connections, store credentials and invite everybody else.',
    yourName: 'Your name',
    optional: 'Optional',
    email: 'Work email',
    password: 'Password',
    passwordHint: (minimum: number) =>
      `At least ${minimum} characters — this account can read every stored credential.`,
    createAccountAndSignIn: 'Create account and sign in',
    continueWith: (provider: string) => `Continue with ${provider}`,
    or: 'or with email',
    signInNote: 'Signing in connects nothing. You add your repositories in the next step.',
  },
};
