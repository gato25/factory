/**
 * Resolves a `.pen` design into a plain tree, so an implementation can be
 * compared against it rather than against somebody's memory of it.
 *
 * Three things have to be resolved before the file says anything useful:
 *
 *  - **`$variable` references.** Almost every colour, font and radius in the
 *    file is a name, not a value. The `variables` block holds the values, and
 *    it is the single source of truth for the token layer.
 *  - **`type: "ref"` nodes.** A reused component appears as a reference to a
 *    node in the `Components` frame. Left unresolved, an artboard looks
 *    almost empty: the Dashboard has two children, and one of them is the
 *    whole sidebar.
 *  - **`descendants` overrides.** A reference carries a map of paths —
 *    `"WTdjt/aYPyE"` — to property patches, which is how one component
 *    renders a different label or an active state. Applying these is what
 *    turns seven identical nav rows into named ones.
 *
 * Used by `scripts/design/report.ts` and by the fidelity check, so the
 * numbers in both come from the file rather than from a reading of it — and
 * by the runner, which resolves a run's own design into text beside the
 * exports so the implementing agent never has to write this itself.
 *
 * Pure on purpose: it takes a parsed file, never a path. The runner reads a
 * `.pen` out of a container and has no filesystem to point at. Loading this
 * repository's own design stays in `scripts/design/resolve.ts`.
 */

export interface PenVariable {
  type: 'color' | 'string' | 'number';
  value: string | number;
}

export interface PenNode {
  type?: string;
  id?: string;
  name?: string;
  ref?: string;
  descendants?: Record<string, Record<string, unknown>>;
  children?: PenNode[];
  [key: string]: unknown;
}

export interface PenFile {
  version: string;
  variables: Record<string, PenVariable>;
  children: PenNode[];
}

/** Every node by id, including those inside the `Components` frame. */
export function index(file: PenFile): Map<string, PenNode> {
  const byId = new Map<string, PenNode>();
  const walk = (node: PenNode) => {
    if (node.id) byId.set(node.id, node);
    for (const child of node.children ?? []) walk(child);
  };
  for (const child of file.children) walk(child);
  return byId;
}

/**
 * `$name` → the variable's value. A name with no variable is left as it is
 * rather than replaced with undefined: an unresolved token should be visible
 * in the output, not silently a hole.
 */
export function value(raw: unknown, variables: Record<string, PenVariable>): unknown {
  if (typeof raw !== 'string' || !raw.startsWith('$')) return raw;
  const found = variables[raw.slice(1)];
  return found ? found.value : raw;
}

export interface Resolved {
  type: string;
  name?: string;
  /** The reused component this came from, where it came from one. */
  from?: string;
  props: Record<string, unknown>;
  children: Resolved[];
}

/**
 * A set of overrides, and where we currently are inside the reference that
 * carried them.
 *
 * Two of these can be live at once, which is the whole subtlety. The sidebar
 * reference patches `WTdjt/aYPyE` — the icon inside its Dashboard nav row —
 * while that row is ITSELF a reference to the Nav Item component, whose own
 * patches are keyed from its own root. Tracking one path lost the outer one,
 * and the active nav item silently kept the inactive colour.
 */
interface Scope {
  overrides: Record<string, Record<string, unknown>>;
  path: string;
}

function resolveNode(
  node: PenNode,
  byId: Map<string, PenNode>,
  variables: Record<string, PenVariable>,
  scopes: Scope[],
  seen: Set<string>,
): Resolved {
  let source = node;
  let from: string | undefined;
  let active = scopes;

  if (node.type === 'ref' && typeof node.ref === 'string') {
    const target = byId.get(node.ref);
    if (!target) {
      return { type: 'missing-ref', name: node.name, props: { ref: node.ref }, children: [] };
    }
    // A component referencing itself would recurse forever. Nothing in this
    // file does, but a design tool will happily let somebody try.
    if (seen.has(node.ref)) {
      return { type: 'cyclic-ref', name: node.name, props: { ref: node.ref }, children: [] };
    }
    seen = new Set([...seen, node.ref]);
    source = target;
    from = target.name;
    // The reference's own patches start a fresh path space; the enclosing
    // ones keep counting from where they were.
    active = node.descendants ? [...scopes, { overrides: node.descendants, path: '' }] : scopes;
  }

  // Every scope that names this node contributes, outermost first, so a
  // patch closer to the use wins.
  const props: Record<string, unknown> = {};
  const patches = active.map((scope) => scope.overrides[scope.path] ?? {});
  for (const [key, raw] of Object.entries(Object.assign({}, source, node, ...patches))) {
    if (['children', 'type', 'id', 'name', 'ref', 'descendants', 'reusable'].includes(key)) {
      continue;
    }
    props[key] = value(raw, variables);
  }

  const children = (source.children ?? []).map((child) =>
    resolveNode(
      child,
      byId,
      variables,
      active.map((scope) => ({
        overrides: scope.overrides,
        path: scope.path ? `${scope.path}/${child.id}` : (child.id ?? ''),
      })),
      seen,
    ),
  );

  return {
    type: (node.type === 'ref' ? source.type : node.type) ?? 'unknown',
    name: node.name ?? source.name,
    ...(from && from !== node.name ? { from } : {}),
    props,
    children,
  };
}

/**
 * Every artboard, resolved. The `Components` frame is not one.
 *
 * The file is required rather than defaulted to this repository's own: the
 * runner resolves a design it read out of a container, and has no path.
 */
export function artboards(file: PenFile): Resolved[] {
  const byId = index(file);
  return file.children
    .filter((child) => child.name !== 'Components')
    .map((child) => resolveNode(child, byId, file.variables, [], new Set()));
}

/** Every string a screen displays, in document order. */
export function labels(node: Resolved, into: string[] = []): string[] {
  if (typeof node.props.content === 'string' && node.props.content.trim()) {
    into.push(node.props.content.trim());
  }
  for (const child of node.children) labels(child, into);
  return into;
}

/** Every icon a screen uses, so a missing one is visible. */
export function icons(node: Resolved, into: string[] = []): string[] {
  if (typeof node.props.icon === 'string') into.push(node.props.icon);
  for (const child of node.children) icons(child, into);
  return into;
}

export function count(node: Resolved): number {
  return 1 + node.children.reduce((n, child) => n + count(child), 0);
}

/**
 * The resolved design as plain text, for whoever has to build it.
 *
 * The implementing agent is handed PNG exports, which show what a screen
 * looks like and carry none of its values. Reaching for the `.pen` instead
 * means writing the three resolutions above by hand, in a sandbox, against
 * a deadline — a run was observed doing exactly that in `node -e`
 * one-liners. This is that work done once, written beside the exports.
 *
 * Text rather than JSON because it is read by a model, and an indented
 * outline says parent-and-child in a quarter of the tokens that braces do.
 */
export function outline(file: PenFile): string {
  const out: string[] = ['# Design', '', '## Tokens', ''];
  for (const [name, variable] of Object.entries(file.variables)) {
    out.push(`  ${name}: ${variable.value}`);
  }

  const say = (node: Resolved, depth: number) => {
    const pad = '  '.repeat(depth + 1);
    const bits: string[] = [node.type];
    if (node.name) bits.push(`[${node.name}]`);
    if (node.from && node.from !== node.name) bits.push(`←${node.from}`);
    // The properties that decide what something looks like. Everything else
    // in a node is bookkeeping, and printing it would bury these.
    for (const key of [
      'content',
      'icon',
      'fill',
      'stroke',
      'width',
      'height',
      'layout',
      'gap',
      'padding',
      'cornerRadius',
      'fontFamily',
      'fontSize',
      'fontWeight',
      'lineHeight',
      'textAlign',
      'justifyContent',
      'alignItems',
      'opacity',
    ]) {
      const value = node.props[key];
      if (value === undefined || value === null) continue;
      bits.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
    }
    out.push(pad + bits.join(' '));
    for (const child of node.children) say(child, depth + 1);
  };

  for (const board of artboards(file)) {
    out.push('', `## ${board.name ?? 'screen'}`, '');
    say(board, 0);
  }
  return `${out.join('\n')}\n`;
}
