import { describe, expect, test } from 'bun:test';
import { DOCKER_COMMAND_TIMEOUT_MS, removalFailed } from '../../src/container/host';

/**
 * `docker rm` is checked, where it used to be assumed: a removal that failed
 * used to log "sandbox released" and forget the container.
 */
describe('whether a removal happened', () => {
  test('success is success', () => {
    expect(removalFailed({ exitCode: 0, stdout: 'abc', stderr: '' })).toBeNull();
  });

  test('a container already gone is the outcome asked for', () => {
    expect(
      removalFailed({
        exitCode: 1,
        stdout: '',
        stderr: 'Error response from daemon: No such container: abc',
      }),
    ).toBeNull();
  });

  test('anything else is a failure, named by what the daemon said', () => {
    expect(
      removalFailed({
        exitCode: 1,
        stdout: '',
        stderr: 'permission denied while trying to connect to the Docker daemon socket',
      }),
    ).toContain('permission denied');
    expect(removalFailed({ exitCode: 124, stdout: '', stderr: '' })).toContain('exited 124');
  });

  test('management commands have a deadline short enough for a shutdown to wait on', () => {
    expect(DOCKER_COMMAND_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
});
