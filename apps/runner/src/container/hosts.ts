import type { ExecutionHostName } from '../config';
import { type ContainerHost, dockerHost } from './host';

/**
 * Which execution host a deployment runs on, resolved once at startup.
 *
 * This is the whole of 002 FR-025: an operator moves between a locally
 * administered container daemon and a managed sandbox service by changing one
 * variable, with no code change and no rebuild. It is also the rollback, and
 * the reason the test suite needs no account — every test drives the logic
 * through `tests/fake-host.ts`, which satisfies the same interface.
 *
 * Every implementation MUST satisfy every obligation in
 * `specs/002-hosted-runner-sandboxes/contracts/execution-host.md`.
 */
export function hostFor(name: ExecutionHostName): ContainerHost {
  switch (name) {
    case 'docker':
      return dockerHost;
    case 'hosted':
      // T022–T025 register the managed host here. Until then this throws at
      // startup rather than at the first run, because a deployment configured
      // for a host that does not exist should not accept a ticket and then
      // fail it — and because an empty branch here would be a stub nobody
      // could see. The three decisions it depends on (non-root execution,
      // egress switching on a live sandbox, size routing) are unproven, which
      // is why the plan gates this work behind a spike.
      throw new Error(
        "runner: EXECUTION_HOST='hosted' is not implemented yet — " +
          'see specs/002-hosted-runner-sandboxes/tasks.md T005–T007, then T022–T025',
      );
  }
}
