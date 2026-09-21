/**
 * The skills that ship with a deployment (FR-043).
 *
 * A skill is a document the CLI loads ON DEMAND, when its description
 * matches what the agent is about to do. That is what makes it different
 * from the system prompt: the prompt is paid for on every turn of every
 * step, a skill only when it is needed. So a rule that applies always
 * belongs in the prompt, and a procedure that applies sometimes belongs
 * here — which also means the `description` is load-bearing. It is the only
 * part the model sees before deciding to read the rest.
 *
 * Every one of these was written against something a real run actually did:
 *
 *   - an Implement step spent most of a 45-minute limit starting dev servers
 *     on five ports and then downloading a browser, in a sandbox that has
 *     neither a display nor a browser;
 *   - it hand-wrote a parser for `docs/design/ui.pen` in `node -e`
 *     one-liners rather than reading the exports;
 *   - it probed for `jq`, `python3` and `bun`, found none, and worked
 *     around their absence for the rest of the step;
 *   - the three documents it had to read first came to 44 KB, every token
 *     of which is paid for by the step that reads them.
 *
 * None of them describes this product. They describe the sandbox and the
 * job, because that is what an agent inside one needs.
 */

export interface DefaultSkill {
  name: string;
  description: string;
  content: string;
  /** The shipped agents this is attached to, by slug. */
  agents: string[];
}

const SANDBOX = `# What is in this sandbox

One container per run, destroyed when the run ends. You are at \`/work\`,
which is a clone of the branch for this ticket.

## Present

- \`node\` and \`npm\` — the image is \`node:22-bookworm-slim\`
- \`git\`, configured and on the ticket's branch
- \`jq\`
- \`claude\` and \`pen\`, the two step engines

## Absent, and not worth looking for

- **Any browser.** No Chrome, no Chromium, no Playwright, no Puppeteer.
  There is also no display. Installing one costs several hundred megabytes
  and a large part of your time limit, and still cannot show you anything.
- \`python3\`, \`bun\`, \`make\`, \`docker\`
- Anything the project itself does not install

Check once with \`command -v <tool>\` if you must. Do not probe repeatedly,
and do not install a heavy dependency to work around an absence — say what
is missing and carry on without it.

## Network

Usually available, so \`npm install\` works. It is a setting per run and can
be off. If a fetch fails, that is the answer; it is not something to retry
ten times.

## Files that are already there

- \`.factory/ticket.md\` — the ticket
- \`.factory/requirements/\` — documents attached to the ticket, if any
- \`.claude/agents/\` — the agent definitions, including your own

## What persists

Only what you commit. The container is destroyed at the end of the run, and
a run that is later continued may get a fresh clone. A file you wrote and
did not commit is gone.
`;

const VERIFY = `# Verifying your work in this repository

Verifying means running the repository's own scripts. Nothing else is
available to you and nothing else is expected.

## Find the commands, do not guess them

\`\`\`sh
cat package.json | jq '.scripts'
\`\`\`

Run what is there. Common names are \`check\`, \`typecheck\`, \`lint\`, \`test\`
and \`build\`, but use the ones this project actually defines. If there is a
\`README\` section on running tests, it outranks a guess.

## What NOT to do

- **Do not start a dev or preview server.** \`npm run dev\`, \`npm run preview\`,
  \`vite\`, \`next dev\` — none of these help. A server started in one command
  is not reliably alive in the next, there is no browser to point at it, and
  attempts to fetch from it consume the step's time limit. A run was killed
  having spent most of its limit on exactly this.
- **Do not install a browser or a screenshot tool.** See the sandbox skill.
- **Do not run a watch mode.** \`--watch\` never returns.

## A build is the strongest check you have

A typecheck plus a build proves the code compiles and the types hold. That
is the bar. Visual correctness is judged by whoever reviews the merge
request, against the design.

## When a check fails

Read the first error, not the last. Fix the cause and run the same command
again. If a check was already failing before you touched anything, say so
in your closing message rather than fixing unrelated work.
`;

const DESIGN_HANDOFF = `# Building from a design

A design step leaves three things in the repository.

| File | What it is for |
| --- | --- |
| \`docs/design/screens/*.png\` | What the screen looks like. Read these. |
| \`docs/design/ui.txt\` | The design resolved: tokens, then each screen as a tree with its real values. |
| \`docs/design/ui.pen\` | The editable source. **Do not read this.** |

## Read the outline for values

\`ui.txt\` opens with the token layer — every colour, radius, font and
spacing with its value rather than its name — and then each screen as an
indented tree carrying the properties that decide appearance.

Take values from there rather than reading them off the image. A PNG cannot
tell you \`#2450E6\`, and matching a design means matching its numbers.

## Never parse the .pen

It is a component tree of \`$variable\` references, \`type: "ref"\` reuses and
per-instance override maps. Resolving it correctly takes a few hundred lines
and gets the nested-override case wrong the first time. A run has already
tried this in \`node -e\` one-liners and lost a large part of its limit to it.
\`ui.txt\` is that work, done for you.

## Use the project's own tokens

If the repository already defines design tokens — a theme file, CSS custom
properties, a Tailwind config — put the design's values there and reference
them. Do not scatter hex codes through components.

## Where the design and the repository disagree

The design wins on appearance. The repository wins on structure: use its
existing components, its class conventions and its file layout. Do not
introduce a second way of doing something the project already does.
`;

const SPEND_LESS = `# Working through a long step without wasting it

A step has a time limit and a cost ceiling. Most of both is lost to
searching, re-reading and redoing rather than to the work itself.

## Read the task list first, then read narrowly

\`docs/tasks.md\` says what to do and in what order. Read it, then open only
the files the current task names. Do not read the whole tree first.

## Search before you open

\`\`\`sh
grep -rn "createSession" src/ --include=*.ts
\`\`\`

A grep costs a few hundred tokens. Reading six files to find the same thing
costs tens of thousands. Use \`grep\` to locate and \`Read\` to understand,
in that order.

## Do not re-read what you have already read

The file is in the conversation. Read it again only after you have edited
it and need to see the result, and prefer reading the part you changed.

## Prefer Edit over Write on an existing file

\`Write\` replaces the whole file and costs its whole length. \`Edit\` costs
the part you are changing.

## One task, one commit, then move on

Finish a task, verify it, commit it. Do not carry three half-finished tasks
at once: when the step ends — and it can end at a deadline — committed work
survives and everything else is lost.

## When you are stuck, stop and say so

Two failed attempts at the same thing means the third will also fail. Write
what you tried and what happened, and move to the next task. A step that
finishes four of six tasks and says which two are undone is far more useful
than one killed at its limit having said nothing.
`;

const WRITING_FOR_THE_NEXT_STEP = `# Writing a document the next step has to read

Your document is not the deliverable. It is the input to the next agent,
which pays for every token of it on every turn it takes.

A real run produced a 22 KB plan and a 14 KB task list. Together with the
specification, the implementing step read 44 KB before it wrote a line —
on every turn, for the whole step.

## Length

- A specification: one page. Goal, scope, out of scope, acceptance criteria.
- A plan: two pages. The approach, the files it touches, the risks.
- A task list: one line per task, plus its verification.

If it is longer than that, it is restating the ticket or explaining
something the reader already knows.

## Leave out

- Anything copied from the ticket. The next agent has the ticket.
- Background on the technology. It knows what a component is.
- Alternatives you considered and rejected, unless the rejection constrains
  what comes next.
- Preamble, summary and closing remarks.

## Put in

- Exact paths. \`src/lib/components/home/Hero.svelte\`, not "the hero
  component".
- Exact names. The function, the prop, the token.
- The verification for each task — the command that shows it is done.
- What you decided when the ticket was ambiguous, stated as a decision.

## Structure

Short headings and lists. A table where there are columns. No nested
bullets three deep. The next reader is scanning for what to do, not reading
prose.
`;

const COMMITS = `# Committing as you go

## One commit per task

Finish a task, verify it, commit it. The message is
\`feat(#<ticket>): <the task>\`, as the ticket's own number.

This matters more than it looks. A step can end at its time limit with no
warning. What is committed survives into the merge request and into any
later attempt; what is only in the working tree is lost with the container.

## Before each commit

\`\`\`sh
git status --short
\`\`\`

Check what you are about to include. Never commit \`node_modules\`,
\`.env\`, build output, or anything under a path the project's
\`.gitignore\` already names. If \`git status\` shows hundreds of files,
something is wrong — find out what before committing.

## Stage deliberately

Name the paths. \`git add -A\` sweeps in whatever else happened to be in the
tree, including files a tool wrote that you have not looked at.

## Do not

- Amend or rebase. A later reader wants to see what happened in order.
- Force anything.
- Push. The branch is pushed for you when the pipeline finishes.
- Commit a fix and the thing it fixes separately if they belong together —
  one working commit per task is the unit.
`;

export const DEFAULT_SKILLS: DefaultSkill[] = [
  {
    name: 'sandbox',
    description:
      'What is installed in this container and what is not — no browser, no display, no python. Read before installing a tool, looking for one, or trying to view a page.',
    content: SANDBOX,
    agents: ['spec', 'plan', 'tasks', 'implement'],
  },
  {
    name: 'verifying',
    description:
      'How to check your work in this repository: find its own scripts and run them. Read before running tests, a build, a typecheck, or anything that starts a server.',
    content: VERIFY,
    agents: ['implement'],
  },
  {
    name: 'design-handoff',
    description:
      'How to build an interface from a design: read the PNG exports and docs/design/ui.txt for real values, never the .pen source. Read when a ticket has screens.',
    content: DESIGN_HANDOFF,
    agents: ['implement', 'plan'],
  },
  {
    name: 'working-efficiently',
    description:
      'Getting through a long step without exhausting its time or cost limit: search before reading, edit rather than rewrite, commit each task. Read at the start of a coding step.',
    content: SPEND_LESS,
    agents: ['implement'],
  },
  {
    name: 'writing-for-the-next-step',
    description:
      'How long a specification, plan or task list should be and what to leave out, given the next agent pays for every token of it. Read before writing a document.',
    content: WRITING_FOR_THE_NEXT_STEP,
    agents: ['spec', 'plan', 'tasks'],
  },
  {
    name: 'committing',
    description:
      'One commit per task, what to check before each, and what never to commit. Read before the first commit of a step.',
    content: COMMITS,
    agents: ['implement'],
  },
];
