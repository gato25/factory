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
 *
 * **Why the managed host arrives as a function rather than an import.**
 * `@cloudflare/sandbox` imports `cloudflare:workers`, a module that exists only
 * in the Workers runtime — importing it from here makes this file unloadable
 * under Bun, which takes the entire test suite and the whole Docker path with
 * it. So the SDK is imported in exactly one place, `worker.ts`, and reaches
 * this selector as a thunk that is called only if configuration asks for it.
 * That is the practical shape of the plan's "two runtime targets" complexity.
 */
export function hostFor(name: ExecutionHostName, makeHosted?: () => ContainerHost): ContainerHost {
  switch (name) {
    case 'docker':
      return dockerHost;
    case 'hosted': {
      if (!makeHosted) {
        // Fails where it can be understood. A deployment configured for the
        // managed host but reached through a path that cannot build one is a
        // wiring mistake, and saying so beats accepting a ticket and then
        // failing it with something about an undefined namespace.
        throw new Error(
          "runner: EXECUTION_HOST='hosted' can only be served by the Worker entry, which " +
            'supplies the sandbox Durable Object namespace — see apps/runner/src/worker.ts',
        );
      }
      return makeHosted();
    }
  }
}
