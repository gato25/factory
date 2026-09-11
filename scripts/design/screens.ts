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
      'Sign in',
      'Continue with',
      'GitLab',
      'GitHub',
      'Password',
      'Ticket',
      'Spec',
      'Plan',
      'Tasks',
      'Implement',
    ],
  },
  {
    // The frame every screen sits in: the sidebar and the top bar.
    artboard: '01 Dashboard',
    files: [`${APP}/+layout.svelte`],
    takes: [
      'Code Factory',
      'Dashboard',
      'Repositories',
      'Tickets',
      'Pipelines',
      'Agents',
      'Skills',
      'Settings',
      'Search tickets, repos...',
      'New ticket',
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
      'Connected repos',
      'Tickets running',
      'Waiting for approval',
      'Merge requests this week',
      'Active runs',
      'View all tickets',
      'Waiting for your approval',
      'Recent activity',
      'Review',
      'across',
      'needs your review',
    ],
  },
  {
    artboard: '02 Repositories',
    files: [`${APP}/repositories/+page.svelte`],
    takes: [
      'Connected repositories',
      'Each ticket belongs to one repository. Connect a repo to start creating tickets for it.',
      'Repository',
      'Provider',
      'Default branch',
      'Default pipeline',
      'Status',
      'Connected',
      'Token expired',
    ],
  },
  {
    artboard: '03 Connect Repository',
    files: [`${UI}/ConnectRepository.svelte`],
    takes: [
      'Connect a repository',
      'The factory needs permission to read code, push branches and open',
      '1. Choose provider',
      'GitLab',
      'GitHub',
      '2. Repository URL',
      '3. Access token',
      'Needs scopes:',
      '4. Default pipeline for new tickets',
      'Cancel',
      'Test & connect',
    ],
    omits: [
      {
        label: 'Self-hosted Git',
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
      'All repositories',
      'Any pipeline',
      'Created by anyone',
      'Backlog',
      'Running',
      'Waiting approval',
      'Done',
      'Failed',
      'needs your approval',
    ],
  },
  {
    artboard: '05 Create Ticket',
    files: [`${APP}/tickets/new/+page.svelte`],
    takes: [
      'Describe what you want built',
      'Repository',
      'Required',
      'Title',
      'Description',
      'Plain language is fine. The Spec agent will ask itself the clarifying questions.',
      'Acceptance criteria',
      'One per line.',
      'Pipeline',
      'Save as draft',
      'Create & start pipeline',
      'What will happen',
      'Open merge request',
      'Spec agent decides whether this ticket touches the interface',
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
    ],
    takes: [
      'Created by',
      'Started',
      'so far',
      'Pause',
      'Cancel run',
      'Merge request',
      'waiting',
      'live output',
      'LIVE',
      'Artifacts',
      'Run details',
      'Pipeline',
      'Sandbox',
      'n8n execution',
      'Budget',
      'cap',
    ],
  },
  {
    artboard: '07 Approval Checkpoint',
    files: [`${APP}/tickets/[id]/approve/+page.svelte`, `${UI}/TicketHead.svelte`],
    takes: [
      'Waiting for your approval',
      'Cancel run',
      'Checkpoint: review',
      'before any code is written',
      'n8n Wait node',
      'Request changes',
      'Approve & continue',
      'Edit',
      'Send back to',
      'Timeline',
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
      'Used by',
      'Drag steps into the order you want. Add a checkpoint anywhere a human should look before',
      'Duplicate',
      'Test run',
      'Trigger: ticket created (webhook → n8n)',
      'Open merge request',
      'Add a step',
      'Drag onto the canvas or click a + on a connector.',
      'Human checkpoint',
      'Pause until someone approves',
      'Design step',
      'Draw screens with the pen.dev CLI',
      'Agent step',
      'Run one of your agents via Claude CLI',
      'Shell command',
      'Run a script in the sandbox (lint, build)',
      'Notify',
      'Slack / email / webhook via n8n',
      'Your agents',
      'Custom',
    ],
  },
  {
    artboard: '09 Agents',
    files: [`${APP}/agents/+page.svelte`, `${UI}/AgentCard.svelte`],
    takes: [
      'Each agent runs with its own instructions, model, tools and skills. The Design agent runs on the pen.dev CLI; the rest run on the Claude CLI.',
      'Default',
      'Conditional',
      'Custom',
      'Model',
      'Tools',
      'Skills',
      'Used in',
      'Edit',
    ],
  },
  {
    artboard: '10 Agent Editor',
    files: [`${APP}/agents/[id]/+page.svelte`],
    takes: [
      'Changes apply to new runs only. Running tickets keep the version they started with.',
      'Reset to default',
      'System prompt',
      'Model & limits',
      'Model',
      'Max cost per run',
      'Max time',
      'Max turns',
      'Allowed tools',
      'Passed to the CLI as --allowedTools',
      'Skills attached',
      'Manage skills',
      'Add',
    ],
    omits: [
      {
        label: 'Test in sandbox',
        why: 'Nothing behind it exists — a run needs an orchestrator and a container host — and a button that does nothing is worse than no button.',
      },
    ],
  },
  {
    artboard: '11 Skills',
    files: [`${APP}/skills/+page.svelte`],
    takes: [
      'Reusable instruction files any agent can use. They are copied into .claude/skills/ for each run.',
      'Search skills',
      'Used by',
      'History',
      'Delete',
      'Save skill',
      'Name',
      'Description (shown to the agent so it knows when to use this)',
      'Content (Markdown)',
      'Preview',
    ],
  },
  {
    artboard: '12 Settings',
    files: [`${APP}/settings/+page.svelte`],
    takes: [
      'Workspace',
      'Orchestration (n8n)',
      'Sandbox (Docker)',
      'Claude CLI & keys',
      'Design (pen.dev)',
      'Cost limits',
      'Members',
      'Notifications',
      'Orchestration · n8n',
      'Every ticket run is executed by an n8n workflow. The app only stores data and',
      'Callback webhook (n8n → app)',
      'n8n posts step results and approvals here',
      'Test connection',
      'Sandbox · Docker',
      'Each run gets one fresh container with the repo, Claude CLI and your toolchain.',
      'Design · pen.dev',
      'Used only by design steps. Screens are exported as images and the .pen file is',
    ],
  },
  {
    artboard: '14 Design Review',
    files: [`${APP}/tickets/[id]/design/+page.svelte`, `${UI}/TicketHead.svelte`],
    takes: [
      'Waiting for design approval',
      'Cancel run',
      'Checkpoint: review the screens before any code is written',
      'Request changes',
      'Approve & continue',
      'Screens',
      'exported',
      'Why this ticket was designed',
      'Check the screens against',
      'After you approve',
    ],
    omits: [
      {
        label: 'Download .pen',
        why: 'The source is committed to the run’s branch rather than held by the app, so the honest affordance is a link to the provider’s view of that file (FR-064e).',
      },
      {
        label: 'Open in pen.dev',
        why: 'Same reason: we hold no pen.dev address for a file that lives in the repository, and would be guessing one.',
      },
    ],
  },
];
