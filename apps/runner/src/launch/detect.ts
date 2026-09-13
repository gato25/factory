/**
 * Working out how to start a project, from the files in its workspace
 * (003 FR-004, FR-005).
 *
 * A launch has to run a command nobody typed, and guess wrong in a way that
 * costs one edit rather than a failed start every time. So this reads what a
 * project already says about itself — `package.json` above all — and proposes
 * a command and a port. The repository's own setting, when there is one,
 * overrides all of it; this is the default it starts from.
 *
 * **The one thing every guess has to get right** is the address the server
 * binds. Inside a container, a dev server that listens on `localhost` is
 * unreachable from outside it, however faithfully the port is published; it
 * has to listen on `0.0.0.0`. Every framework spells that differently, and
 * getting it wrong presents as "the server started and nothing answers" —
 * the most confusing failure available. So each proposal carries the flag its
 * framework needs, and the generic ones set `HOST` and `PORT` in the
 * environment and say, in a note, what the project must do with them.
 *
 * Pure: a map of file contents in, a proposal out, so it is tested without a
 * container.
 */

export interface StartProposal {
  /** Run from the workspace root, through `sh -c`. `$PORT` is set. */
  command: string;
  /** The port the command will listen on inside the container. */
  port: number;
  /** Run first, or nothing. */
  install?: string;
  /** What this proposal knows about itself that a person should read. */
  notes: string[];
  /** Where the guess came from, for the screen to say. */
  from: string;
}

/** The files detection reads, each `null` where the workspace has none. */
export type WorkspaceFiles = Record<string, string | null>;

/** Every path detection asks for, so a caller can fetch them in one pass. */
export const DETECTION_FILES = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'Dockerfile',
  'docker-compose.yml',
  'compose.yaml',
  'requirements.txt',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'Procfile',
] as const;

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function parsePackage(text: string | null | undefined): PackageJson | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as PackageJson) : null;
  } catch {
    return null;
  }
}

/** Which package manager the lockfile says, and whether the image has it. */
function installFor(files: WorkspaceFiles): { install: string; notes: string[] } {
  if (files['package-lock.json']) return { install: 'npm ci', notes: [] };
  if (files['pnpm-lock.yaml']) {
    return {
      install: 'npm install',
      notes: ['pnpm-lock.yaml found, but the sandbox has npm only — installed with npm instead.'],
    };
  }
  if (files['yarn.lock']) {
    return {
      install: 'npm install',
      notes: ['yarn.lock found, but the sandbox has npm only — installed with npm instead.'],
    };
  }
  if (files['bun.lock'] || files['bun.lockb']) {
    return {
      install: 'npm install',
      notes: ['bun.lock found, but the sandbox has npm only — installed with npm instead.'],
    };
  }
  return { install: 'npm install', notes: [] };
}

/**
 * Frameworks whose dev server needs telling where to listen, in the order
 * they should win when more than one is present (a SvelteKit project depends
 * on vite too, and it is the framework's own flags that count).
 */
const FRAMEWORKS: {
  dependency: string;
  label: string;
  /** The dev command, given the script name to run through. */
  command: (script: string) => string;
  port: number;
}[] = [
  {
    dependency: 'next',
    label: 'Next.js',
    command: (script) => `npm run ${script} -- -H 0.0.0.0 -p $PORT`,
    port: 3000,
  },
  {
    dependency: 'nuxt',
    label: 'Nuxt',
    command: (script) => `npm run ${script} -- --host 0.0.0.0 --port $PORT`,
    port: 3000,
  },
  {
    dependency: 'astro',
    label: 'Astro',
    command: (script) => `npm run ${script} -- --host 0.0.0.0 --port $PORT`,
    port: 4321,
  },
  {
    dependency: '@sveltejs/kit',
    label: 'SvelteKit',
    command: (script) => `npm run ${script} -- --host 0.0.0.0 --port $PORT`,
    port: 5173,
  },
  {
    dependency: 'vite',
    label: 'Vite',
    command: (script) => `npm run ${script} -- --host 0.0.0.0 --port $PORT`,
    port: 5173,
  },
  {
    dependency: '@angular/cli',
    label: 'Angular',
    command: (script) => `npm run ${script} -- --host 0.0.0.0 --port $PORT`,
    port: 4200,
  },
];

/**
 * A proposal, or `null` when the workspace says nothing this can act on.
 *
 * `null` is a real answer, not a failure: the screen turns it into "set a
 * start command for this repository", which is the one thing that will work.
 */
export function detectStart(files: WorkspaceFiles): StartProposal | null {
  const pkg = parsePackage(files['package.json']);

  if (pkg) {
    const scripts = pkg.scripts ?? {};
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const { install, notes } = installFor(files);
    // `dev` first: it is what the project's own author starts. `start` is
    // often the production entry, which may need a build first.
    const script = scripts.dev ? 'dev' : scripts.start ? 'start' : null;

    if (!script) {
      return null;
    }

    const framework = FRAMEWORKS.find((candidate) => candidate.dependency in deps);
    if (framework) {
      return {
        command: framework.command(script),
        port: framework.port,
        install,
        notes: [...notes],
        from: `package.json — ${framework.label}, npm run ${script}`,
      };
    }

    // No framework this knows. The generic answer sets HOST and PORT and
    // says what the server has to do with them — because if it listens on
    // localhost, nothing outside the container will ever reach it.
    return {
      command: `npm run ${script}`,
      port: 3000,
      install,
      notes: [
        ...notes,
        'The server must listen on HOST (0.0.0.0) and PORT, both set in the environment. ' +
          'A server that binds localhost is unreachable from outside its container.',
      ],
      from: `package.json — npm run ${script}`,
    };
  }

  // Things this recognises but cannot run in the shipped sandbox image, named
  // so the screen can say why rather than guessing.
  if (files.Dockerfile || files['docker-compose.yml'] || files['compose.yaml']) return null;
  if (files['requirements.txt'] || files['pyproject.toml']) return null;
  if (files['go.mod'] || files['Cargo.toml']) return null;

  return null;
}

/**
 * Why detection found nothing, when it did — so the message names the
 * project's own shape rather than saying "unknown".
 */
export function explainNoStart(files: WorkspaceFiles): string {
  const pkg = parsePackage(files['package.json']);
  if (pkg) {
    return 'package.json has neither a `dev` nor a `start` script, so there is nothing to run.';
  }
  if (files.Dockerfile || files['docker-compose.yml'] || files['compose.yaml']) {
    return 'This project runs from a Dockerfile, which the sandbox cannot build yet.';
  }
  if (files['requirements.txt'] || files['pyproject.toml']) {
    return 'This is a Python project, and the sandbox image has Node only.';
  }
  if (files['go.mod']) return 'This is a Go project, and the sandbox image has Node only.';
  if (files['Cargo.toml']) return 'This is a Rust project, and the sandbox image has Node only.';
  return 'Nothing in the workspace says how this project starts.';
}
