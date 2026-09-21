#!/usr/bin/env bun
/**
 * What one artboard contains, in a form you can hold beside the screen.
 *
 *   bun scripts/design/report.ts                # every artboard, one line each
 *   bun scripts/design/report.ts "01 Dashboard" # one artboard, in full
 *   bun scripts/design/report.ts --tokens       # the variables block
 */

import { artboards, count, icons, labels, load, type Resolved } from './resolve';

const wanted = Bun.argv.slice(2).filter((a) => !a.startsWith('--'));

if (Bun.argv.includes('--tokens')) {
  const { variables } = load();
  for (const [name, v] of Object.entries(variables)) {
    console.log(`  --${name}: ${v.value};`);
  }
  process.exit(0);
}

const size = (n: Resolved) => {
  const w = n.props.width;
  const h = n.props.height;
  return w || h
    ? ` ${typeof w === 'number' ? `${w}px` : (w ?? '?')}×${typeof h === 'number' ? `${h}px` : (h ?? '?')}`
    : '';
};

function tree(node: Resolved, depth = 0, into: string[] = []): string[] {
  const pad = '  '.repeat(depth);
  const text = typeof node.props.content === 'string' ? ` "${node.props.content}"` : '';
  const from = node.from ? ` ←${node.from}` : '';
  const fill = typeof node.props.fill === 'string' ? ` fill=${node.props.fill}` : '';
  into.push(
    `${pad}${node.type}${node.name ? ` [${node.name}]` : ''}${from}${text}${fill}${size(node)}`,
  );
  for (const child of node.children) tree(child, depth + 1, into);
  return into;
}

for (const board of artboards(load())) {
  if (wanted.length > 0 && !wanted.some((w) => board.name?.includes(w))) continue;
  if (wanted.length === 0) {
    console.log(`${board.name}  ${count(board)} nodes, ${labels(board).length} labels`);
    continue;
  }
  console.log(`=== ${board.name} ===`);
  console.log(tree(board).join('\n'));
  console.log(`\n--- icons: ${[...new Set(icons(board))].join(', ')}`);
}
