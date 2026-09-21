#!/usr/bin/env bun
/**
 * Reading `design.pen` off disk.
 *
 * The resolving itself moved to `@factory/shared` — the runner needs the
 * same three resolutions (variable references, component references,
 * per-instance override maps) to write a run's design out as text, and it
 * cannot import from `scripts/`. What is left here is the half that knows
 * where this repository keeps its design file, so the report, the icon
 * generator and the fidelity tests carry on reading as they did.
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import type { PenFile } from '@factory/shared';

export {
  artboards,
  count,
  icons,
  index,
  labels,
  outline,
  type PenFile,
  type PenNode,
  type PenVariable,
  type Resolved,
  value,
} from '@factory/shared';

const DESIGN = resolvePath(import.meta.dir, '../../design.pen');

export function load(path = DESIGN): PenFile {
  return JSON.parse(readFileSync(path, 'utf8')) as PenFile;
}
