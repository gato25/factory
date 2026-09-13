import type { ContainerHost, ContainerSpec, ExecOptions, ExecResult } from '../src/container/host';

/**
 * An in-memory container host. The Docker daemon is a boundary, not logic, so
 * putting it behind an interface lets the lifecycle be proven without one.
 */
export interface ExecCall {
  containerId: string;
  argv: string[];
  options?: ExecOptions;
}

export class FakeHost implements ContainerHost {
  readonly created: ContainerSpec[] = [];
  readonly calls: ExecCall[] = [];
  readonly files = new Map<string, string>();
  readonly destroyed: string[] = [];
  /** argv-substring → result. First match wins. */
  responses: { match: string; result: Partial<ExecResult> }[] = [];
  createFails = false;

  async create(spec: ContainerSpec): Promise<string> {
    if (this.createFails) throw new Error('daemon unavailable');
    this.created.push(spec);
    return `container-${this.created.length}`;
  }

  async exec(containerId: string, argv: string[], options?: ExecOptions): Promise<ExecResult> {
    this.calls.push({ containerId, argv, options });
    const joined = argv.join(' ');
    const scripted = this.responses.find((r) => joined.includes(r.match));
    const result: ExecResult = {
      exitCode: scripted?.result.exitCode ?? 0,
      stdout: scripted?.result.stdout ?? '',
      stderr: scripted?.result.stderr ?? '',
    };
    if (result.stdout) options?.onOutput?.('stdout', result.stdout);
    if (result.stderr) options?.onOutput?.('stderr', result.stderr);
    return result;
  }

  async writeFile(_containerId: string, path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async readFile(_containerId: string, path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async stat(_containerId: string, path: string): Promise<{ size: number } | null> {
    const content = this.files.get(path);
    return content === undefined ? null : { size: content.length };
  }

  async address(containerId: string, port: number): Promise<string | null> {
    const index = Number(containerId.replace('container-', ''));
    const spec = this.created[index - 1];
    if (!spec?.publish?.includes(port)) return null;
    // Deterministic, so a test can assert the address a launch reports.
    return `127.0.0.1:${40000 + index * 10 + spec.publish.indexOf(port)}`;
  }

  async destroy(containerId: string): Promise<void> {
    this.destroyed.push(containerId);
  }

  argvFor(match: string): string[] | undefined {
    return this.calls.find((c) => c.argv.join(' ').includes(match))?.argv;
  }
}

export const snapshot = {
  run_id: '11111111-1111-1111-1111-111111111111',
  attempt: 1,
  ticket: {
    reference: '#142',
    title: 'Add Google OAuth sign-in',
    description: 'Users should sign in with Google.',
    acceptance_criteria: ['A Google button appears', 'Tests pass'],
  },
  repo: {
    clone_url: 'https://gitlab.com/netgroup/shop-frontend.git',
    default_branch: 'main',
    branch: 'factory/142-add-google-oauth-sign-in',
    provider: 'gitlab' as const,
    credential_ref: 'cred_1',
  },
  pipeline: {
    id: 'p1',
    version: 7,
    name: 'Standard',
    steps: [
      {
        type: 'agent' as const,
        condition: 'always' as const,
        agent_id: 'a-spec',
        output_files: ['docs/spec.md'],
      },
    ],
  },
  limits: { cost_ceiling_usd: '5.0000', time_ceiling_minutes: 45 },
  agents: [
    {
      id: 'a-spec',
      name: 'Spec',
      engine: 'claude_cli' as const,
      model: 'claude-sonnet-5',
      system_prompt: 'Write docs/spec.md for {{ticket.title}} on {{repo.branch}}.',
      allowed_tools: ['Read', 'Write'],
      skills: [{ name: 'house-style', description: 'How we write', content: 'Be brief.' }],
      limits: { max_turns: 20 },
    },
  ],
  callback_url: 'https://factory.example/api/hooks/n8n',
  resume_secret: 'run-secret-value-long-enough',
};

export const credentials = {
  gitToken: 'glpat-abcdefghijklmnop1234',
  modelKey: 'sk-ant-api03-abcdefghijklmnop',
  designKey: undefined as string | undefined,
};
